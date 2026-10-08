import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  compensationBands,
  compensationComponents,
  compensationCycles,
  compensationEvents,
  compensationProposals,
  employeeCompensationComponents,
  employeePayProfiles,
  employeePayRevisions,
  employees,
  jobGrades,
  jobProfiles,
  legalEntities,
  positionAssignments,
  positions,
  workerEffectiveChanges,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertScope, getAccess, PAYROLL_RELEASE_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { runAutomationEventSafely } from "@/lib/automation";
import {
  annualizePay,
  compaRatio,
  evaluateCompensationCycleBudget,
  proposalWithinBand,
  rangePosition,
  rateFromAnnual,
  selectCompensationBand,
  validateBand,
} from "@/lib/compensation";
import {
  applyScheduledCompensationProposal,
  cancelGovernedCompensationProposal,
  decideRecurringCompensationComponent,
  compensationPayrollConflicts,
  invalidatePayrollRunsForCompensationChange,
  philippineBusinessDate,
} from "@/lib/hcm-compensation";
import { enforceSameOriginMutation } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const COMPENSATION_MANAGER_ROLES = ["owner", "admin", "hr"] as const;
const COMPONENT_KINDS = ["allowance", "stipend", "recurring_bonus", "other_cash"] as const;
const COMPONENT_FREQUENCIES = ["monthly", "per_cutoff"] as const;

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function sameNullableNumber(left: number | null, right: number | null) {
  return left === right;
}

function dateRangesOverlap(
  leftStart: string,
  leftEnd: string | null,
  rightStart: string,
  rightEnd: string | null,
) {
  const leftFinal = leftEnd ?? "9999-12-31";
  const rightFinal = rightEnd ?? "9999-12-31";
  return leftStart <= rightFinal && rightStart <= leftFinal;
}

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

async function workerJobContext(organizationId: number, employeeId: number) {
  const [assignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    eq(positionAssignments.assignmentType, "primary"),
    isNull(positionAssignments.effectiveUntil),
  )).limit(1);
  if (!assignment) return { assignment: null, position: null, profile: null };

  const [position] = await db.select().from(positions).where(and(
    eq(positions.id, assignment.positionId),
    eq(positions.organizationId, organizationId),
  )).limit(1);
  if (!position) return { assignment, position: null, profile: null };

  const [profile] = await db.select().from(jobProfiles).where(and(
    eq(jobProfiles.id, position.jobProfileId),
    eq(jobProfiles.organizationId, organizationId),
  )).limit(1);
  return { assignment, position: position ?? null, profile: profile ?? null };
}

async function promotionTargetContext(
  organizationId: number,
  employeeId: number,
  effectiveChangeId: number,
) {
  const [change] = await db.select().from(workerEffectiveChanges).where(and(
    eq(workerEffectiveChanges.id, effectiveChangeId),
    eq(workerEffectiveChanges.organizationId, organizationId),
    eq(workerEffectiveChanges.employeeId, employeeId),
  )).limit(1);
  if (!change) return { error: "Linked HCM change was not found." as const };
  if (change.movementType !== "promotion" || !change.targetPositionId) {
    return { error: "Linked HCM change must be a promotion with a target position." as const };
  }
  if (!["pending_approval", "scheduled", "applied"].includes(change.status)) {
    return { error: "Linked promotion is not in a usable pending, scheduled, or applied state." as const };
  }

  const [position] = await db.select().from(positions).where(and(
    eq(positions.id, change.targetPositionId),
    eq(positions.organizationId, organizationId),
  )).limit(1);
  if (!position) return { error: "Linked promotion target position was not found." as const };

  const [profile] = await db.select().from(jobProfiles).where(and(
    eq(jobProfiles.id, position.jobProfileId),
    eq(jobProfiles.organizationId, organizationId),
  )).limit(1);
  if (!profile) return { error: "Linked promotion target job profile was not found." as const };

  return { change, position, profile };
}

function payStateBeforeEffectiveDate(
  pay: typeof employeePayProfiles.$inferSelect,
  revisions: Array<typeof employeePayRevisions.$inferSelect>,
  effectiveDate: string,
) {
  const sameOrLater = revisions
    .filter((revision) => String(revision.effectiveDate) >= effectiveDate)
    .sort((a, b) => String(a.effectiveDate).localeCompare(String(b.effectiveDate)) || a.id - b.id);
  if (sameOrLater.length > 0) {
    return {
      error: `A pay revision already exists effective ${sameOrLater[0].effectiveDate} or later. Resolve future pay changes before inserting an earlier compensation event.`,
    } as const;
  }

  const prior = revisions
    .filter((revision) => String(revision.effectiveDate) < effectiveDate)
    .sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)) || b.id - a.id)[0];

  return {
    payBasis: prior?.newPayBasis ?? pay.payBasis,
    rateAmount: Number(prior?.newRateAmount ?? pay.rateAmount),
    standardWorkDaysPerMonth: Number(prior?.newStandardWorkDaysPerMonth ?? pay.standardWorkDaysPerMonth),
    standardHoursPerDay: Number(prior?.newStandardHoursPerDay ?? pay.standardHoursPerDay),
  };
}

