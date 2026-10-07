import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  performanceCycleEvidenceAmendments,
  performanceCycleEvidenceSeals,
  performanceCycles,
  performanceEvidencePolicies,
  performanceReviews,
} from "@/db/schema";
import { buildPerformanceEvidencePackage } from "@/lib/hcm-performance-evidence";

export type PerformanceEvidencePolicySnapshot = {
  version: number;
  retentionYears: number;
  autoSealCompletedCycles: boolean;
  allowPostSealAmendments: boolean;
};

export const DEFAULT_PERFORMANCE_EVIDENCE_POLICY: PerformanceEvidencePolicySnapshot = {
  version: 0,
  retentionYears: 7,
  autoSealCompletedCycles: true,
  allowPostSealAmendments: true,
};

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function performanceEvidencePolicySnapshot(
  row: typeof performanceEvidencePolicies.$inferSelect | null | undefined,
): PerformanceEvidencePolicySnapshot {
  if (!row) return DEFAULT_PERFORMANCE_EVIDENCE_POLICY;
  return {
    version: row.version,
    retentionYears: row.retentionYears,
    autoSealCompletedCycles: row.autoSealCompletedCycles,
    allowPostSealAmendments: row.allowPostSealAmendments,
  };
}

export async function loadPerformanceEvidencePolicy(organizationId: number) {
  const [row] = await db.select().from(performanceEvidencePolicies).where(
    eq(performanceEvidencePolicies.organizationId, organizationId),
  ).limit(1);
  return { row: row ?? null, snapshot: performanceEvidencePolicySnapshot(row) };
}

function retentionUntil(now: Date, years: number) {
  const value = new Date(Date.UTC(now.getUTCFullYear() + years, now.getUTCMonth(), now.getUTCDate()));
  return value.toISOString().slice(0, 10);
}

export async function buildPerformanceCycleSealManifest(input: {
  organizationId: number;
  cycleId: number;
  generatedBy: string;
}) {
  const [cycle] = await db.select().from(performanceCycles).where(and(
    eq(performanceCycles.id, input.cycleId),
    eq(performanceCycles.organizationId, input.organizationId),
  )).limit(1);
  if (!cycle) throw new Error("Performance cycle not found.");
  if (cycle.status !== "completed") {
    throw new Error("Only completed performance cycles can be sealed.");
  }

  const reviews = await db.select({
    employeeId: performanceReviews.employeeId,
  }).from(performanceReviews).where(and(
    eq(performanceReviews.organizationId, input.organizationId),
    eq(performanceReviews.cycleId, input.cycleId),
  ));
  const employeeIds = [...new Set(reviews.map((review) => review.employeeId))].sort((a, b) => a - b);
  const employeeEvidence = [];
  for (const employeeId of employeeIds) {
    const pack = await buildPerformanceEvidencePackage({
      organizationId: input.organizationId,
      employeeId,
      cycleId: input.cycleId,
      generatedBy: input.generatedBy,
    });
    employeeEvidence.push({
      employeeId,
      schemaVersion: pack.schemaVersion,
      evidenceHash: pack.snapshot.sha256,
      sectionHashes: pack.snapshot.sectionHashes,
      rowCounts: Object.fromEntries(
        Object.entries(pack.sections).map(([name, value]) => [name, value.rowCount]),
      ),
    });
  }

  const manifest = {
    schemaVersion: "performance-cycle-seal-v1",
    organizationId: input.organizationId,
    cycle: {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      completedAt: cycle.completedAt?.toISOString() ?? null,
    },
    employeeEvidence,
  };
  return { manifest, manifestHash: sha256(manifest) };
}

export async function sealPerformanceCycle(input: {
  organizationId: number;
  cycleId: number;
  actorUserId?: number | null;
  actorName: string;
  now?: Date;
}) {
  const [existing] = await db.select().from(performanceCycleEvidenceSeals).where(and(
    eq(performanceCycleEvidenceSeals.organizationId, input.organizationId),
    eq(performanceCycleEvidenceSeals.cycleId, input.cycleId),
  )).limit(1);
  if (existing) return { seal: existing, created: false };

  const now = input.now ?? new Date();
  const policyState = await loadPerformanceEvidencePolicy(input.organizationId);
  const { manifest, manifestHash } = await buildPerformanceCycleSealManifest({
    organizationId: input.organizationId,
    cycleId: input.cycleId,
    generatedBy: input.actorName,
  });

  const [seal] = await db.insert(performanceCycleEvidenceSeals).values({
    organizationId: input.organizationId,
    cycleId: input.cycleId,
    policyVersion: policyState.snapshot.version,
    policySnapshot: policyState.snapshot,
    manifest,
    manifestHash,
    sealedByUserId: input.actorUserId ?? null,
    sealedByName: input.actorName,
    sealedAt: now,
    retentionUntil: retentionUntil(now, policyState.snapshot.retentionYears),
  }).returning();

  return { seal, created: true };
}

