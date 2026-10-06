import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  compensationBands,
  compensationCycles,
  compensationProposals,
  employeePayProfiles,
  employeePayRevisions,
  employees,
  jobProfiles,
  positionAssignments,
  positions,
} from "@/db/schema";
import { assertOrganizationRole, getAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  annualizePay,
  compaRatio,
  proposalBudgetDelta,
  proposalWithinBand,
  rateFromAnnual,
  validateBand,
} from "@/lib/compensation";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { profileForDate, resolvePayTimeline } from "@/lib/pay-basis";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const COMPENSATION_MANAGER_ROLES = ["owner", "admin", "hr"] as const;
const COMPENSATION_APPROVER_ROLES = ["owner", "admin"] as const;

function manilaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function assignmentForDate(
  rows: Array<typeof positionAssignments.$inferSelect>,
  effectiveDate: string,
) {
  return [...rows]
    .filter((row) =>
      String(row.effectiveFrom) <= effectiveDate
      && (!row.effectiveUntil || String(row.effectiveUntil) >= effectiveDate)
    )
    .sort((left, right) =>
      String(right.effectiveFrom).localeCompare(String(left.effectiveFrom))
      || right.id - left.id
    )[0] ?? null;
}

function bandMatchesEmployee(input: {
  band: typeof compensationBands.$inferSelect;
  employee: typeof employees.$inferSelect;
  assignment: typeof positionAssignments.$inferSelect | null;
  position: typeof positions.$inferSelect | null;
}) {
  if (!input.band.active) {
    return { ok: false as const, error: "The selected salary band is inactive." };
  }
  if (!input.assignment || !input.position) {
    return {
      ok: false as const,
      error: "The employee must have a position assignment covering the compensation effective date.",
    };
  }
  if (input.position.jobProfileId !== input.band.jobProfileId) {
    return {
      ok: false as const,
      error: "The selected salary band does not match the employee's assigned job profile on the effective date.",
    };
  }
  const location = input.band.locationCode.trim().toUpperCase();
  const employeeRegion = String(input.employee.region ?? "").trim().toUpperCase();
  if (location !== "PH" && location !== employeeRegion) {
    return {
      ok: false as const,
      error: `The selected salary band is for ${location}, but the employee's recorded region is ${employeeRegion || "unconfigured"}.`,
    };
  }
  return { ok: true as const };
}

function resolvedAnnualPay(input: {
  pay: typeof employeePayProfiles.$inferSelect;
  revisions: Array<typeof employeePayRevisions.$inferSelect>;
  asOf: string;
}) {
  const timeline = resolvePayTimeline({
    currentProfile: {
      payBasis: input.pay.payBasis,
      rateAmount: input.pay.rateAmount,
      standardWorkDaysPerMonth: input.pay.standardWorkDaysPerMonth,
      standardHoursPerDay: input.pay.standardHoursPerDay,
    },
    revisions: input.revisions.map((revision) => ({
      effectiveDate: String(revision.effectiveDate),
      previousPayBasis: revision.previousPayBasis,
      previousRateAmount: revision.previousRateAmount,
      previousStandardWorkDaysPerMonth: revision.previousStandardWorkDaysPerMonth,
      previousStandardHoursPerDay: revision.previousStandardHoursPerDay,
      newPayBasis: revision.newPayBasis,
      newRateAmount: revision.newRateAmount,
      newStandardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
      newStandardHoursPerDay: revision.newStandardHoursPerDay,
      reason: revision.reason,
    })),
    periodStart: input.asOf,
    periodEnd: input.asOf,
  });
  const profile = profileForDate(timeline, input.asOf);
  return {
    profile,
    annual: annualizePay({
      payBasis: profile.payBasis,
      rateAmount: profile.rateAmount,
      standardWorkDaysPerMonth: profile.standardWorkDaysPerMonth,
      standardHoursPerDay: profile.standardHoursPerDay,
    }),
  };
}

