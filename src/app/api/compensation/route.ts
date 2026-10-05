import { and, desc, eq } from "drizzle-orm";
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
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertScope, getAccess, PAYROLL_RELEASE_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { annualizePay, compaRatio, proposalBudgetDelta, proposalWithinBand, rateFromAnnual, validateBand } from "@/lib/compensation";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const COMPENSATION_MANAGER_ROLES = ["owner", "admin", "hr"] as const;

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

async function employeeInScope(userId: number, organizationId: number, employeeId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) return { error: Response.json({ error: "You do not have access to this workspace." }, { status: 403 }) };
  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId))).limit(1);
  if (!employee) return { error: Response.json({ error: "Employee not found." }, { status: 404 }) };
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return { error: Response.json({ error: scope.error }, { status: scope.status }) };
  return { access, employee };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(user.id, organizationId, COMPENSATION_MANAGER_ROLES, "Your role is not allowed to view compensation.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [staff, profiles, bands, cycles, proposals, assignments, positionRows, profilesByJob] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, organizationId)),
    db.select().from(compensationBands).where(eq(compensationBands.organizationId, organizationId)).orderBy(desc(compensationBands.id)),
    db.select().from(compensationCycles).where(eq(compensationCycles.organizationId, organizationId)).orderBy(desc(compensationCycles.startDate)),
    db.select().from(compensationProposals).where(eq(compensationProposals.organizationId, organizationId)).orderBy(desc(compensationProposals.id)),
    db.select().from(positionAssignments).where(eq(positionAssignments.organizationId, organizationId)),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId)),
  ]);

  const visibleEmployees = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));
  const payByEmployee = new Map(profiles.map((profile) => [profile.employeeId, profile]));

  return Response.json({
    access,
    employees: visibleEmployees.map((employee) => {
      const pay = payByEmployee.get(employee.id);
      const annualPay = pay ? annualizePay({
        payBasis: pay.payBasis,
        rateAmount: Number(pay.rateAmount),
        standardWorkDaysPerMonth: Number(pay.standardWorkDaysPerMonth),
        standardHoursPerDay: Number(pay.standardHoursPerDay),
      }) : null;
      return { ...employee, annualPay };
    }),
    jobProfiles: profilesByJob,
    positions: positionRows,
    assignments: assignments.filter((row) => visibleIds.has(row.employeeId)),
    bands,
    cycles,
    proposals: proposals.filter((row) => visibleIds.has(row.employeeId)).map((proposal) => {
      const band = bands.find((row) => row.id === proposal.bandId);
      return { ...proposal, compaRatio: band ? compaRatio(Number(proposal.proposedAnnual), Number(band.midpointAnnual)) : null };
    }),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(user.id, organizationId, COMPENSATION_MANAGER_ROLES, "Your role is not allowed to manage compensation.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (entityType === "band") {
    if (!access.companyWide) return Response.json({ error: "Salary bands require company-wide People access." }, { status: 403 });
    const jobProfileId = Number(body.jobProfileId);
    const locationCode = String(body.locationCode ?? "PH").trim().toUpperCase().slice(0, 80);
    const minimumAnnual = Number(body.minimumAnnual);
    const midpointAnnual = Number(body.midpointAnnual);
    const maximumAnnual = Number(body.maximumAnnual);
    const valid = validateBand({ minimumAnnual, midpointAnnual, maximumAnnual });
    if (!Number.isInteger(jobProfileId) || !valid.ok) {
      return Response.json({ error: valid.ok ? "jobProfileId is required." : valid.error }, { status: 400 });
    }
    const [profile] = await db.select({ id: jobProfiles.id }).from(jobProfiles)
      .where(and(eq(jobProfiles.id, jobProfileId), eq(jobProfiles.organizationId, organizationId))).limit(1);
    if (!profile) return Response.json({ error: "Job profile not found." }, { status: 404 });
    try {
      const [row] = await db.insert(compensationBands).values({
        organizationId, jobProfileId, locationCode, currency: "PHP",
        minimumAnnual: minimumAnnual.toFixed(2), midpointAnnual: midpointAnnual.toFixed(2), maximumAnnual: maximumAnnual.toFixed(2),
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({ organizationId, actor: user.name, action: "Compensation band created", resource: `Band #${row.id}`, metadata: { jobProfileId, locationCode } });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A band already exists for that job profile and location." }, { status: 409 });
    }
  }

  if (entityType === "cycle") {
    if (!access.companyWide) return Response.json({ error: "Compensation cycles require company-wide People access." }, { status: 403 });
    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const effectiveDate = String(body.effectiveDate ?? "");
    const budgetPool = Number(body.budgetPool ?? 0);
    if (!name || !validDate(startDate) || !validDate(endDate) || !validDate(effectiveDate) || endDate < startDate || !Number.isFinite(budgetPool) || budgetPool < 0) {
      return Response.json({ error: "Valid cycle dates, effective date, name and non-negative budget are required." }, { status: 400 });
    }
    const [row] = await db.insert(compensationCycles).values({
      organizationId, name: name.slice(0, 160), startDate, endDate, effectiveDate,
      budgetPool: budgetPool.toFixed(2), status: "active", createdByUserId: user.id, createdBy: user.name,
    }).returning();
    await recordAuditEvent({ organizationId, actor: user.name, action: "Compensation cycle created", resource: row.name, metadata: { cycleId: row.id, budgetPool } });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "proposal") {
    const employeeId = Number(body.employeeId);
    const cycleId = Number(body.cycleId);
    const bandId = Number(body.bandId);
    const proposedAnnual = Number(body.proposedAnnual);
    const reason = String(body.reason ?? "").trim();
    if (![employeeId, cycleId, bandId].every(Number.isInteger) || !Number.isFinite(proposedAnnual) || reason.length < 5) {
      return Response.json({ error: "Employee, cycle, band, proposed annual pay and a reason are required." }, { status: 400 });
    }
    const scoped = await employeeInScope(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    const [[cycle], [band], [pay]] = await Promise.all([
      db.select().from(compensationCycles).where(and(eq(compensationCycles.id, cycleId), eq(compensationCycles.organizationId, organizationId))).limit(1),
      db.select().from(compensationBands).where(and(eq(compensationBands.id, bandId), eq(compensationBands.organizationId, organizationId))).limit(1),
      db.select().from(employeePayProfiles).where(and(eq(employeePayProfiles.employeeId, employeeId), eq(employeePayProfiles.organizationId, organizationId))).limit(1),
    ]);
    if (!cycle || cycle.status !== "active") return Response.json({ error: "An active compensation cycle is required." }, { status: 409 });
    if (!band) return Response.json({ error: "Compensation band not found." }, { status: 404 });
    if (!pay) return Response.json({ error: "Employee pay profile is required before compensation review." }, { status: 409 });
    if (!proposalWithinBand(proposedAnnual, Number(band.minimumAnnual), Number(band.maximumAnnual))) {
      return Response.json({ error: "Proposed annual pay must remain inside the selected salary band." }, { status: 400 });
    }
    const currentAnnual = annualizePay({
      payBasis: pay.payBasis, rateAmount: Number(pay.rateAmount),
      standardWorkDaysPerMonth: Number(pay.standardWorkDaysPerMonth), standardHoursPerDay: Number(pay.standardHoursPerDay),
    });
    try {
      const [row] = await db.insert(compensationProposals).values({
        organizationId, cycleId, employeeId, bandId,
        currentAnnual: currentAnnual.toFixed(2), proposedAnnual: proposedAnnual.toFixed(2),
        reason: reason.slice(0, 500), status: "proposed", submittedByUserId: user.id,
      }).returning();
      await recordAuditEvent({ organizationId, actor: user.name, action: "Compensation proposal submitted", resource: `Employee #${employeeId}`, metadata: { proposalId: row.id, cycleId, currentAnnual, proposedAnnual } });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This employee already has a proposal in that compensation cycle." }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be band, cycle, or proposal." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const decision = String(body.decision ?? "");
  if (!Number.isInteger(id) || !["approved", "declined"].includes(decision)) {
    return Response.json({ error: "Proposal id and approved/declined decision are required." }, { status: 400 });
  }

  const [proposal] = await db.select().from(compensationProposals).where(eq(compensationProposals.id, id)).limit(1);
  if (!proposal) return Response.json({ error: "Compensation proposal not found." }, { status: 404 });
  const denied = await assertOrganizationRole(user.id, proposal.organizationId, PAYROLL_RELEASE_ROLES, "Only Owner/Admin may approve pay changes.");
  if (denied) return denied;
  if (proposal.status !== "proposed") return Response.json({ error: "This compensation proposal has already been decided." }, { status: 409 });

  if (decision === "declined") {
    const [row] = await db.update(compensationProposals).set({ status: "declined", approvedByUserId: user.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(compensationProposals.id, id)).returning();
    await recordAuditEvent({ organizationId: proposal.organizationId, actor: user.name, action: "Compensation proposal declined", resource: `Proposal #${id}`, metadata: { employeeId: proposal.employeeId } });
    return Response.json(row);
  }

  const [[cycle], [band], [pay], allProposals] = await Promise.all([
    db.select().from(compensationCycles).where(eq(compensationCycles.id, proposal.cycleId)).limit(1),
    db.select().from(compensationBands).where(eq(compensationBands.id, proposal.bandId)).limit(1),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.employeeId, proposal.employeeId)).limit(1),
    db.select().from(compensationProposals).where(eq(compensationProposals.cycleId, proposal.cycleId)),
  ]);
  if (!cycle || !band || !pay) return Response.json({ error: "Compensation cycle, band or employee pay profile is missing." }, { status: 409 });
  if (!proposalWithinBand(Number(proposal.proposedAnnual), Number(band.minimumAnnual), Number(band.maximumAnnual))) {
    return Response.json({ error: "Proposal is outside its salary band and cannot be approved." }, { status: 409 });
  }

  const approvedBudget = allProposals.filter((row) => row.status === "approved")
    .reduce((sum, row) => sum + Math.max(0, proposalBudgetDelta(Number(row.currentAnnual), Number(row.proposedAnnual))), 0);
  const thisDelta = Math.max(0, proposalBudgetDelta(Number(proposal.currentAnnual), Number(proposal.proposedAnnual)));
  if (approvedBudget + thisDelta > Number(cycle.budgetPool) + 0.01) {
    return Response.json({ error: "This approval would exceed the compensation cycle budget pool." }, { status: 409 });
  }

  const nextRate = rateFromAnnual({
    payBasis: pay.payBasis, annualSalary: Number(proposal.proposedAnnual),
    standardWorkDaysPerMonth: Number(pay.standardWorkDaysPerMonth), standardHoursPerDay: Number(pay.standardHoursPerDay),
  });

  const result = await db.transaction(async (tx) => {
    const [revision] = await tx.insert(employeePayRevisions).values({
      employeeId: proposal.employeeId,
      organizationId: proposal.organizationId,
      effectiveDate: cycle.effectiveDate,
      previousPayBasis: pay.payBasis,
      previousRateAmount: pay.rateAmount,
      previousStandardWorkDaysPerMonth: pay.standardWorkDaysPerMonth,
      previousStandardHoursPerDay: pay.standardHoursPerDay,
      newPayBasis: pay.payBasis,
      newRateAmount: nextRate.toFixed(2),
      newStandardWorkDaysPerMonth: pay.standardWorkDaysPerMonth,
      newStandardHoursPerDay: pay.standardHoursPerDay,
      reason: `Approved compensation cycle: ${cycle.name}`.slice(0, 240),
      createdBy: user.name,
    }).returning();

    await tx.update(employeePayProfiles).set({ rateAmount: nextRate.toFixed(2), updatedAt: new Date() })
      .where(eq(employeePayProfiles.id, pay.id));

    const [updated] = await tx.update(compensationProposals).set({
      status: "approved", approvedByUserId: user.id, approvedAt: new Date(),
      appliedPayRevisionId: revision.id, updatedAt: new Date(),
    }).where(eq(compensationProposals.id, id)).returning();
    return { updated, revision };
  });

  await recordAuditEvent({
    organizationId: proposal.organizationId,
    actor: user.name,
    action: "Compensation proposal approved and applied",
    resource: `Employee #${proposal.employeeId}`,
    metadata: { proposalId: id, cycleId: proposal.cycleId, payRevisionId: result.revision.id, effectiveDate: cycle.effectiveDate, proposedAnnual: proposal.proposedAnnual },
  });

  return Response.json(result.updated);
}