export async function verifyPerformanceCycleSeal(input: {
  organizationId: number;
  cycleId: number;
  actorName: string;
  now?: Date;
}) {
  const [seal] = await db.select().from(performanceCycleEvidenceSeals).where(and(
    eq(performanceCycleEvidenceSeals.organizationId, input.organizationId),
    eq(performanceCycleEvidenceSeals.cycleId, input.cycleId),
  )).limit(1);
  if (!seal) throw new Error("This performance cycle has not been sealed.");

  const current = await buildPerformanceCycleSealManifest({
    organizationId: input.organizationId,
    cycleId: input.cycleId,
    generatedBy: input.actorName,
  });
  const status = current.manifestHash === seal.manifestHash ? "match" : "mismatch";
  const now = input.now ?? new Date();

  const [row] = await db.update(performanceCycleEvidenceSeals).set({
    lastVerifiedAt: now,
    lastVerificationStatus: status,
    lastVerifiedHash: current.manifestHash,
    updatedAt: now,
  }).where(eq(performanceCycleEvidenceSeals.id, seal.id)).returning();

  return {
    seal: row,
    status,
    sealedHash: seal.manifestHash,
    currentHash: current.manifestHash,
  };
}

export async function amendPerformanceCycleSeal(input: {
  organizationId: number;
  cycleId: number;
  employeeId?: number | null;
  reason: string;
  detail: string;
  actorUserId?: number | null;
  actorName: string;
}) {
  const [seal] = await db.select().from(performanceCycleEvidenceSeals).where(and(
    eq(performanceCycleEvidenceSeals.organizationId, input.organizationId),
    eq(performanceCycleEvidenceSeals.cycleId, input.cycleId),
  )).limit(1);
  if (!seal) throw new Error("This performance cycle has not been sealed.");

  const policy = seal.policySnapshot as Partial<PerformanceEvidencePolicySnapshot> | null;
  if (policy?.allowPostSealAmendments === false) {
    throw new Error("The frozen evidence policy does not allow post-seal amendments.");
  }

  const amendments = await db.select().from(performanceCycleEvidenceAmendments).where(and(
    eq(performanceCycleEvidenceAmendments.organizationId, input.organizationId),
    eq(performanceCycleEvidenceAmendments.sealId, seal.id),
  )).orderBy(asc(performanceCycleEvidenceAmendments.amendmentNumber));
  const previous = amendments.at(-1) ?? null;
  const amendmentNumber = (previous?.amendmentNumber ?? 0) + 1;
  const previousChainHash = previous?.chainHash ?? seal.manifestHash;
  const amendmentPayload = {
    sealId: seal.id,
    cycleId: seal.cycleId,
    amendmentNumber,
    employeeId: input.employeeId ?? null,
    reason: input.reason,
    detail: input.detail,
    actorName: input.actorName,
  };
  const amendmentHash = sha256(amendmentPayload);
  const chainHash = sha256({ previousChainHash, amendmentHash, amendmentNumber });

  const [row] = await db.insert(performanceCycleEvidenceAmendments).values({
    organizationId: input.organizationId,
    sealId: seal.id,
    cycleId: seal.cycleId,
    amendmentNumber,
    employeeId: input.employeeId ?? null,
    reason: input.reason,
    detail: input.detail,
    previousChainHash,
    amendmentHash,
    chainHash,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName,
  }).returning();

  await db.update(performanceCycleEvidenceSeals).set({
    latestAmendmentNumber: amendmentNumber,
    updatedAt: new Date(),
  }).where(eq(performanceCycleEvidenceSeals.id, seal.id));

  return row;
}

export async function setPerformanceCycleLegalHold(input: {
  organizationId: number;
  cycleId: number;
  legalHold: boolean;
  reason: string;
  actorUserId?: number | null;
  actorName: string;
}) {
  const [seal] = await db.select().from(performanceCycleEvidenceSeals).where(and(
    eq(performanceCycleEvidenceSeals.organizationId, input.organizationId),
    eq(performanceCycleEvidenceSeals.cycleId, input.cycleId),
  )).limit(1);
  if (!seal) throw new Error("This performance cycle has not been sealed.");

  const now = new Date();
  const [row] = await db.update(performanceCycleEvidenceSeals).set({
    legalHold: input.legalHold,
    legalHoldReason: input.legalHold ? input.reason : null,
    legalHoldSetByUserId: input.legalHold ? input.actorUserId ?? null : null,
    legalHoldSetByName: input.legalHold ? input.actorName : null,
    legalHoldSetAt: input.legalHold ? now : null,
    updatedAt: now,
  }).where(eq(performanceCycleEvidenceSeals.id, seal.id)).returning();
  return row;
}

export async function runScheduledPerformanceEvidenceSealing(input: {
  actor: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  const results = [];

  for (const organization of orgs) {
    const policyState = await loadPerformanceEvidencePolicy(organization.id);
    if (!policyState.snapshot.autoSealCompletedCycles) continue;

    const cycles = await db.select().from(performanceCycles).where(and(
      eq(performanceCycles.organizationId, organization.id),
      eq(performanceCycles.status, "completed"),
    ));
    for (const cycle of cycles) {
      const result = await sealPerformanceCycle({
        organizationId: organization.id,
        cycleId: cycle.id,
        actorName: input.actor,
        now,
      });
      if (result.created) {
        results.push({
          organizationId: organization.id,
          cycleId: cycle.id,
          sealId: result.seal.id,
          manifestHash: result.seal.manifestHash,
          policyVersion: result.seal.policyVersion,
        });
      }
    }
  }

  return results;
}