async function requireCompanyWideCompensationAccess(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    COMPENSATION_MANAGER_ROLES,
    "Only company-wide Owner, Admin or HR roles can access compensation governance.",
  );
  if (denied) return { denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return {
      denied: Response.json({
        error: "Compensation governance requires company-wide access because salary bands and review budgets are organization-wide controls.",
      }, { status: 403 }),
    };
  }
  return { access };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const accessResult = await requireCompanyWideCompensationAccess(user.id, organizationId);
  if ("denied" in accessResult) return accessResult.denied;

  const today = manilaDate();
  const [
    staff,
    payProfiles,
    payRevisions,
    bands,
    cycles,
    proposals,
    assignments,
    positionRows,
    jobRows,
  ] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId)),
    db.select().from(employeePayProfiles)
      .where(eq(employeePayProfiles.organizationId, organizationId)),
    db.select().from(employeePayRevisions)
      .where(eq(employeePayRevisions.organizationId, organizationId))
      .orderBy(employeePayRevisions.effectiveDate, employeePayRevisions.id),
    db.select().from(compensationBands)
      .where(eq(compensationBands.organizationId, organizationId))
      .orderBy(desc(compensationBands.id)),
    db.select().from(compensationCycles)
      .where(eq(compensationCycles.organizationId, organizationId))
      .orderBy(desc(compensationCycles.startDate), desc(compensationCycles.id)),
    db.select().from(compensationProposals)
      .where(eq(compensationProposals.organizationId, organizationId))
      .orderBy(desc(compensationProposals.id)),
    db.select().from(positionAssignments)
      .where(eq(positionAssignments.organizationId, organizationId)),
    db.select().from(positions)
      .where(eq(positions.organizationId, organizationId)),
    db.select().from(jobProfiles)
      .where(eq(jobProfiles.organizationId, organizationId)),
  ]);

  const profileByEmployee = new Map(payProfiles.map((row) => [row.employeeId, row]));
  const revisionsByEmployee = new Map<number, Array<typeof payRevisions[number]>>();
  for (const revision of payRevisions) {
    revisionsByEmployee.set(revision.employeeId, [
      ...(revisionsByEmployee.get(revision.employeeId) ?? []),
      revision,
    ]);
  }
  const positionById = new Map(positionRows.map((row) => [row.id, row]));

  return Response.json({
    access: accessResult.access,
    canApprove: COMPENSATION_APPROVER_ROLES.includes(accessResult.access!.role as "owner" | "admin"),
    employees: staff.map((employee) => {
      const pay = profileByEmployee.get(employee.id);
      const current = pay
        ? resolvedAnnualPay({
            pay,
            revisions: revisionsByEmployee.get(employee.id) ?? [],
            asOf: today,
          })
        : null;
      const assignment = assignmentForDate(
        assignments.filter((row) => row.employeeId === employee.id),
        today,
      );
      const position = assignment ? positionById.get(assignment.positionId) ?? null : null;
      return {
        ...employee,
        annualPay: current?.annual ?? null,
        currentJobProfileId: position?.jobProfileId ?? null,
      };
    }),
    jobProfiles: jobRows,
    positions: positionRows,
    assignments,
    bands,
    cycles,
    proposals: proposals.map((proposal) => {
      const band = bands.find((row) => row.id === proposal.bandId);
      return {
        ...proposal,
        compaRatio: band
          ? compaRatio(Number(proposal.proposedAnnual), Number(band.midpointAnnual))
          : null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Managing compensation");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }
  const accessResult = await requireCompanyWideCompensationAccess(user.id, organizationId);
  if ("denied" in accessResult) return accessResult.denied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `compensation-${entityType || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (entityType === "band") {
    const jobProfileId = Number(body.jobProfileId);
    const locationCode = String(body.locationCode ?? "PH").trim().toUpperCase().slice(0, 80);
    const minimumAnnual = Number(body.minimumAnnual);
    const midpointAnnual = Number(body.midpointAnnual);
    const maximumAnnual = Number(body.maximumAnnual);
    const valid = validateBand({ minimumAnnual, midpointAnnual, maximumAnnual });
    if (!Number.isInteger(jobProfileId) || !valid.ok || !locationCode) {
      return Response.json({
        error: !valid.ok ? valid.error : "jobProfileId and locationCode are required.",
      }, { status: 400 });
    }
    const [profile] = await db.select({ id: jobProfiles.id }).from(jobProfiles)
      .where(and(
        eq(jobProfiles.id, jobProfileId),
        eq(jobProfiles.organizationId, organizationId),
      )).limit(1);
    if (!profile) return Response.json({ error: "Job profile not found." }, { status: 404 });

    try {
      const [row] = await db.insert(compensationBands).values({
        organizationId,
        jobProfileId,
        locationCode,
        currency: "PHP",
        minimumAnnual: minimumAnnual.toFixed(2),
        midpointAnnual: midpointAnnual.toFixed(2),
        maximumAnnual: maximumAnnual.toFixed(2),
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Compensation band created",
        resource: `Band #${row.id}`,
        metadata: { jobProfileId, locationCode, minimumAnnual, midpointAnnual, maximumAnnual },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({
        error: "A band already exists for that job profile and location.",
      }, { status: 409 });
    }
  }

  if (entityType === "cycle") {
    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const effectiveDate = String(body.effectiveDate ?? "");
    const budgetPool = Number(body.budgetPool ?? 0);
    if (
      !name
      || !validDate(startDate)
      || !validDate(endDate)
      || !validDate(effectiveDate)
      || endDate < startDate
      || effectiveDate < startDate
      || !Number.isFinite(budgetPool)
      || budgetPool < 0
    ) {
      return Response.json({
        error: "Valid review dates, an effective date on/after review start, a name, and a non-negative budget are required.",
      }, { status: 400 });
    }
    const [row] = await db.insert(compensationCycles).values({
      organizationId,
      name: name.slice(0, 160),
      startDate,
      endDate,
      effectiveDate,
      budgetPool: budgetPool.toFixed(2),
      status: "active",
      createdByUserId: user.id,
      createdBy: user.name,
    }).returning();
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Compensation cycle created",
      resource: row.name,
      metadata: { cycleId: row.id, budgetPool, startDate, endDate, effectiveDate },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "proposal") {
    const employeeId = Number(body.employeeId);
    const cycleId = Number(body.cycleId);
    const bandId = Number(body.bandId);
    const proposedAnnual = Number(body.proposedAnnual);
    const reason = String(body.reason ?? "").trim();
    if (
      ![employeeId, cycleId, bandId].every(Number.isInteger)
      || !Number.isFinite(proposedAnnual)
      || proposedAnnual <= 0
      || reason.length < 5
    ) {
      return Response.json({
        error: "Employee, cycle, band, positive proposed annual pay, and a reason are required.",
      }, { status: 400 });
    }

    const [[employee], [cycle], [band], [pay], revisions, employeeAssignments, positionRows] = await Promise.all([
      db.select().from(employees).where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
      )).limit(1),
      db.select().from(compensationCycles).where(and(
        eq(compensationCycles.id, cycleId),
        eq(compensationCycles.organizationId, organizationId),
      )).limit(1),
      db.select().from(compensationBands).where(and(
        eq(compensationBands.id, bandId),
        eq(compensationBands.organizationId, organizationId),
      )).limit(1),
      db.select().from(employeePayProfiles).where(and(
        eq(employeePayProfiles.employeeId, employeeId),
        eq(employeePayProfiles.organizationId, organizationId),
      )).limit(1),
      db.select().from(employeePayRevisions).where(and(
        eq(employeePayRevisions.employeeId, employeeId),
        eq(employeePayRevisions.organizationId, organizationId),
      )).orderBy(employeePayRevisions.effectiveDate, employeePayRevisions.id),
      db.select().from(positionAssignments).where(and(
        eq(positionAssignments.employeeId, employeeId),
        eq(positionAssignments.organizationId, organizationId),
      )),
      db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    ]);

    if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
    if (!cycle || cycle.status !== "active") {
      return Response.json({ error: "An active compensation cycle is required." }, { status: 409 });
    }
    const today = manilaDate();
    if (today < String(cycle.startDate) || today > String(cycle.endDate)) {
      return Response.json({
        error: `The compensation cycle is outside its review window (${cycle.startDate} to ${cycle.endDate}).`,
      }, { status: 409 });
    }
    if (!band) return Response.json({ error: "Compensation band not found." }, { status: 404 });
    if (!pay) {
      return Response.json({
        error: "Employee pay profile is required before compensation review.",
      }, { status: 409 });
    }

    const assignment = assignmentForDate(employeeAssignments, String(cycle.effectiveDate));
    const position = assignment
      ? positionRows.find((row) => row.id === assignment.positionId) ?? null
      : null;
    const match = bandMatchesEmployee({ band, employee, assignment, position });
    if (!match.ok) return Response.json({ error: match.error }, { status: 409 });
    if (!proposalWithinBand(
      proposedAnnual,
      Number(band.minimumAnnual),
      Number(band.maximumAnnual),
    )) {
      return Response.json({
        error: "Proposed annual pay must remain inside the employee's applicable salary band.",
      }, { status: 400 });
    }

    const priorDate = addDays(String(cycle.effectiveDate), -1);
    const current = resolvedAnnualPay({ pay, revisions, asOf: priorDate });

    try {
      const [row] = await db.insert(compensationProposals).values({
        organizationId,
        cycleId,
        employeeId,
        bandId,
        currentAnnual: current.annual.toFixed(2),
        proposedAnnual: proposedAnnual.toFixed(2),
        reason: reason.slice(0, 500),
        status: "proposed",
        submittedByUserId: user.id,
      }).returning();
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Compensation proposal submitted",
        resource: `Employee #${employeeId}`,
        metadata: {
          proposalId: row.id,
          cycleId,
          bandId,
          currentAnnual: current.annual,
          proposedAnnual,
          effectiveDate: cycle.effectiveDate,
          positionId: position?.id ?? null,
          jobProfileId: position?.jobProfileId ?? null,
          locationCode: band.locationCode,
        },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({
        error: "This employee already has a proposal in that compensation cycle.",
      }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be band, cycle, or proposal." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Approving compensation");
  if (demoDenied) return demoDenied;

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const decision = String(body.decision ?? "");
  if (!Number.isInteger(id) || !["approved", "declined"].includes(decision)) {
    return Response.json({
      error: "Proposal id and approved/declined decision are required.",
    }, { status: 400 });
  }

  const [initialProposal] = await db.select().from(compensationProposals)
    .where(eq(compensationProposals.id, id)).limit(1);
  if (!initialProposal) {
    return Response.json({ error: "Compensation proposal not found." }, { status: 404 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    initialProposal.organizationId,
    COMPENSATION_APPROVER_ROLES,
    "Only Owner/Admin may approve pay changes.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, initialProposal.organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Compensation approval requires company-wide Owner/Admin access.",
    }, { status: 403 });
  }
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "compensation-decision",
    resourceId: initialProposal.organizationId,
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;
  if (initialProposal.submittedByUserId === user.id) {
    return Response.json({
      error: "Separation of duties: the person who submitted a compensation proposal cannot approve or decline that same proposal.",
    }, { status: 403 });
  }

  if (decision === "declined") {
    const [row] = await db.update(compensationProposals).set({
      status: "declined",
      approvedByUserId: user.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(compensationProposals.id, id),
      eq(compensationProposals.status, "proposed"),
    )).returning();
    if (!row) {
      return Response.json({
        error: "This compensation proposal has already been decided.",
      }, { status: 409 });
    }
    await recordAuditEvent({
      organizationId: initialProposal.organizationId,
      actor: user.name,
      action: "Compensation proposal declined",
      resource: `Proposal #${id}`,
      metadata: { employeeId: initialProposal.employeeId },
    });
    return Response.json(row);
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT id
        FROM compensation_cycles
        WHERE id = ${initialProposal.cycleId}
        FOR UPDATE
      `);
      await tx.execute(sql`
        SELECT id
        FROM compensation_proposals
        WHERE id = ${id}
        FOR UPDATE
      `);

      const [[proposal], [cycle], [band], [employee], [pay], revisions, employeeAssignments, positionRows, allProposals] = await Promise.all([
        tx.select().from(compensationProposals)
          .where(eq(compensationProposals.id, id)).limit(1),
        tx.select().from(compensationCycles)
          .where(eq(compensationCycles.id, initialProposal.cycleId)).limit(1),
        tx.select().from(compensationBands)
          .where(eq(compensationBands.id, initialProposal.bandId)).limit(1),
        tx.select().from(employees)
          .where(eq(employees.id, initialProposal.employeeId)).limit(1),
        tx.select().from(employeePayProfiles)
          .where(and(
            eq(employeePayProfiles.employeeId, initialProposal.employeeId),
            eq(employeePayProfiles.organizationId, initialProposal.organizationId),
          )).limit(1),
        tx.select().from(employeePayRevisions)
          .where(and(
            eq(employeePayRevisions.employeeId, initialProposal.employeeId),
            eq(employeePayRevisions.organizationId, initialProposal.organizationId),
          )).orderBy(employeePayRevisions.effectiveDate, employeePayRevisions.id),
        tx.select().from(positionAssignments)
          .where(and(
            eq(positionAssignments.employeeId, initialProposal.employeeId),
            eq(positionAssignments.organizationId, initialProposal.organizationId),
          )),
        tx.select().from(positions)
          .where(eq(positions.organizationId, initialProposal.organizationId)),
        tx.select().from(compensationProposals)
          .where(eq(compensationProposals.cycleId, initialProposal.cycleId)),
      ]);

      if (!proposal || proposal.status !== "proposed") {
        throw new Error("PROPOSAL_ALREADY_DECIDED");
      }
      if (!cycle || cycle.status !== "active") {
        throw new Error("CYCLE_NOT_ACTIVE");
      }
      const today = manilaDate();
      if (today < String(cycle.startDate) || today > String(cycle.endDate)) {
        throw new Error("CYCLE_OUTSIDE_REVIEW_WINDOW");
      }
      if (!band || !band.active || !employee || !pay) {
        throw new Error("COMPENSATION_CONTEXT_MISSING");
      }

      const assignment = assignmentForDate(employeeAssignments, String(cycle.effectiveDate));
      const position = assignment
        ? positionRows.find((row) => row.id === assignment.positionId) ?? null
        : null;
      const match = bandMatchesEmployee({ band, employee, assignment, position });
      if (!match.ok) throw new Error(`BAND_MISMATCH:${match.error}`);
      if (!proposalWithinBand(
        Number(proposal.proposedAnnual),
        Number(band.minimumAnnual),
        Number(band.maximumAnnual),
      )) {
        throw new Error("PROPOSAL_OUTSIDE_BAND");
      }

      const approvedBudget = allProposals
        .filter((row) => row.status === "approved")
        .reduce((sum, row) =>
          sum + Math.max(0, proposalBudgetDelta(
            Number(row.currentAnnual),
            Number(row.proposedAnnual),
          )), 0);
      const thisDelta = Math.max(0, proposalBudgetDelta(
        Number(proposal.currentAnnual),
        Number(proposal.proposedAnnual),
      ));
      if (approvedBudget + thisDelta > Number(cycle.budgetPool) + 0.01) {
        throw new Error("CYCLE_BUDGET_EXCEEDED");
      }

      const priorDate = addDays(String(cycle.effectiveDate), -1);
      const current = resolvedAnnualPay({ pay, revisions, asOf: priorDate });
      if (Math.abs(current.annual - Number(proposal.currentAnnual)) > 0.01) {
        throw new Error("CURRENT_PAY_CHANGED");
      }

      const duplicateRevision = revisions.find(
        (revision) => String(revision.effectiveDate) === String(cycle.effectiveDate),
      );
      if (duplicateRevision) throw new Error("PAY_REVISION_DATE_CONFLICT");

      const nextRate = rateFromAnnual({
        payBasis: current.profile.payBasis,
        annualSalary: Number(proposal.proposedAnnual),
        standardWorkDaysPerMonth: current.profile.standardWorkDaysPerMonth,
        standardHoursPerDay: current.profile.standardHoursPerDay,
      });

      const [revision] = await tx.insert(employeePayRevisions).values({
        employeeId: proposal.employeeId,
        organizationId: proposal.organizationId,
        effectiveDate: cycle.effectiveDate,
        previousPayBasis: current.profile.payBasis,
        previousRateAmount: current.profile.rateAmount.toFixed(2),
        previousStandardWorkDaysPerMonth: current.profile.standardWorkDaysPerMonth.toFixed(2),
        previousStandardHoursPerDay: current.profile.standardHoursPerDay.toFixed(2),
        newPayBasis: current.profile.payBasis,
        newRateAmount: nextRate.toFixed(2),
        newStandardWorkDaysPerMonth: current.profile.standardWorkDaysPerMonth.toFixed(2),
        newStandardHoursPerDay: current.profile.standardHoursPerDay.toFixed(2),
        reason: `Approved compensation cycle: ${cycle.name}`.slice(0, 240),
        createdBy: user.name,
      }).returning();

      const [updated] = await tx.update(compensationProposals).set({
        status: "approved",
        approvedByUserId: user.id,
        approvedAt: new Date(),
        appliedPayRevisionId: revision.id,
        updatedAt: new Date(),
      }).where(and(
        eq(compensationProposals.id, id),
        eq(compensationProposals.status, "proposed"),
      )).returning();
      if (!updated) throw new Error("PROPOSAL_ALREADY_DECIDED");

      return { updated, revision, cycle, position, band, thisDelta };
    });

    await recordAuditEvent({
      organizationId: initialProposal.organizationId,
      actor: user.name,
      action: "Compensation proposal approved and scheduled",
      resource: `Employee #${initialProposal.employeeId}`,
      metadata: {
        proposalId: id,
        cycleId: result.cycle.id,
        payRevisionId: result.revision.id,
        effectiveDate: result.cycle.effectiveDate,
        proposedAnnual: result.updated.proposedAnnual,
        budgetDelta: result.thisDelta,
        positionId: result.position?.id ?? null,
        jobProfileId: result.band.jobProfileId,
        locationCode: result.band.locationCode,
        livePayProfileMutated: false,
      },
    });

    return Response.json(result.updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PROPOSAL_ALREADY_DECIDED") {
      return Response.json({ error: "This compensation proposal has already been decided." }, { status: 409 });
    }
    if (message === "CYCLE_NOT_ACTIVE") {
      return Response.json({ error: "The compensation cycle is no longer active." }, { status: 409 });
    }
    if (message === "CYCLE_OUTSIDE_REVIEW_WINDOW") {
      return Response.json({ error: "The compensation cycle is outside its review window." }, { status: 409 });
    }
    if (message === "COMPENSATION_CONTEXT_MISSING") {
      return Response.json({ error: "Compensation cycle, band, employee or pay profile is missing." }, { status: 409 });
    }
    if (message.startsWith("BAND_MISMATCH:")) {
      return Response.json({ error: message.slice("BAND_MISMATCH:".length) }, { status: 409 });
    }
    if (message === "PROPOSAL_OUTSIDE_BAND") {
      return Response.json({ error: "Proposal is outside its applicable salary band." }, { status: 409 });
    }
    if (message === "CYCLE_BUDGET_EXCEEDED") {
      return Response.json({ error: "This approval would exceed the compensation cycle budget pool." }, { status: 409 });
    }
    if (message === "CURRENT_PAY_CHANGED") {
      return Response.json({
        error: "The employee's effective pay changed after this proposal was submitted. Create a fresh proposal before approval.",
      }, { status: 409 });
    }
    if (message === "PAY_REVISION_DATE_CONFLICT") {
      return Response.json({
        error: "Another pay revision already exists on the compensation effective date. Resolve that revision before approval.",
      }, { status: 409 });
    }
    throw error;
  }
}
