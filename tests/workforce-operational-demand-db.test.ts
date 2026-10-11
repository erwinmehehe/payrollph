import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  organizations, worksites, users,
  workforceDemandImportBatches, workforceDemandObservationRevisions,
} from "../src/db/schema";
import {
  parseDemandImport,
} from "../src/lib/workforce-operational-demand-import";
import {
  DemandImportConflict, loadOperationalDemandVersions,
  writeOperationalDemandImport,
} from "../src/lib/workforce-operational-demand-server";

test("isolated PostgreSQL writes idempotent revisions and never silently overwrites older source evidence", async () => {
  const unique = randomUUID().slice(0, 8);
  const [org] = await db.insert(organizations).values({
    name: "Synthetic WFM " + unique, legalName: "Synthetic WFM " + unique,
  }).returning({ id: organizations.id });
  let siteId = 0;
  let userId = 0;
  try {
    const [site] = await db.insert(worksites).values({
      organizationId: org.id, code: "TEST-" + unique, name: "Fictional warehouse",
    }).returning({ id: worksites.id });
    siteId = site.id;
    const [user] = await db.insert(users).values({
      name: "Synthetic Source Importer",
      email: "wfm-demand-" + unique + "@example.invalid",
      passwordHash: "never-used-synthetic-only", role: "owner",
    }).returning({ id: users.id });
    userId = user.id;
    const localYesterday = new Date(Date.now() + 8 * 3600_000 - 86_400_000)
      .toISOString().slice(0, 10);
    const baseline = {
      organizationId: org.id, worksiteId: site.id,
      sourceKey: "pos-main", metricKind: "transactions", intervalMinutes: 30,
      idempotencyKey: "batch-" + randomUUID(),
      acknowledged: true,
      rows: [{ intervalStart: localYesterday + "T09:00:00+08:00",
        observedCount: 25, quality: "complete", revision: 1 }],
    };
    const v1 = parseDemandImport(baseline);
    const first = await writeOperationalDemandImport({
      batch: v1, actorUserId: user.id, actorName: "Synthetic Source Importer",
    });
    assert.equal(first.rowCount, 1);
    assert.equal(first.replayed, false);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);

    const replayed = await writeOperationalDemandImport({
      batch: v1, actorUserId: user.id, actorName: "Synthetic Source Importer",
    });
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.batchId, first.batchId);

    await assert.rejects(
      writeOperationalDemandImport({ batch: parseDemandImport({ ...baseline,
        rows: [{ ...baseline.rows[0], observedCount: 99 }],
      }), actorUserId: user.id, actorName: "Synthetic Source Importer" }),
      DemandImportConflict,
    );
    const revisionBatch = parseDemandImport({
      ...baseline, idempotencyKey: "batch-" + randomUUID(),
      rows: [{ ...baseline.rows[0], observedCount: 30, revision: 2 }],
    });
    const second = await writeOperationalDemandImport({
      batch: revisionBatch, actorUserId: user.id, actorName: "Synthetic Source Importer",
    });
    assert.equal(second.replayed, false);

    await assert.rejects(
      writeOperationalDemandImport({ batch: parseDemandImport({
        ...baseline, idempotencyKey: "batch-" + randomUUID(),
        rows: [{ ...baseline.rows[0], observedCount: 15, revision: 4 }],
      }), actorUserId: user.id, actorName: "Synthetic Source Importer" }),
      DemandImportConflict,
    );

    const from = new Date(localYesterday + "T00:00:00+08:00");
    const to = new Date(localYesterday + "T23:59:59+08:00");
    const scoped = await loadOperationalDemandVersions({
      organizationId: org.id, worksiteId: site.id, sourceKey: "pos-main",
      metricKind: "transactions", intervalMinutes: 30, from, to, limit: 30,
    });
    assert.equal(scoped.length, 2);
    assert.deepEqual(scoped.map(x => x.revision), [2, 1]);
    assert.deepEqual(scoped.map(x => x.observedCount), [30, 25]);

    const foreign = await loadOperationalDemandVersions({
      organizationId: org.id + 1, worksiteId: site.id, sourceKey: "pos-main",
      metricKind: "transactions", intervalMinutes: 30, from, to, limit: 30,
    });
    assert.deepEqual(foreign, [], "tenant mismatch must return zero rows");
    const foreignSite = await loadOperationalDemandVersions({
      organizationId: org.id, worksiteId: site.id + 1, sourceKey: "pos-main",
      metricKind: "transactions", intervalMinutes: 30, from, to, limit: 30,
    });
    assert.deepEqual(foreignSite, [], "site mismatch must return zero rows");
    const batches = await db.select().from(workforceDemandImportBatches).where(
      eq(workforceDemandImportBatches.organizationId, org.id));
    assert.equal(batches.length, 2, "retries and failed revisions cannot add batches");
  } finally {
    // Clean only this synthetic organization's exact rows. Never touch actual
    // employer data, and never depend on arbitrary database-wide cleanup.
    await db.delete(workforceDemandObservationRevisions).where(
      eq(workforceDemandObservationRevisions.organizationId, org.id));
    await db.delete(workforceDemandImportBatches).where(
      eq(workforceDemandImportBatches.organizationId, org.id));
    if (siteId) await db.delete(worksites).where(and(
      eq(worksites.id, siteId), eq(worksites.organizationId, org.id)));
    if (userId) await db.delete(users).where(eq(users.id, userId));
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
