import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents, workforceDemandImportBatches, workforceDemandObservationRevisions,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import {
  demandImportDigest, type DemandImport,
} from "@/lib/workforce-operational-demand-import";

/** All writes use one transaction, one employer advisory lock and append-only revisions. */
export class DemandImportConflict extends Error {}

export async function writeOperationalDemandImport(input: {
  batch: DemandImport;
  actorUserId: number;
  actorName: string;
}) {
  const { batch, actorUserId } = input;
  const sha = demandImportDigest(batch);
  // Bounded independent company-level serialisation prevents two importers
  // accepting the same expected next version concurrently.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(8857, ${batch.organizationId})`);
    const [prior] = await tx.select().from(workforceDemandImportBatches).where(and(
      eq(workforceDemandImportBatches.organizationId, batch.organizationId),
      eq(workforceDemandImportBatches.idempotencyKey, batch.idempotencyKey),
    )).limit(1);
    if (prior) {
      if (prior.requestSha256 !== sha) {
        throw new DemandImportConflict("Idempotency key was already used for a different demand import.");
      }
      return { batchId: prior.id, rowCount: prior.rowCount, sha256: sha, replayed: true };
    }

    for (const row of batch.rows) {
      const [existing] = await tx.select({
        revision: workforceDemandObservationRevisions.revision,
      }).from(workforceDemandObservationRevisions).where(and(
        eq(workforceDemandObservationRevisions.organizationId, batch.organizationId),
        eq(workforceDemandObservationRevisions.worksiteId, batch.worksiteId),
        eq(workforceDemandObservationRevisions.sourceKey, batch.sourceKey),
        eq(workforceDemandObservationRevisions.metricKind, batch.metricKind),
        eq(workforceDemandObservationRevisions.intervalMinutes, batch.intervalMinutes),
        eq(workforceDemandObservationRevisions.intervalStart, new Date(row.intervalStart)),
      )).orderBy(desc(workforceDemandObservationRevisions.revision)).limit(1);
      if (row.revision !== (existing?.revision ?? 0) + 1) {
        throw new DemandImportConflict(
          "An observed interval has an outdated or skipped revision. Reload its existing source version first.",
        );
      }
    }

    const [importRecord] = await tx.insert(workforceDemandImportBatches).values({
      organizationId: batch.organizationId, worksiteId: batch.worksiteId,
      sourceKey: batch.sourceKey, metricKind: batch.metricKind,
      intervalMinutes: batch.intervalMinutes,
      idempotencyKey: batch.idempotencyKey, requestSha256: sha,
      rowCount: batch.rows.length, createdByUserId: actorUserId,
    }).returning({ id: workforceDemandImportBatches.id });

    for (const row of batch.rows) {
      await tx.insert(workforceDemandObservationRevisions).values({
        organizationId: batch.organizationId, worksiteId: batch.worksiteId,
        importBatchId: importRecord.id, sourceKey: batch.sourceKey,
        metricKind: batch.metricKind, intervalMinutes: batch.intervalMinutes,
        intervalStart: new Date(row.intervalStart),
        revision: row.revision, observedCount: row.observedCount, quality: row.quality,
      });
    }

    // Audit in the SAME SQL transaction; audit failure cannot leave
    // deceptively successful import evidence.
    await tx.insert(auditEvents).values({
      organizationId: batch.organizationId,
      actor: input.actorName.slice(0, 120),
      action: "WFM aggregate operational demand imported",
      resource: "worksite:" + batch.worksiteId,
      metadata: {
        importBatchId: importRecord.id, sourceKey: batch.sourceKey,
        metricKind: batch.metricKind, intervalMinutes: batch.intervalMinutes,
        rowCount: batch.rows.length, sha256: sha,
        // No patient/customer/order/person-level payload ever enters audit.
      },
    });
    return { batchId: importRecord.id, rowCount: batch.rows.length, sha256: sha, replayed: false };
  });
}

/** Tenant-/site-filtered, bounded read. Over-limit is handled by the forecaster. */
export async function loadOperationalDemandVersions(input: {
  organizationId: number; worksiteId: number; sourceKey: string;
  metricKind: string; intervalMinutes: number; from: Date; to: Date;
  limit: number;
}) {
  return db.select({
    intervalStart: workforceDemandObservationRevisions.intervalStart,
    intervalMinutes: workforceDemandObservationRevisions.intervalMinutes,
    revision: workforceDemandObservationRevisions.revision,
    observedCount: workforceDemandObservationRevisions.observedCount,
    quality: workforceDemandObservationRevisions.quality,
  }).from(workforceDemandObservationRevisions).where(and(
    eq(workforceDemandObservationRevisions.organizationId, input.organizationId),
    eq(workforceDemandObservationRevisions.worksiteId, input.worksiteId),
    eq(workforceDemandObservationRevisions.sourceKey, input.sourceKey),
    eq(workforceDemandObservationRevisions.metricKind, input.metricKind),
    eq(workforceDemandObservationRevisions.intervalMinutes, input.intervalMinutes),
    gte(workforceDemandObservationRevisions.intervalStart, input.from),
    lt(workforceDemandObservationRevisions.intervalStart, input.to),
  )).orderBy(asc(workforceDemandObservationRevisions.intervalStart),
    desc(workforceDemandObservationRevisions.revision)).limit(input.limit);
}