async function validateProposalBandContext(input: {
  organizationId: number;
  employee: typeof employees.$inferSelect;
  band: typeof compensationBands.$inferSelect;
  effectiveDate: string;
  workerEffectiveChangeId?: number | null;
}) {
  let jobProfileId: number | null = null;
  let gradeId: number | null = null;
  let legalEntityId = input.employee.legalEntityId;

  if (input.workerEffectiveChangeId) {
    const promotion = await promotionTargetContext(
      input.organizationId,
      input.employee.id,
      input.workerEffectiveChangeId,
    );
    if ("error" in promotion) return { error: promotion.error };
    if (String(promotion.change.effectiveDate) !== input.effectiveDate) {
      return { error: "Compensation effective date must match the linked promotion effective date." };
    }
    jobProfileId = promotion.profile.id;
    gradeId = promotion.profile.gradeId;
    legalEntityId = promotion.position.legalEntityId ?? legalEntityId;
  } else {
    const context = await workerJobContext(input.organizationId, input.employee.id);
    if (!context.profile) return { error: "Employee needs an authoritative position/job profile before compensation can be benchmarked." };
    jobProfileId = context.profile.id;
    gradeId = context.profile.gradeId;
    legalEntityId = context.position?.legalEntityId ?? legalEntityId;
  }

  const selected = selectCompensationBand([{
    ...input.band,
    effectiveFrom: String(input.band.effectiveFrom),
    effectiveUntil: input.band.effectiveUntil ? String(input.band.effectiveUntil) : null,
  }], {
    effectiveDate: input.effectiveDate,
    jobProfileId,
    gradeId,
    legalEntityId,
    locationCode: input.employee.region ?? "PH",
  });

  if (!selected) {
    return { error: "The selected salary band does not apply to this worker's job/grade, legal employer, location, and effective date." };
  }

  return { jobProfileId, gradeId, legalEntityId };
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

  const [
    staff,
    payProfiles,
    bands,
    cycles,
    proposals,
    assignments,
    positionRows,
    profilesByJob,
    grades,
    entities,
    components,
    componentAssignments,
    events,
    promotionChanges,
  ] = await Promise.all([
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, organizationId)),
    db.select().from(compensationBands).where(eq(compensationBands.organizationId, organizationId)).orderBy(desc(compensationBands.effectiveFrom), desc(compensationBands.id)),
    db.select().from(compensationCycles).where(eq(compensationCycles.organizationId, organizationId)).orderBy(desc(compensationCycles.startDate)),
    db.select().from(compensationProposals).where(eq(compensationProposals.organizationId, organizationId)).orderBy(desc(compensationProposals.id)),
    db.select().from(positionAssignments).where(and(
      eq(positionAssignments.organizationId, organizationId),
      eq(positionAssignments.assignmentType, "primary"),
      isNull(positionAssignments.effectiveUntil),
    )),
    db.select().from(positions).where(eq(positions.organizationId, organizationId)),
    db.select().from(jobProfiles).where(eq(jobProfiles.organizationId, organizationId)),
    db.select().from(jobGrades).where(eq(jobGrades.organizationId, organizationId)).orderBy(jobGrades.sequence, jobGrades.name),
    db.select().from(legalEntities).where(and(eq(legalEntities.organizationId, organizationId), eq(legalEntities.active, true))).orderBy(legalEntities.displayName),
    db.select().from(compensationComponents).where(eq(compensationComponents.organizationId, organizationId)).orderBy(compensationComponents.name),
    db.select().from(employeeCompensationComponents).where(eq(employeeCompensationComponents.organizationId, organizationId)).orderBy(desc(employeeCompensationComponents.effectiveFrom), desc(employeeCompensationComponents.id)),
    db.select().from(compensationEvents).where(eq(compensationEvents.organizationId, organizationId)).orderBy(desc(compensationEvents.effectiveDate), desc(compensationEvents.id)),
    db.select().from(workerEffectiveChanges).where(and(
      eq(workerEffectiveChanges.organizationId, organizationId),
      eq(workerEffectiveChanges.movementType, "promotion"),
      inArray(workerEffectiveChanges.status, ["pending_approval", "scheduled", "applied"]),
    )).orderBy(desc(workerEffectiveChanges.effectiveDate)),
  ]);

  const visibleEmployees = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = new Set(visibleEmployees.map((employee) => employee.id));
  const payByEmployee = new Map(payProfiles.map((profile) => [profile.employeeId, profile]));
  const assignmentByEmployee = new Map(assignments.map((row) => [row.employeeId, row]));
  const positionById = new Map(positionRows.map((row) => [row.id, row]));
  const profileById = new Map(profilesByJob.map((row) => [row.id, row]));
  const today = philippineBusinessDate();

  const enrichedEmployees = visibleEmployees.map((employee) => {
    const pay = payByEmployee.get(employee.id);
    const assignment = assignmentByEmployee.get(employee.id);
    const position = assignment ? positionById.get(assignment.positionId) ?? null : null;
    const jobProfile = position ? profileById.get(position.jobProfileId) ?? null : null;
    const annualPay = pay ? annualizePay({
      payBasis: pay.payBasis,
      rateAmount: Number(pay.rateAmount),
      standardWorkDaysPerMonth: Number(pay.standardWorkDaysPerMonth),
      standardHoursPerDay: Number(pay.standardHoursPerDay),
    }) : null;
    const band = annualPay == null ? null : selectCompensationBand(
      bands.map((row) => ({
        ...row,
        effectiveFrom: String(row.effectiveFrom),
        effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      })),
      {
        effectiveDate: today,
        jobProfileId: jobProfile?.id ?? null,
        gradeId: jobProfile?.gradeId ?? null,
        legalEntityId: position?.legalEntityId ?? employee.legalEntityId,
        locationCode: employee.region ?? "PH",
      },
    );

    return {
      ...employee,
      annualPay,
      positionId: position?.id ?? null,
      jobProfileId: jobProfile?.id ?? null,
      gradeId: jobProfile?.gradeId ?? null,
      salaryBand: band,
      compaRatio: band && annualPay != null ? compaRatio(annualPay, Number(band.midpointAnnual)) : null,
      rangePosition: band && annualPay != null ? rangePosition(annualPay, Number(band.minimumAnnual), Number(band.maximumAnnual)) : null,
    };
  });

  return Response.json({
    access,
    currentUserId: user.id,
    today,
    employees: enrichedEmployees,
    jobProfiles: profilesByJob,
    jobGrades: grades,
    legalEntities: entities,
    positions: positionRows,
    assignments: assignments.filter((row) => visibleIds.has(row.employeeId)),
    bands,
    cycles,
    proposals: proposals.filter((row) => visibleIds.has(row.employeeId)).map((proposal) => {
      const band = bands.find((row) => row.id === proposal.bandId);
      return {
        ...proposal,
        compaRatio: band ? compaRatio(Number(proposal.proposedAnnual), Number(band.midpointAnnual)) : null,
        rangePosition: band ? rangePosition(Number(proposal.proposedAnnual), Number(band.minimumAnnual), Number(band.maximumAnnual)) : null,
      };
    }),
    components,
    componentAssignments: componentAssignments.filter((row) => visibleIds.has(row.employeeId)),
    compensationEvents: events.filter((row) => visibleIds.has(row.employeeId)).slice(0, 200),
    promotions: promotionChanges.filter((row) => visibleIds.has(row.employeeId)),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const entityType = String(body.entityType ?? "");
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  const denied = await assertOrganizationRole(user.id, organizationId, COMPENSATION_MANAGER_ROLES, "Your role is not allowed to manage compensation.");
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  if (entityType === "band") {
    if (!access.companyWide) return Response.json({ error: "Salary bands require company-wide People access." }, { status: 403 });

    const jobProfileId = body.jobProfileId ? Number(body.jobProfileId) : null;
    let gradeId = body.gradeId ? Number(body.gradeId) : null;
    const legalEntityId = body.legalEntityId ? Number(body.legalEntityId) : null;
    const locationCode = String(body.locationCode ?? "PH").trim().toUpperCase().slice(0, 80) || "PH";
    const minimumAnnual = Number(body.minimumAnnual);
    const midpointAnnual = Number(body.midpointAnnual);
    const maximumAnnual = Number(body.maximumAnnual);
    const effectiveFrom = String(body.effectiveFrom ?? philippineBusinessDate()).trim();
    const effectiveUntil = body.effectiveUntil ? String(body.effectiveUntil).trim() : null;
    const valid = validateBand({ minimumAnnual, midpointAnnual, maximumAnnual });

    if ((jobProfileId !== null && !Number.isInteger(jobProfileId)) || (gradeId !== null && !Number.isInteger(gradeId)) || (legalEntityId !== null && !Number.isInteger(legalEntityId))) {
      return Response.json({ error: "Job profile, grade, and legal employer ids must be valid when supplied." }, { status: 400 });
    }
    if (!jobProfileId && !gradeId) return Response.json({ error: "A salary band must target a job grade or a specific job profile." }, { status: 400 });
    if (!valid.ok) return Response.json({ error: valid.error }, { status: 400 });
    if (!validDate(effectiveFrom) || (effectiveUntil && (!validDate(effectiveUntil) || effectiveUntil < effectiveFrom))) {
      return Response.json({ error: "Valid salary-band effective dates are required." }, { status: 400 });
    }

    if (jobProfileId) {
      const [profile] = await db.select().from(jobProfiles).where(and(
        eq(jobProfiles.id, jobProfileId),
        eq(jobProfiles.organizationId, organizationId),
        eq(jobProfiles.active, true),
      )).limit(1);
      if (!profile) return Response.json({ error: "Active job profile not found." }, { status: 404 });
      if (gradeId && profile.gradeId && gradeId !== profile.gradeId) {
        return Response.json({ error: "Selected job profile belongs to a different grade." }, { status: 400 });
      }
      gradeId ??= profile.gradeId;
    }
    if (gradeId) {
      const [grade] = await db.select().from(jobGrades).where(and(
        eq(jobGrades.id, gradeId),
        eq(jobGrades.organizationId, organizationId),
        eq(jobGrades.active, true),
      )).limit(1);
      if (!grade) return Response.json({ error: "Active job grade not found." }, { status: 404 });
    }
    if (legalEntityId) {
      const [entity] = await db.select().from(legalEntities).where(and(
        eq(legalEntities.id, legalEntityId),
        eq(legalEntities.organizationId, organizationId),
        eq(legalEntities.active, true),
      )).limit(1);
      if (!entity) return Response.json({ error: "Active legal employer not found." }, { status: 404 });
    }

    const existing = await db.select().from(compensationBands).where(eq(compensationBands.organizationId, organizationId));
    const overlap = existing.find((band) =>
      band.active
      && sameNullableNumber(band.jobProfileId, jobProfileId)
      && sameNullableNumber(band.gradeId, gradeId)
      && sameNullableNumber(band.legalEntityId, legalEntityId)
      && band.locationCode === locationCode
      && dateRangesOverlap(
        String(band.effectiveFrom),
        band.effectiveUntil ? String(band.effectiveUntil) : null,
        effectiveFrom,
        effectiveUntil,
      )
    );
    if (overlap) {
      return Response.json({
        error: `Salary band #${overlap.id} already overlaps this job/grade, legal-employer, location, and effective-date scope.`,
      }, { status: 409 });
    }

    const [row] = await db.insert(compensationBands).values({
      organizationId,
      jobProfileId,
      gradeId,
      legalEntityId,
      locationCode,
      currency: "PHP",
      minimumAnnual: minimumAnnual.toFixed(2),
      midpointAnnual: midpointAnnual.toFixed(2),
      maximumAnnual: maximumAnnual.toFixed(2),
      effectiveFrom,
      effectiveUntil,
      active: true,
      createdByUserId: user.id,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Compensation band created",
      resource: `Band #${row.id}`,
      metadata: { jobProfileId, gradeId, legalEntityId, locationCode, effectiveFrom, effectiveUntil },
    });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "cycle") {
    if (!access.companyWide) return Response.json({ error: "Compensation cycles require company-wide People access." }, { status: 403 });
    const name = String(body.name ?? "").trim();
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const effectiveDate = String(body.effectiveDate ?? "");
    const budgetPool = Number(body.budgetPool ?? 0);
    if (!name || !validDate(startDate) || !validDate(endDate) || !validDate(effectiveDate) || endDate < startDate || effectiveDate < startDate || !Number.isFinite(budgetPool) || budgetPool < 0) {
      return Response.json({ error: "Valid cycle dates, effective date, name and non-negative budget are required." }, { status: 400 });
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
    await recordAuditEvent({ organizationId, actor: user.name, action: "Compensation cycle created", resource: row.name, metadata: { cycleId: row.id, budgetPool, effectiveDate } });
    return Response.json(row, { status: 201 });
  }

  if (entityType === "component") {
    if (!access.companyWide) return Response.json({ error: "Compensation component catalogs require company-wide People access." }, { status: 403 });
    const code = String(body.code ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();
    const kind = String(body.kind ?? "allowance").trim().toLowerCase();
    const amountFrequency = String(body.amountFrequency ?? "monthly").trim().toLowerCase();
    if (!code || !name || !COMPONENT_KINDS.includes(kind as (typeof COMPONENT_KINDS)[number]) || !COMPONENT_FREQUENCIES.includes(amountFrequency as (typeof COMPONENT_FREQUENCIES)[number])) {
      return Response.json({ error: "Component code/name, supported kind, and monthly/per_cutoff frequency are required." }, { status: 400 });
    }
    try {
      const [row] = await db.insert(compensationComponents).values({
        organizationId,
        code: code.slice(0, 40),
        name: name.slice(0, 120),
        kind,
        amountFrequency,
        taxable: body.taxable !== false,
        includeInSssBase: body.includeInSssBase !== false,
        includeInPagIbigBase: body.includeInPagIbigBase !== false,
        active: true,
        createdByUserId: user.id,
      }).returning();
      await recordAuditEvent({ organizationId, actor: user.name, action: "Compensation component created", resource: row.name, metadata: { componentId: row.id, code: row.code, kind, amountFrequency } });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "A compensation component with that code or name already exists." }, { status: 409 });
    }
  }

  if (entityType === "component_assignment") {
    const employeeId = Number(body.employeeId);
    const componentId = Number(body.componentId);
    const amount = Number(body.amount);
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    const effectiveUntil = body.effectiveUntil ? String(body.effectiveUntil).trim() : null;
    const reason = String(body.reason ?? "").trim();

    if (![employeeId, componentId].every(Number.isInteger) || !Number.isFinite(amount) || amount <= 0 || !validDate(effectiveFrom) || (effectiveUntil && (!validDate(effectiveUntil) || effectiveUntil < effectiveFrom)) || reason.length < 3) {
      return Response.json({ error: "Employee, component, positive amount, valid effective dates, and reason are required." }, { status: 400 });
    }
    if (effectiveFrom < philippineBusinessDate()) {
      return Response.json({ error: "Retroactive recurring compensation components are not created here. Use an audited payroll adjustment for past periods." }, { status: 409 });
    }

    const scoped = await employeeInScope(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    const [component] = await db.select().from(compensationComponents).where(and(
      eq(compensationComponents.id, componentId),
      eq(compensationComponents.organizationId, organizationId),
      eq(compensationComponents.active, true),
    )).limit(1);
    if (!component) return Response.json({ error: "Active compensation component not found." }, { status: 404 });

    const existingAssignments = await db.select().from(employeeCompensationComponents).where(and(
      eq(employeeCompensationComponents.organizationId, organizationId),
      eq(employeeCompensationComponents.employeeId, employeeId),
      eq(employeeCompensationComponents.componentId, componentId),
      inArray(employeeCompensationComponents.status, ["pending_approval", "scheduled", "active"]),
    ));
    const overlappingAssignment = existingAssignments.find((row) => dateRangesOverlap(
      String(row.effectiveFrom),
      row.effectiveUntil ? String(row.effectiveUntil) : null,
      effectiveFrom,
      effectiveUntil,
    ));
    if (overlappingAssignment) {
      return Response.json({
        error: `This worker already has overlapping compensation component assignment #${overlappingAssignment.id}.`,
      }, { status: 409 });
    }

    try {
      const [row] = await db.insert(employeeCompensationComponents).values({
        organizationId,
        employeeId,
        componentId,
        amount: amount.toFixed(2),
        effectiveFrom,
        effectiveUntil,
        status: "pending_approval",
        reason: reason.slice(0, 240),
        requestedByUserId: user.id,
        requestedBy: user.name,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Recurring compensation component requested",
        resource: `Employee #${employeeId}`,
        metadata: { componentAssignmentId: row.id, componentId, amount, effectiveFrom, effectiveUntil },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This worker already has an active or pending assignment for that compensation component." }, { status: 409 });
    }
  }

  if (entityType === "proposal") {
    const employeeId = Number(body.employeeId);
    const cycleId = Number(body.cycleId);
    const bandId = Number(body.bandId);
    const proposedAnnual = Number(body.proposedAnnual);
    const reason = String(body.reason ?? "").trim();
    const workerEffectiveChangeId = body.workerEffectiveChangeId ? Number(body.workerEffectiveChangeId) : null;
    if (![employeeId, cycleId, bandId].every(Number.isInteger) || (workerEffectiveChangeId !== null && !Number.isInteger(workerEffectiveChangeId)) || !Number.isFinite(proposedAnnual) || proposedAnnual <= 0 || reason.length < 5) {
      return Response.json({ error: "Employee, cycle, band, proposed annual pay and a reason are required." }, { status: 400 });
    }

    const scoped = await employeeInScope(user.id, organizationId, employeeId);
    if ("error" in scoped) return scoped.error;
    const [[cycle], [band], [pay], revisions] = await Promise.all([
      db.select().from(compensationCycles).where(and(eq(compensationCycles.id, cycleId), eq(compensationCycles.organizationId, organizationId))).limit(1),
      db.select().from(compensationBands).where(and(eq(compensationBands.id, bandId), eq(compensationBands.organizationId, organizationId))).limit(1),
      db.select().from(employeePayProfiles).where(and(eq(employeePayProfiles.employeeId, employeeId), eq(employeePayProfiles.organizationId, organizationId))).limit(1),
      db.select().from(employeePayRevisions).where(and(eq(employeePayRevisions.employeeId, employeeId), eq(employeePayRevisions.organizationId, organizationId))),
    ]);

    if (!cycle || cycle.status !== "active") return Response.json({ error: "An active compensation cycle is required." }, { status: 409 });
    if (String(cycle.effectiveDate) < philippineBusinessDate()) {
      return Response.json({ error: "Past compensation-cycle effective dates require the audited pay-correction/retro workflow." }, { status: 409 });
    }
    if (!band || !band.active) return Response.json({ error: "Active compensation band not found." }, { status: 404 });
    if (!pay) return Response.json({ error: "Employee pay profile is required before compensation review." }, { status: 409 });

    const bandContext = await validateProposalBandContext({
      organizationId,
      employee: scoped.employee,
      band,
      effectiveDate: String(cycle.effectiveDate),
      workerEffectiveChangeId,
    });
    if ("error" in bandContext) return Response.json({ error: bandContext.error }, { status: 409 });

    if (!proposalWithinBand(proposedAnnual, Number(band.minimumAnnual), Number(band.maximumAnnual))) {
      return Response.json({ error: "Proposed annual pay must remain inside the selected salary band." }, { status: 400 });
    }

    const effectivePay = payStateBeforeEffectiveDate(pay, revisions, String(cycle.effectiveDate));
    if ("error" in effectivePay) return Response.json({ error: effectivePay.error }, { status: 409 });
    const currentAnnual = annualizePay(effectivePay);

    try {
      const [row] = await db.insert(compensationProposals).values({
        organizationId,
        cycleId,
        employeeId,
        bandId,
        currentAnnual: currentAnnual.toFixed(2),
        proposedAnnual: proposedAnnual.toFixed(2),
        reason: reason.slice(0, 500),
        status: "proposed",
        submittedByUserId: user.id,
        workerEffectiveChangeId,
      }).returning();

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Compensation proposal submitted",
        resource: `Employee #${employeeId}`,
        metadata: { proposalId: row.id, cycleId, currentAnnual, proposedAnnual, workerEffectiveChangeId },
      });
      return Response.json(row, { status: 201 });
    } catch {
      return Response.json({ error: "This employee already has a proposal in that compensation cycle." }, { status: 409 });
    }
  }

  return Response.json({ error: "entityType must be band, cycle, component, component_assignment, or proposal." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const entityType = String(body.entityType ?? "proposal");
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "A valid id is required." }, { status: 400 });

  if (entityType === "component_assignment") {
    const action = String(body.action ?? body.decision ?? "").trim().toLowerCase();
    if (!["approve", "decline", "cancel"].includes(action)) {
      return Response.json({ error: "Component assignment action must be approve, decline, or cancel." }, { status: 400 });
    }

    const [assignment] = await db.select().from(employeeCompensationComponents)
      .where(eq(employeeCompensationComponents.id, id))
      .limit(1);
    if (!assignment) return Response.json({ error: "Compensation component assignment not found." }, { status: 404 });

    const denied = await assertOrganizationRole(
      user.id,
      assignment.organizationId,
      action === "approve" ? PAYROLL_RELEASE_ROLES : COMPENSATION_MANAGER_ROLES,
      action === "approve" ? "Only Owner/Admin may approve recurring compensation." : "Your role cannot manage this compensation assignment.",
    );
    if (denied) return denied;

    const scoped = await employeeInScope(user.id, assignment.organizationId, assignment.employeeId);
    if ("error" in scoped) return scoped.error;

    let result;
    try {
      result = await decideRecurringCompensationComponent({
        assignmentId: id,
        organizationId: assignment.organizationId,
        employeeId: assignment.employeeId,
        decision: action as "approve" | "decline" | "cancel",
        actorUserId: user.id,
        actorName: user.name,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "COMPONENT_MAKER_CHECKER_CONFLICT") {
        return Response.json({ error: "Maker-checker control: the requester cannot approve their own recurring compensation component." }, { status: 403 });
      }
      if (code === "COMPONENT_APPROVAL_RETROACTIVE") {
        return Response.json({ error: "This recurring component is now retroactive. Cancel and handle past payroll through an audited adjustment." }, { status: 409 });
      }
      if (code === "COMPONENT_CANCELLATION_RETROACTIVE") {
        return Response.json({ error: "The scheduled component is already effective. Use an audited payroll correction instead of cancelling an earned-pay period." }, { status: 409 });
      }
      if (code === "COMPONENT_ASSIGNMENT_STALE" || code === "COMPONENT_EMPLOYEE_STALE") {
        return Response.json({ error: "The component assignment or employee record changed. Refresh and review the current state before deciding." }, { status: 409 });
      }
      if (code.startsWith("Payroll run #") || code.startsWith("Compensation cannot change")) {
        return Response.json({ error: code }, { status: 409 });
      }
      return Response.json({ error: "Recurring compensation could not be committed. Payroll runs were not invalidated; refresh and retry." }, { status: 409 });
    }

    const row = result.assignment;
    if (action !== "approve") return Response.json(row);

    // The financial decision and its audit evidence are already committed.
    // Automation is a separate side effect and cannot make an operator believe
    // the approval failed (which could otherwise invite a second submission).
    let automation: Awaited<ReturnType<typeof runAutomationEventSafely>> = [];
    let automationWarning: string | null = null;
    if (result.nextStatus === "active") {
      try {
        automation = await runAutomationEventSafely({
          organizationId: row.organizationId,
          employeeId: row.employeeId,
          trigger: "compensation.changed",
          eventKey: `compensation-component-active:${row.id}`,
          context: {
            compensationComponentAssignmentId: row.id,
            compensationComponentId: row.componentId,
            effectiveDate: row.effectiveFrom,
            eventAmount: Number(row.amount),
            compensationChangeKind: "recurring_component",
          },
        });
      } catch {
        automationWarning = "Component approved; the follow-up automation requires review.";
      }
    }

    return Response.json({
      ...row,
      automation,
      invalidatedPayrollRunIds: result.invalidatedPayrollRunIds,
      ...(automationWarning ? { automationWarning } : {}),
    });
  }

  if (entityType !== "proposal") return Response.json({ error: "Unsupported compensation entity type." }, { status: 400 });

  const decision = String(body.decision ?? body.action ?? "").trim().toLowerCase();
  if (!["approved", "declined", "cancel", "retry"].includes(decision)) {
    return Response.json({ error: "Proposal decision must be approved, declined, cancel, or retry." }, { status: 400 });
  }

  const [proposal] = await db.select().from(compensationProposals).where(eq(compensationProposals.id, id)).limit(1);
  if (!proposal) return Response.json({ error: "Compensation proposal not found." }, { status: 404 });

  const denied = await assertOrganizationRole(user.id, proposal.organizationId, PAYROLL_RELEASE_ROLES, "Only Owner/Admin may approve or change governed pay proposals.");
  if (denied) return denied;

  if (decision === "declined") {
    if (proposal.status !== "proposed") return Response.json({ error: "Only proposed compensation changes can be declined." }, { status: 409 });
    const [row] = await db.update(compensationProposals).set({
      status: "declined",
      approvedByUserId: user.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(compensationProposals.id, id), eq(compensationProposals.status, "proposed"))).returning();
    if (!row) return Response.json({ error: "This proposal was already decided." }, { status: 409 });
    await recordAuditEvent({ organizationId: proposal.organizationId, actor: user.name, action: "Compensation proposal declined", resource: `Proposal #${id}`, metadata: { employeeId: proposal.employeeId } });
    return Response.json(row);
  }

  if (decision === "cancel") {
    // Role and worker scope are validated here; the helper re-reads the entire
    // proposal, cycle, employee and revision under transaction locks.
    const scoped = await employeeInScope(user.id, proposal.organizationId, proposal.employeeId);
    if ("error" in scoped) return scoped.error;

    try {
      const result = await cancelGovernedCompensationProposal({
        proposalId: proposal.id,
        organizationId: proposal.organizationId,
        employeeId: proposal.employeeId,
        actorUserId: user.id,
        actorName: user.name,
      });
      return Response.json({
        ...result.proposal,
        invalidatedPayrollRunIds: result.invalidatedPayrollRunIds,
        cancelledPayRevisionId: result.cancelledPayRevisionId,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "COMPENSATION_CANCELLATION_STALE") {
        return Response.json({ error: "The proposal or worker state changed. Refresh before cancelling." }, { status: 409 });
      }
      if (code === "COMPENSATION_CANCELLATION_RETROACTIVE") {
        return Response.json({ error: "This salary change is already effective. Use an audited payroll correction instead of deleting earned-pay history." }, { status: 409 });
      }
      if (code === "COMPENSATION_CANCELLATION_DOWNSTREAM_REVISION") {
        return Response.json({ error: "A later pay revision depends on this salary change. Review or cancel downstream changes first." }, { status: 409 });
      }
      if (code === "COMPENSATION_CANCELLATION_REVISION_STALE") {
        return Response.json({ error: "The proposal's pay revision is missing, changed or shared. Refresh and reconcile governed pay before cancelling." }, { status: 409 });
      }
      if (/^(Payroll run #|Compensation cannot change)/.test(code)) {
        return Response.json({ error: code }, { status: 409 });
      }
      return Response.json({
        error: "Salary cancellation could not be committed. Payroll entries and approval records were not reset.",
      }, { status: 409 });
    }
  }

  if (decision === "retry") {
    if (proposal.status !== "failed") return Response.json({ error: "Only failed compensation applications can be retried." }, { status: 409 });
    const [row] = await db.update(compensationProposals).set({
      status: "scheduled",
      failure: null,
      updatedAt: new Date(),
    }).where(and(eq(compensationProposals.id, id), eq(compensationProposals.status, "failed"))).returning();
    if (!row) return Response.json({ error: "The failed proposal changed before retry." }, { status: 409 });
    try {
      const applied = await applyScheduledCompensationProposal(row.id, { actor: user.name, actorUserId: user.id });
      return Response.json({ proposal: row, applied });
    } catch (error) {
      return Response.json({ proposal: row, error: error instanceof Error ? error.message : "Compensation retry failed." }, { status: 409 });
    }
  }

  if (proposal.status !== "proposed") return Response.json({ error: "This compensation proposal has already been decided." }, { status: 409 });
  if (proposal.submittedByUserId === user.id) {
    return Response.json({ error: "Maker-checker control: the person who submitted this compensation proposal cannot approve it." }, { status: 403 });
  }

  const [[cycle], [band], [pay], employeeRows, allProposals, revisions] = await Promise.all([
    db.select().from(compensationCycles).where(eq(compensationCycles.id, proposal.cycleId)).limit(1),
    db.select().from(compensationBands).where(eq(compensationBands.id, proposal.bandId)).limit(1),
    db.select().from(employeePayProfiles).where(eq(employeePayProfiles.employeeId, proposal.employeeId)).limit(1),
    db.select().from(employees).where(and(eq(employees.id, proposal.employeeId), eq(employees.organizationId, proposal.organizationId))).limit(1),
    db.select().from(compensationProposals).where(eq(compensationProposals.cycleId, proposal.cycleId)),
    db.select().from(employeePayRevisions).where(and(eq(employeePayRevisions.employeeId, proposal.employeeId), eq(employeePayRevisions.organizationId, proposal.organizationId))),
  ]);
  const employee = employeeRows[0];
  if (!cycle || !band || !pay || !employee) return Response.json({ error: "Compensation cycle, band, employee, or pay profile is missing." }, { status: 409 });
  if (cycle.status !== "active") return Response.json({ error: "Compensation cycle is no longer active." }, { status: 409 });
  if (String(cycle.effectiveDate) < philippineBusinessDate()) {
    return Response.json({ error: "This proposal is now retroactive. Use the audited pay-correction/retro workflow instead." }, { status: 409 });
  }

  const bandContext = await validateProposalBandContext({
    organizationId: proposal.organizationId,
    employee,
    band,
    effectiveDate: String(cycle.effectiveDate),
    workerEffectiveChangeId: proposal.workerEffectiveChangeId,
  });
  if ("error" in bandContext) return Response.json({ error: bandContext.error }, { status: 409 });

  if (!proposalWithinBand(Number(proposal.proposedAnnual), Number(band.minimumAnnual), Number(band.maximumAnnual))) {
    return Response.json({ error: "Proposal is outside its salary band and cannot be approved." }, { status: 409 });
  }

  const effectivePay = payStateBeforeEffectiveDate(pay, revisions, String(cycle.effectiveDate));
  if ("error" in effectivePay) return Response.json({ error: effectivePay.error }, { status: 409 });
  const effectiveCurrentAnnual = annualizePay(effectivePay);
  if (Math.abs(effectiveCurrentAnnual - Number(proposal.currentAnnual)) > 0.01) {
    return Response.json({
      error: "The worker's pay changed after this proposal was submitted. Decline/cancel it and submit a new proposal using the current compensation state.",
      reviewedCurrentAnnual: Number(proposal.currentAnnual),
      actualCurrentAnnual: effectiveCurrentAnnual,
    }, { status: 409 });
  }

  // This preflight is for fast operator feedback only. It cannot authorize an
  // approval because other checkers may reserve the same remaining budget.
  const budgetPreflight = evaluateCompensationCycleBudget({
    budgetPool: Number(cycle.budgetPool),
    candidateProposalId: proposal.id,
    currentAnnual: Number(proposal.currentAnnual),
    proposedAnnual: Number(proposal.proposedAnnual),
    existingProposals: allProposals,
  });
  if (!budgetPreflight.allowed) {
    return Response.json({ error: "This approval would exceed the compensation cycle budget pool." }, { status: 409 });
  }

  let result;
  try {
    result = await db.transaction(async (tx) => {
      // Serialize approvals against the same compensation pool and synchronize
      // with scheduled pay activations for this employee.
      await tx.execute(sql`select pg_advisory_xact_lock(4230, ${proposal.cycleId})`);
      await tx.execute(sql`select pg_advisory_xact_lock(4221, ${proposal.employeeId})`);

      const [[liveCycle], [livePay], liveRevisions, liveProposals] = await Promise.all([
        tx.select().from(compensationCycles).where(and(
          eq(compensationCycles.id, proposal.cycleId),
          eq(compensationCycles.organizationId, proposal.organizationId),
        )).limit(1),
        tx.select().from(employeePayProfiles).where(and(
          eq(employeePayProfiles.employeeId, proposal.employeeId),
          eq(employeePayProfiles.organizationId, proposal.organizationId),
        )).limit(1),
        tx.select().from(employeePayRevisions).where(and(
          eq(employeePayRevisions.employeeId, proposal.employeeId),
          eq(employeePayRevisions.organizationId, proposal.organizationId),
        )),
        tx.select().from(compensationProposals).where(and(
          eq(compensationProposals.cycleId, proposal.cycleId),
          eq(compensationProposals.organizationId, proposal.organizationId),
        )),
      ]);
      if (!liveCycle || liveCycle.status !== "active" || String(liveCycle.effectiveDate) !== String(cycle.effectiveDate)
        || String(liveCycle.effectiveDate) < philippineBusinessDate()) {
        throw new Error("COMPENSATION_CYCLE_CHANGED");
      }
      if (!livePay) throw new Error("COMPENSATION_PAY_STATE_STALE");
      const currentPay = payStateBeforeEffectiveDate(livePay, liveRevisions, String(liveCycle.effectiveDate));
      if ("error" in currentPay || Math.abs(annualizePay(currentPay) - Number(proposal.currentAnnual)) > 0.01) {
        throw new Error("COMPENSATION_PAY_STATE_STALE");
      }

      // Lock then re-read: concurrent approvals must never each spend the same
      // budget headroom. Preflight values above are not authoritative.
      const lockedBudget = evaluateCompensationCycleBudget({
        budgetPool: Number(liveCycle.budgetPool),
        candidateProposalId: proposal.id,
        currentAnnual: Number(proposal.currentAnnual),
        proposedAnnual: Number(proposal.proposedAnnual),
        existingProposals: liveProposals,
      });
      if (!lockedBudget.allowed) throw new Error("COMPENSATION_BUDGET_EXCEEDED");

      // Recheck payroll state and reset impacted runs inside the SAME commit as
      // the approved pay revision. A failed approval cannot erase run entries.
      const affectedRuns = await compensationPayrollConflicts({
        organizationId: proposal.organizationId,
        employeeOrgUnitId: employee.orgUnitId,
        effectiveFrom: String(liveCycle.effectiveDate),
        effectiveUntil: null,
      }, tx);
      const invalidatedPayrollRunIds = await invalidatePayrollRunsForCompensationChange(
        proposal.organizationId,
        affectedRuns,
        tx,
      );
      const nextRate = rateFromAnnual({
        payBasis: currentPay.payBasis,
        annualSalary: Number(proposal.proposedAnnual),
        standardWorkDaysPerMonth: currentPay.standardWorkDaysPerMonth,
        standardHoursPerDay: currentPay.standardHoursPerDay,
      });

      const [revision] = await tx.insert(employeePayRevisions).values({
        employeeId: proposal.employeeId,
        organizationId: proposal.organizationId,
        effectiveDate: String(liveCycle.effectiveDate),
        previousPayBasis: currentPay.payBasis,
        previousRateAmount: currentPay.rateAmount.toFixed(2),
        previousStandardWorkDaysPerMonth: currentPay.standardWorkDaysPerMonth.toFixed(2),
        previousStandardHoursPerDay: currentPay.standardHoursPerDay.toFixed(2),
        newPayBasis: currentPay.payBasis,
        newRateAmount: nextRate.toFixed(2),
        newStandardWorkDaysPerMonth: currentPay.standardWorkDaysPerMonth.toFixed(2),
        newStandardHoursPerDay: currentPay.standardHoursPerDay.toFixed(2),
        reason: `Approved compensation cycle: ${cycle.name}`.slice(0, 240),
        createdBy: user.name,
      }).returning();

      const [updated] = await tx.update(compensationProposals).set({
        status: "scheduled",
        approvedByUserId: user.id,
        approvedAt: new Date(),
        scheduledAt: new Date(),
        appliedPayRevisionId: revision.id,
        failure: null,
        updatedAt: new Date(),
      }).where(and(
        eq(compensationProposals.id, id),
        eq(compensationProposals.status, "proposed"),
      )).returning();
      if (!updated) throw new Error("PROPOSAL_DECISION_CONFLICT");

      await tx.insert(compensationEvents).values({
        organizationId: proposal.organizationId,
        employeeId: proposal.employeeId,
        eventType: "salary_change_scheduled",
        effectiveDate: String(cycle.effectiveDate),
        previousAnnual: annualizePay(currentPay).toFixed(2),
        newAnnual: Number(proposal.proposedAnnual).toFixed(2),
        bandId: proposal.bandId,
        proposalId: proposal.id,
        payRevisionId: revision.id,
        compaRatioBefore: compaRatio(effectiveCurrentAnnual, Number(band.midpointAnnual))?.toFixed(4) ?? null,
        compaRatioAfter: compaRatio(Number(proposal.proposedAnnual), Number(band.midpointAnnual))?.toFixed(4) ?? null,
        metadata: {
          compensationCycleId: cycle.id,
          workerEffectiveChangeId: proposal.workerEffectiveChangeId,
          invalidatedPayrollRunIds,
        },
        actorUserId: user.id,
        actorName: user.name,
      });

      return { updated, revision, invalidatedPayrollRunIds };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown compensation approval failure.";
    if (message === "PROPOSAL_DECISION_CONFLICT") {
      return Response.json({ error: "This compensation proposal changed while approval was being saved." }, { status: 409 });
    }
    if (message === "COMPENSATION_BUDGET_EXCEEDED") {
      return Response.json({ error: "Another approval used the compensation budget. Refresh the cycle and review the remaining pool." }, { status: 409 });
    }
    if (message === "COMPENSATION_CYCLE_CHANGED" || message === "COMPENSATION_PAY_STATE_STALE") {
      return Response.json({ error: "The compensation cycle or employee pay state changed. Refresh and submit a new approval review." }, { status: 409 });
    }
    if (/^(Payroll run #|Compensation cannot change)/.test(message)) {
      return Response.json({ error: message }, { status: 409 });
    }
    return Response.json({ error: "Compensation approval could not be committed. Payroll state was not invalidated; refresh and review pay revisions." }, { status: 409 });
  }

  const invalidatedPayrollRunIds = result.invalidatedPayrollRunIds;
  await recordAuditEvent({
    organizationId: proposal.organizationId,
    actor: user.name,
    action: "Compensation proposal approved and scheduled",
    resource: `Employee #${proposal.employeeId}`,
    metadata: {
      proposalId: id,
      cycleId: proposal.cycleId,
      payRevisionId: result.revision.id,
      effectiveDate: cycle.effectiveDate,
      proposedAnnual: proposal.proposedAnnual,
      workerEffectiveChangeId: proposal.workerEffectiveChangeId,
      invalidatedPayrollRunIds,
    },
  });

  if (String(cycle.effectiveDate) <= philippineBusinessDate()) {
    try {
      const applied = await applyScheduledCompensationProposal(result.updated.id, { actor: user.name, actorUserId: user.id });
      return Response.json({ proposal: result.updated, applied });
    } catch (error) {
      return Response.json({ proposal: result.updated, error: error instanceof Error ? error.message : "Approved compensation could not be applied." }, { status: 409 });
    }
  }

  return Response.json({ ...result.updated, scheduled: true, invalidatedPayrollRunIds });
}
