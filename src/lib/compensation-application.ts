import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  compensationCycles,
  compensationProposals,
  employeePayProfiles,
  employeePayRevisions,
  schedulerState,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";

const JOB_NAME = "compensation-effective-date-application";
const INTERVAL_MS = 60 * 60 * 1000;
let lastLocalCheck = 0;

export function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function profileMatchesRevisionPrevious(
  profile: typeof employeePayProfiles.$inferSelect,
  revision: typeof employeePayRevisions.$inferSelect,
) {
  return (
    profile.payBasis === revision.previousPayBasis
    && Math.abs(Number(profile.rateAmount) - Number(revision.previousRateAmount)) < 0.01
    && Math.abs(Number(profile.standardWorkDaysPerMonth) - Number(revision.previousStandardWorkDaysPerMonth)) < 0.001
    && Math.abs(Number(profile.standardHoursPerDay) - Number(revision.previousStandardHoursPerDay)) < 0.001
  );
}

function profileMatchesRevisionNew(
  profile: typeof employeePayProfiles.$inferSelect,
  revision: typeof employeePayRevisions.$inferSelect,
) {
  return (
    profile.payBasis === revision.newPayBasis
    && Math.abs(Number(profile.rateAmount) - Number(revision.newRateAmount)) < 0.01
    && Math.abs(Number(profile.standardWorkDaysPerMonth) - Number(revision.newStandardWorkDaysPerMonth)) < 0.001
    && Math.abs(Number(profile.standardHoursPerDay) - Number(revision.newStandardHoursPerDay)) < 0.001
  );
}

export async function applyDueCompensationProposal(
  proposalId: number,
  actor = "System compensation scheduler",
) {
  const [proposal] = await db.select().from(compensationProposals)
    .where(eq(compensationProposals.id, proposalId))
    .limit(1);
  if (!proposal) return { applied: false as const, reason: "missing-proposal" as const };
  if (proposal.status === "applied") return { applied: false as const, reason: "already-applied" as const };
  if (proposal.status !== "approved" || proposal.appliedPayRevisionId == null) {
    return { applied: false as const, reason: "not-approved-for-application" as const };
  }

  const [cycle] = await db.select().from(compensationCycles)
    .where(eq(compensationCycles.id, proposal.cycleId))
    .limit(1);
  if (!cycle) return { applied: false as const, reason: "missing-cycle" as const };
  if (String(cycle.effectiveDate) > manilaToday()) {
    return { applied: false as const, reason: "not-effective-yet" as const };
  }

  const [[revision], [profile]] = await Promise.all([
    db.select().from(employeePayRevisions)
      .where(and(
        eq(employeePayRevisions.id, proposal.appliedPayRevisionId),
        eq(employeePayRevisions.organizationId, proposal.organizationId),
        eq(employeePayRevisions.employeeId, proposal.employeeId),
      ))
      .limit(1),
    db.select().from(employeePayProfiles)
      .where(and(
        eq(employeePayProfiles.organizationId, proposal.organizationId),
        eq(employeePayProfiles.employeeId, proposal.employeeId),
      ))
      .limit(1),
  ]);

  if (!revision || !profile) {
    return { applied: false as const, reason: "missing-pay-chain" as const };
  }

  if (!profileMatchesRevisionPrevious(profile, revision)) {
    if (profileMatchesRevisionNew(profile, revision)) {
      const [updated] = await db.update(compensationProposals).set({
        status: "applied",
        updatedAt: new Date(),
      }).where(eq(compensationProposals.id, proposal.id)).returning();
      return { applied: true as const, proposal: updated, alreadyCurrent: true };
    }

    await recordAuditEvent({
      organizationId: proposal.organizationId,
      actor,
      action: "Compensation application blocked by pay-profile drift",
      resource: `Proposal #${proposal.id}`,
      metadata: {
        employeeId: proposal.employeeId,
        payRevisionId: revision.id,
        effectiveDate: revision.effectiveDate,
        expectedPreviousRate: revision.previousRateAmount,
        currentRate: profile.rateAmount,
      },
    });
    return { applied: false as const, reason: "pay-profile-drift" as const };
  }

  const result = await db.transaction(async (tx) => {
    await tx.update(employeePayProfiles).set({
      payBasis: revision.newPayBasis,
      rateAmount: revision.newRateAmount,
      standardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
      standardHoursPerDay: revision.newStandardHoursPerDay,
      updatedAt: new Date(),
    }).where(eq(employeePayProfiles.id, profile.id));

    const [updated] = await tx.update(compensationProposals).set({
      status: "applied",
      updatedAt: new Date(),
    }).where(and(
      eq(compensationProposals.id, proposal.id),
      eq(compensationProposals.status, "approved"),
    )).returning();

    return updated;
  });

  if (!result) return { applied: false as const, reason: "concurrent-change" as const };

  await recordAuditEvent({
    organizationId: proposal.organizationId,
    actor,
    action: "Approved compensation change became effective",
    resource: `Employee #${proposal.employeeId}`,
    metadata: {
      proposalId: proposal.id,
      cycleId: proposal.cycleId,
      payRevisionId: revision.id,
      effectiveDate: revision.effectiveDate,
      newRateAmount: revision.newRateAmount,
    },
  });

  return { applied: true as const, proposal: result, alreadyCurrent: false };
}

export async function applyDueCompensationProposals(
  actor = "System compensation scheduler",
) {
  const today = manilaToday();
  const rows = await db.select({
    proposalId: compensationProposals.id,
  }).from(compensationProposals)
    .innerJoin(compensationCycles, eq(compensationProposals.cycleId, compensationCycles.id))
    .where(and(
      eq(compensationProposals.status, "approved"),
      lte(compensationCycles.effectiveDate, today),
    ))
    .orderBy(asc(compensationCycles.effectiveDate), asc(compensationProposals.id));

  const results = [];
  for (const row of rows) {
    results.push(await applyDueCompensationProposal(row.proposalId, actor));
  }
  return results;
}

export async function runScheduledCompensationApplications(options?: {
  force?: boolean;
  actor?: string;
}) {
  const now = new Date();
  if (!options?.force && Date.now() - lastLocalCheck < 60_000) {
    return { skipped: true as const, reason: "local-interval" as const };
  }
  lastLocalCheck = Date.now();

  const [state] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, JOB_NAME))
    .limit(1);
  if (!options?.force && state?.lastRunAt && now.getTime() - state.lastRunAt.getTime() < INTERVAL_MS) {
    return { skipped: true as const, reason: "scheduler-interval" as const, lastRunAt: state.lastRunAt };
  }

  const results = await applyDueCompensationProposals(options?.actor);
  const payload = {
    at: now.toISOString(),
    checked: results.length,
    applied: results.filter((result) => result.applied).length,
    blocked: results.filter((result) => !result.applied && result.reason === "pay-profile-drift").length,
  };

  if (state) {
    await db.update(schedulerState).set({
      lastRunAt: now,
      lastResult: payload,
    }).where(eq(schedulerState.id, state.id));
  } else {
    await db.insert(schedulerState).values({
      jobName: JOB_NAME,
      lastRunAt: now,
      lastResult: payload,
    });
  }

  return { skipped: false as const, ...payload };
}
