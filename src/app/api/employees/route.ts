import { encryptBankAccount, maskBankAccount } from "@/lib/bank-account-crypto";
import { encryptGovernmentId, maskGovernmentId } from "@/lib/government-id-crypto";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  employeePayProfiles,
  employeePayRevisions,
  employeeRestDayRevisions,
  employeePayRetroAdjustments,
  employees,
  legalEntities,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { seedProvisioning } from "@/lib/provisioning";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { fixedMonthlyBasicForTimeline, resolvePayProfile, resolvePayTimeline } from "@/lib/pay-basis";
import { REST_DAY_NAMES } from "@/lib/payroll-rules";
import { runLifecycleAutomations } from "@/lib/automation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });
  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can view the employee directory.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  await ensureEmployeePayProfiles(organizationId);
  const [rows, payProfiles] = await Promise.all([
    db.select().from(employees)
      .where(eq(employees.organizationId, organizationId))
      .orderBy(asc(employees.id)),
    db.select().from(employeePayProfiles)
      .where(eq(employeePayProfiles.organizationId, organizationId)),
  ]);
  const payByEmployee = new Map(payProfiles.map((profile) => [profile.employeeId, profile]));
  const visibleRows = access.companyWide
    ? rows
    : rows.filter((employee) => employee.orgUnitId === access.orgUnitId);

  return Response.json(visibleRows.map((employee) => {
    const profile = payByEmployee.get(employee.id);
    return {
      ...employee,
      bankAccount: maskBankAccount(employee.bankAccount),
      tin: maskGovernmentId(employee.tin),
      tinBranchCode: maskGovernmentId(employee.tinBranchCode),
      sssNo: maskGovernmentId(employee.sssNo),
      philHealthNo: maskGovernmentId(employee.philHealthNo),
      pagIbigNo: maskGovernmentId(employee.pagIbigNo),
      payBasis: profile?.payBasis ?? "monthly",
      payRate: profile?.rateAmount ?? employee.basicRate,
      standardWorkDaysPerMonth: profile?.standardWorkDaysPerMonth ?? "22.00",
      standardHoursPerDay: profile?.standardHoursPerDay ?? "8.00",
    };
  }));
}

/**
 * Creates an employee and bootstraps Rippling-style onboarding: the standard
 * provisioning checklist is generated immediately so IT/HR tasks are tracked
 * from day one, and an optional asset is assigned in the same action.
 */
export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const firstName = String(body.firstName ?? "").trim();
  const middleName = String(body.middleName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const title = String(body.title ?? "").trim();
  const rateAmount = Number(body.rateAmount ?? body.basicRate);
  const startDate = String(body.startDate ?? "").trim();
  const bankAccount = String(body.bankAccount ?? "").trim();
  const bankCode = String(body.bankCode ?? "").trim().toUpperCase();
  const mobile = String(body.mobile ?? "").trim();
  const pagIbigVoluntaryMonthly = Number(body.pagIbigVoluntaryMonthly ?? 0);
  if (!Number.isFinite(pagIbigVoluntaryMonthly) || pagIbigVoluntaryMonthly < 0) {
    return Response.json({ error: "Voluntary Pag-IBIG contribution must be zero or greater." }, { status: 422 });
  }

  if (Boolean(bankAccount) !== Boolean(bankCode)) {
    return Response.json({
      error: "Bank account and bank code must be provided together for payroll payout.",
    }, { status: 422 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can create employee records.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const employeeOrgUnitId = access.companyWide ? null : access.orgUnitId;

  const requestedLegalEntityId = body.legalEntityId == null || body.legalEntityId === ""
    ? null
    : Number(body.legalEntityId);
  if (requestedLegalEntityId !== null && (!Number.isInteger(requestedLegalEntityId) || requestedLegalEntityId <= 0)) {
    return Response.json({ error: "Invalid legal employer." }, { status: 400 });
  }
  const entityRows = await db.select().from(legalEntities).where(and(
    eq(legalEntities.organizationId, organizationId),
    eq(legalEntities.active, true),
  ));
  const selectedLegalEntity = requestedLegalEntityId
    ? entityRows.find((entity) => entity.id === requestedLegalEntityId)
    : entityRows.find((entity) => entity.primaryEntity) ?? entityRows[0];
  if (!selectedLegalEntity) {
    return Response.json({ error: "Create an active legal employer before adding employees." }, { status: 422 });
  }

  let payProfile;
  try {
    payProfile = resolvePayProfile({
      payBasis: String(body.payBasis ?? "monthly"),
      rateAmount,
      standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? 22),
      standardHoursPerDay: Number(body.standardHoursPerDay ?? 8),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pay profile is invalid." }, { status: 400 });
  }

  if (!firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return Response.json({ error: "firstName, lastName and YYYY-MM-DD startDate are required." }, { status: 400 });
  }

  const restDayInput = String(body.restDay ?? "").trim();
  if (restDayInput && !REST_DAY_NAMES.includes(restDayInput as (typeof REST_DAY_NAMES)[number])) {
    return Response.json({ error: `restDay must be empty or one of: ${REST_DAY_NAMES.join(", ")}.` }, { status: 400 });
  }

  await ensureEmployeePayProfiles(organizationId);

  const existingRows = await db.select({ id: employees.id }).from(employees).where(eq(employees.organizationId, organizationId));
  const existing = existingRows.length;
  const employeeNo = String(body.employeeNo ?? `EMP-${String(existing + 1).padStart(4, "0")}`).trim();

  const [created] = await db.insert(employees).values({
    organizationId,
    orgUnitId: employeeOrgUnitId,
    legalEntityId: selectedLegalEntity.id,
    employeeNo,
    firstName,
    middleName: middleName || null,
    lastName,
    title: title || "Staff",
    employmentType: String(body.employmentType ?? "Regular"),
    status: "Active",
    avatarInitials: `${firstName[0] ?? "?"}${lastName[0] ?? "?"}`.toUpperCase(),
    basicRate: payProfile.monthlyEquivalent.toFixed(2),
    mwe: Boolean(body.mwe),
    region: String(body.region ?? "NCR"),
    restDay: restDayInput || null,
    email: email || null,
    bankAccount: encryptBankAccount(bankAccount),
    bankCode: bankCode || null,
    mobile: mobile || null,
    tin: encryptGovernmentId(String(body.tin ?? "").trim() || null, { required: process.env.NODE_ENV === "production" }),
    tinBranchCode: encryptGovernmentId(
      String(body.tinBranchCode ?? "").replace(/\D/g, "").padStart(4, "0").slice(-4) || null,
      { required: process.env.NODE_ENV === "production" },
    ),
    sssNo: encryptGovernmentId(String(body.sssNo ?? "").trim() || null, { required: process.env.NODE_ENV === "production" }),
    philHealthNo: encryptGovernmentId(String(body.philHealthNo ?? "").trim() || null, { required: process.env.NODE_ENV === "production" }),
    pagIbigNo: encryptGovernmentId(String(body.pagIbigNo ?? "").trim() || null, { required: process.env.NODE_ENV === "production" }),
    pagIbigVoluntaryMonthly: pagIbigVoluntaryMonthly.toFixed(2),
    nationality: String(body.nationality ?? "Filipino").trim() || "Filipino",
    startDate,
  }).returning();

  await db.insert(employeePayProfiles).values({
    employeeId: created.id,
    organizationId,
    payBasis: payProfile.payBasis,
    rateAmount: payProfile.rateAmount.toFixed(2),
    standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth.toFixed(2),
    standardHoursPerDay: payProfile.standardHoursPerDay.toFixed(2),
  }).onConflictDoUpdate({
    target: employeePayProfiles.employeeId,
    set: {
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount.toFixed(2),
      standardWorkDaysPerMonth: payProfile.standardWorkDaysPerMonth.toFixed(2),
      standardHoursPerDay: payProfile.standardHoursPerDay.toFixed(2),
      updatedAt: new Date(),
    },
  });

  const onboarding = await seedProvisioning(organizationId, created.id, "onboarding");

  let assignedAsset = null;
  if (body.assetName) {
    const [asset] = await db.insert(assets).values({
      organizationId,
      employeeId: created.id,
      type: String(body.assetType ?? "Laptop"),
      name: String(body.assetName),
      serialNumber: body.serialNumber ? String(body.serialNumber) : null,
      status: "assigned",
      assignedOn: startDate,
    }).returning();
    assignedAsset = asset;
  }

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee created with onboarding",
    resource: `${created.firstName} ${created.lastName} (${created.employeeNo})`,
    metadata: {
      employeeId: created.id,
      onboardingTasks: onboarding.length,
      asset: assignedAsset?.name ?? null,
      payBasis: payProfile.payBasis,
      rateAmount: payProfile.rateAmount,
      monthlyEquivalent: payProfile.monthlyEquivalent,
      payoutDetailsProvided: Boolean(bankAccount && bankCode),
      legalEntityId: selectedLegalEntity.id,
      legalEntityCode: selectedLegalEntity.code,
    },
  });

  const automation = await runLifecycleAutomations({
    organizationId,
    employeeId: created.id,
    trigger: "employee.hired",
    eventKey: "employee-create:" + created.id,
    context: {
      orgUnitId: created.orgUnitId,
      employmentType: created.employmentType,
      title: created.title,
    },
  });

  return Response.json({
    employee: {
      ...created,
      bankAccount: maskBankAccount(created.bankAccount),
      tin: maskGovernmentId(created.tin),
      tinBranchCode: maskGovernmentId(created.tinBranchCode),
      sssNo: maskGovernmentId(created.sssNo),
      philHealthNo: maskGovernmentId(created.philHealthNo),
      pagIbigNo: maskGovernmentId(created.pagIbigNo),
    },
    onboarding,
    automation,
    asset: assignedAsset,
  }, { status: 201 });
}


/**
 * Updates government identity fields for an existing employee. These values are
 * deliberately editable after onboarding because real employer records are
 * often completed after the employee account itself is created.
 */
export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);

  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can update government identity records.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees)
    .where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    ))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  const access = await getAccess(user.id, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  await ensureEmployeePayProfiles(organizationId);
  const [existingPayProfile] = await db.select().from(employeePayProfiles)
    .where(eq(employeePayProfiles.employeeId, employeeId))
    .limit(1);

  const clean = (value: unknown) => {
    if (value === undefined) return undefined;
    const text = String(value ?? "").trim();
    return text || null;
  };

  const wantsStartDateUpdate = body.startDate !== undefined;
  let nextStartDate: string | undefined;
  if (wantsStartDateUpdate) {
    nextStartDate = String(body.startDate ?? "").trim();
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(nextStartDate)) {
      return Response.json({ error: "Employment start date must use YYYY-MM-DD." }, { status: 400 });
    }
    const todayPh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    if (employee.status.toLowerCase() === "active" && nextStartDate > todayPh) {
      return Response.json({ error: "An active employee cannot have a future employment start date." }, { status: 422 });
    }

    if (nextStartDate !== String(employee.startDate)) {
      const [releasedBeforeStart, payRevisionBeforeStart, scheduleRevisionBeforeStart] = await Promise.all([
        db.select({ runId: payrollRuns.id, periodEnd: payrollRuns.periodEnd })
          .from(payrollEntries)
          .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
          .where(and(
            eq(payrollEntries.employeeId, employeeId),
            eq(payrollRuns.organizationId, organizationId),
            eq(payrollRuns.status, "Released"),
            lt(payrollRuns.periodEnd, nextStartDate),
          ))
          .limit(1),
        db.select({ id: employeePayRevisions.id, effectiveDate: employeePayRevisions.effectiveDate })
          .from(employeePayRevisions)
          .where(and(
            eq(employeePayRevisions.organizationId, organizationId),
            eq(employeePayRevisions.employeeId, employeeId),
            lt(employeePayRevisions.effectiveDate, nextStartDate),
          ))
          .limit(1),
        db.select({ id: employeeRestDayRevisions.id, effectiveDate: employeeRestDayRevisions.effectiveDate })
          .from(employeeRestDayRevisions)
          .where(and(
            eq(employeeRestDayRevisions.organizationId, organizationId),
            eq(employeeRestDayRevisions.employeeId, employeeId),
            lt(employeeRestDayRevisions.effectiveDate, nextStartDate),
          ))
          .limit(1),
      ]);

      if (releasedBeforeStart.length) {
        return Response.json({
          error: `Start date cannot move after released payroll history ending ${releasedBeforeStart[0].periodEnd}.`,
        }, { status: 409 });
      }
      if (payRevisionBeforeStart.length || scheduleRevisionBeforeStart.length) {
        return Response.json({
          error: "Start date cannot move after an existing effective-dated pay or work-schedule change.",
        }, { status: 409 });
      }
    }
  }
  const effectiveStartDate = nextStartDate ?? String(employee.startDate);

  const wantsPayUpdate = [
    body.payBasis,
    body.rateAmount,
    body.basicRate,
    body.standardWorkDaysPerMonth,
    body.standardHoursPerDay,
  ].some((value) => value !== undefined);

  let nextPayProfile = null;
  let payEffectiveDate: string | null = null;
  let payChangeReason: string | null = null;
  if (wantsPayUpdate) {
    payEffectiveDate = String(body.payEffectiveDate ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date())).trim();
    payChangeReason = String(body.payChangeReason ?? "Pay adjustment").trim();
    const todayPh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payEffectiveDate)) {
      return Response.json({ error: "Pay effective date must use YYYY-MM-DD." }, { status: 400 });
    }
    if (payEffectiveDate < effectiveStartDate) {
      return Response.json({ error: "Pay effective date cannot be before the employee start date." }, { status: 400 });
    }
    if (payEffectiveDate > todayPh) {
      return Response.json({ error: "Future-dated pay changes are not applied early. Use the effective date when it becomes active." }, { status: 400 });
    }
    if (!payChangeReason) {
      return Response.json({ error: "A reason is required for an effective-dated pay change." }, { status: 400 });
    }

    const [latestRevision] = await db.select().from(employeePayRevisions)
      .where(and(
        eq(employeePayRevisions.organizationId, organizationId),
        eq(employeePayRevisions.employeeId, employeeId),
      ))
      .orderBy(desc(employeePayRevisions.effectiveDate), desc(employeePayRevisions.id))
      .limit(1);
    if (latestRevision && payEffectiveDate < String(latestRevision.effectiveDate)) {
      return Response.json({
        error: `This employee already has a later pay change effective ${latestRevision.effectiveDate}. Add changes in chronological order so the audit chain stays unambiguous.`,
      }, { status: 409 });
    }

    try {
      nextPayProfile = resolvePayProfile({
        payBasis: String(body.payBasis ?? existingPayProfile?.payBasis ?? "monthly"),
        rateAmount: Number(body.rateAmount ?? body.basicRate ?? existingPayProfile?.rateAmount ?? employee.basicRate),
        standardWorkDaysPerMonth: Number(body.standardWorkDaysPerMonth ?? existingPayProfile?.standardWorkDaysPerMonth ?? 22),
        standardHoursPerDay: Number(body.standardHoursPerDay ?? existingPayProfile?.standardHoursPerDay ?? 8),
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Pay profile is invalid." }, { status: 400 });
    }
  }

  const wantsRestDayUpdate = body.restDay !== undefined;
  let nextRestDay: string | null | undefined;
  let restDayEffectiveDate: string | null = null;
  let restDayChangeReason: string | null = null;
  let latestRestDayRevision: typeof employeeRestDayRevisions.$inferSelect | null = null;
  if (wantsRestDayUpdate) {
    const restDayInput = String(body.restDay ?? "").trim();
    if (restDayInput && !REST_DAY_NAMES.includes(restDayInput as (typeof REST_DAY_NAMES)[number])) {
      return Response.json({ error: `restDay must be empty or one of: ${REST_DAY_NAMES.join(", ")}.` }, { status: 400 });
    }
    nextRestDay = restDayInput || null;

    const todayPh = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    restDayEffectiveDate = String(body.restDayEffectiveDate ?? todayPh).trim();
    restDayChangeReason = String(body.restDayChangeReason ?? "Work schedule change").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(restDayEffectiveDate)) {
      return Response.json({ error: "Rest-day effective date must use YYYY-MM-DD." }, { status: 400 });
    }
    if (restDayEffectiveDate < effectiveStartDate) {
      return Response.json({ error: "Rest-day effective date cannot be before the employee start date." }, { status: 400 });
    }
    if (restDayEffectiveDate > todayPh) {
      return Response.json({ error: "Future rest-day changes are not applied early. Save the change on its effective date." }, { status: 400 });
    }
    if (!restDayChangeReason) {
      return Response.json({ error: "A reason is required for a rest-day change." }, { status: 400 });
    }

    const [latest] = await db.select().from(employeeRestDayRevisions)
      .where(and(
        eq(employeeRestDayRevisions.organizationId, organizationId),
        eq(employeeRestDayRevisions.employeeId, employeeId),
      ))
      .orderBy(desc(employeeRestDayRevisions.effectiveDate), desc(employeeRestDayRevisions.id))
      .limit(1);
    latestRestDayRevision = latest ?? null;
    if (latest && restDayEffectiveDate < String(latest.effectiveDate)) {
      return Response.json({
        error: `This employee already has a later rest-day change effective ${latest.effectiveDate}. Add schedule changes in chronological order so historical payroll stays unambiguous.`,
      }, { status: 409 });
    }
  }
  const changedRestDay = wantsRestDayUpdate && nextRestDay !== employee.restDay;

  const replacementBankAccount =
    typeof body.bankAccount === "string" && body.bankAccount.trim()
      ? body.bankAccount.trim()
      : null;
  const wantsPayoutUpdate =
    body.bankAccount !== undefined ||
    body.bankCode !== undefined ||
    body.mobile !== undefined;
  const nextBankCode =
    body.bankCode === undefined ? employee.bankCode : String(body.bankCode ?? "").trim().toUpperCase() || null;
  const resultingBankAccount = replacementBankAccount ? replacementBankAccount : employee.bankAccount;
  if (wantsPayoutUpdate && Boolean(resultingBankAccount) !== Boolean(nextBankCode)) {
    return Response.json({
      error: "Bank account and bank code must be complete together before payroll payout.",
    }, { status: 422 });
  }
  if (wantsPayoutUpdate) {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
    const rateDenied = await enforceSensitiveActionRateLimit(request, {
      userId: user.id,
      action: "employee-payout-destination-change",
      resourceId: employeeId,
      limit: 6,
      windowMs: 15 * 60_000,
    });
    if (rateDenied) return rateDenied;
  }

  let nextPagIbigVoluntaryMonthly: string | undefined;
  if (body.pagIbigVoluntaryMonthly !== undefined) {
    const voluntary = Number(body.pagIbigVoluntaryMonthly);
    if (!Number.isFinite(voluntary) || voluntary < 0) {
      return Response.json({ error: "Voluntary Pag-IBIG contribution must be zero or greater." }, { status: 422 });
    }
    nextPagIbigVoluntaryMonthly = voluntary.toFixed(2);
  }

  const updates = {
    startDate: nextStartDate && nextStartDate !== String(employee.startDate) ? nextStartDate : undefined,
    middleName: clean(body.middleName),
    tin: body.tin === undefined
      ? undefined
      : encryptGovernmentId(clean(body.tin), { required: process.env.NODE_ENV === "production" }),
    tinBranchCode: body.tinBranchCode === undefined
      ? undefined
      : encryptGovernmentId(
          String(body.tinBranchCode ?? "").replace(/\D/g, "").padStart(4, "0").slice(-4) || null,
          { required: process.env.NODE_ENV === "production" },
        ),
    sssNo: body.sssNo === undefined
      ? undefined
      : encryptGovernmentId(clean(body.sssNo), { required: process.env.NODE_ENV === "production" }),
    philHealthNo: body.philHealthNo === undefined
      ? undefined
      : encryptGovernmentId(clean(body.philHealthNo), { required: process.env.NODE_ENV === "production" }),
    pagIbigNo: body.pagIbigNo === undefined
      ? undefined
      : encryptGovernmentId(clean(body.pagIbigNo), { required: process.env.NODE_ENV === "production" }),
    pagIbigVoluntaryMonthly: nextPagIbigVoluntaryMonthly,
    nationality: body.nationality === undefined ? undefined : String(body.nationality ?? "").trim() || "Filipino",
    restDay: changedRestDay ? nextRestDay : undefined,
    bankAccount: replacementBankAccount ? encryptBankAccount(replacementBankAccount) : undefined,
    bankCode: body.bankCode === undefined ? undefined : nextBankCode,
    mobile: body.mobile === undefined ? undefined : clean(body.mobile),
  };

  const patch = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined),
  ) as Partial<typeof employees.$inferInsert>;

  if (Object.keys(patch).length === 0 && !nextPayProfile) {
    return Response.json({ error: "No employee profile fields were supplied." }, { status: 400 });
  }

  if (nextPayProfile) {
    patch.basicRate = nextPayProfile.monthlyEquivalent.toFixed(2);
  }

  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(employees)
      .set(patch)
      .where(and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, organizationId),
      ))
      .returning();

    let revisionId: number | null = null;
    let restDayRevisionId: number | null = null;
    let retroAdjustments = 0;
    let retroTotal = 0;

    if (changedRestDay && restDayEffectiveDate) {
      const [sameDayRevision] = await tx.select().from(employeeRestDayRevisions)
        .where(and(
          eq(employeeRestDayRevisions.employeeId, employeeId),
          eq(employeeRestDayRevisions.effectiveDate, restDayEffectiveDate),
        ))
        .limit(1);
      const previousRestDay =
        sameDayRevision?.previousRestDay
        ?? latestRestDayRevision?.newRestDay
        ?? employee.restDay;

      const [restDayRevision] = await tx.insert(employeeRestDayRevisions).values({
        employeeId,
        organizationId,
        effectiveDate: restDayEffectiveDate,
        previousRestDay,
        newRestDay: nextRestDay ?? null,
        reason: restDayChangeReason ?? "Work schedule change",
        createdBy: user.name,
      }).onConflictDoUpdate({
        target: [employeeRestDayRevisions.employeeId, employeeRestDayRevisions.effectiveDate],
        set: {
          newRestDay: nextRestDay ?? null,
          reason: restDayChangeReason ?? "Work schedule change",
          createdBy: user.name,
          createdAt: new Date(),
        },
      }).returning({ id: employeeRestDayRevisions.id });
      restDayRevisionId = restDayRevision.id;
    }

    if (nextPayProfile && payEffectiveDate) {
      const [sameDayRevision] = await tx.select().from(employeePayRevisions)
        .where(and(
          eq(employeePayRevisions.employeeId, employeeId),
          eq(employeePayRevisions.effectiveDate, payEffectiveDate),
        ))
        .limit(1);

      const previousPayBasis = sameDayRevision?.previousPayBasis ?? existingPayProfile?.payBasis ?? "monthly";
      const previousRateAmount = Number(sameDayRevision?.previousRateAmount ?? existingPayProfile?.rateAmount ?? employee.basicRate);
      const previousStandardWorkDaysPerMonth = Number(
        sameDayRevision?.previousStandardWorkDaysPerMonth ?? existingPayProfile?.standardWorkDaysPerMonth ?? 22,
      );
      const previousStandardHoursPerDay = Number(
        sameDayRevision?.previousStandardHoursPerDay ?? existingPayProfile?.standardHoursPerDay ?? 8,
      );

      const [revision] = await tx.insert(employeePayRevisions).values({
        employeeId,
        organizationId,
        effectiveDate: payEffectiveDate,
        previousPayBasis,
        previousRateAmount: previousRateAmount.toFixed(2),
        previousStandardWorkDaysPerMonth: previousStandardWorkDaysPerMonth.toFixed(2),
        previousStandardHoursPerDay: previousStandardHoursPerDay.toFixed(2),
        newPayBasis: nextPayProfile.payBasis,
        newRateAmount: nextPayProfile.rateAmount.toFixed(2),
        newStandardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
        newStandardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
        reason: payChangeReason ?? "Pay adjustment",
        createdBy: user.name,
      }).onConflictDoUpdate({
        target: [employeePayRevisions.employeeId, employeePayRevisions.effectiveDate],
        set: {
          newPayBasis: nextPayProfile.payBasis,
          newRateAmount: nextPayProfile.rateAmount.toFixed(2),
          newStandardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
          newStandardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
          reason: payChangeReason ?? "Pay adjustment",
          createdBy: user.name,
          createdAt: new Date(),
        },
      }).returning({ id: employeePayRevisions.id });
      revisionId = revision.id;

      await tx.insert(employeePayProfiles).values({
        employeeId,
        organizationId,
        payBasis: nextPayProfile.payBasis,
        rateAmount: nextPayProfile.rateAmount.toFixed(2),
        standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
        standardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
      }).onConflictDoUpdate({
        target: employeePayProfiles.employeeId,
        set: {
          payBasis: nextPayProfile.payBasis,
          rateAmount: nextPayProfile.rateAmount.toFixed(2),
          standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth.toFixed(2),
          standardHoursPerDay: nextPayProfile.standardHoursPerDay.toFixed(2),
          updatedAt: new Date(),
        },
      });

      if (previousPayBasis === "monthly" && nextPayProfile.payBasis === "monthly") {
        const impacted = await tx.select({
          runId: payrollRuns.id,
          periodLabel: payrollRuns.periodLabel,
          periodStart: payrollRuns.periodStart,
          periodEnd: payrollRuns.periodEnd,
          lineItems: payrollEntries.lineItems,
        })
          .from(payrollRuns)
          .innerJoin(payrollEntries, and(
            eq(payrollEntries.payrollRunId, payrollRuns.id),
            eq(payrollEntries.employeeId, employeeId),
          ))
          .where(and(
            eq(payrollRuns.organizationId, organizationId),
            eq(payrollRuns.status, "Released"),
            gte(payrollRuns.periodEnd, payEffectiveDate),
          ));

        const revisionRows = await tx.select().from(employeePayRevisions)
          .where(and(
            eq(employeePayRevisions.organizationId, organizationId),
            eq(employeePayRevisions.employeeId, employeeId),
          ))
          .orderBy(asc(employeePayRevisions.effectiveDate), asc(employeePayRevisions.id));

        for (const released of impacted) {
          const timeline = resolvePayTimeline({
            currentProfile: {
              payBasis: nextPayProfile.payBasis,
              rateAmount: nextPayProfile.rateAmount,
              standardWorkDaysPerMonth: nextPayProfile.standardWorkDaysPerMonth,
              standardHoursPerDay: nextPayProfile.standardHoursPerDay,
            },
            revisions: revisionRows.map((row) => ({
              effectiveDate: String(row.effectiveDate),
              previousPayBasis: row.previousPayBasis,
              previousRateAmount: row.previousRateAmount,
              previousStandardWorkDaysPerMonth: row.previousStandardWorkDaysPerMonth,
              previousStandardHoursPerDay: row.previousStandardHoursPerDay,
              newPayBasis: row.newPayBasis,
              newRateAmount: row.newRateAmount,
              newStandardWorkDaysPerMonth: row.newStandardWorkDaysPerMonth,
              newStandardHoursPerDay: row.newStandardHoursPerDay,
              reason: row.reason,
            })),
            periodStart: String(released.periodStart),
            periodEnd: String(released.periodEnd),
          });
          if (timeline.some((segment) => segment.profile.payBasis !== "monthly")) {
            continue;
          }
          const expectedBasic = fixedMonthlyBasicForTimeline(
            timeline,
            String(released.periodStart),
            String(released.periodEnd),
          );
          const releasedLines = Array.isArray(released.lineItems)
            ? released.lineItems as Array<Record<string, unknown>>
            : [];
          const releasedBasic = Number(releasedLines.find((line) => line.code === "BASIC")?.amount ?? NaN);
          if (!Number.isFinite(releasedBasic)) continue;
          const amount = Math.round((expectedBasic - releasedBasic + Number.EPSILON) * 100) / 100;
          if (Math.abs(amount) < 0.005) continue;
          await tx.insert(employeePayRetroAdjustments).values({
            organizationId,
            employeeId,
            revisionId: revision.id,
            sourcePayrollRunId: released.runId,
            sourcePeriodLabel: released.periodLabel,
            amount: amount.toFixed(2),
            status: "pending",
          }).onConflictDoUpdate({
            target: [employeePayRetroAdjustments.revisionId, employeePayRetroAdjustments.sourcePayrollRunId],
            set: {
              amount: amount.toFixed(2),
              status: "pending",
              settledPayrollRunId: null,
              settledAt: null,
            },
          });
          retroAdjustments += 1;
          retroTotal += amount;
        }
      }
    }

    return { updated, revisionId, restDayRevisionId, retroAdjustments, retroTotal };
  });
  const updated = result.updated;

  const governmentFields = ["middleName", "tin", "tinBranchCode", "sssNo", "philHealthNo", "pagIbigNo", "nationality"];
  const changedGovernment = governmentFields.some((field) => field in patch);
  const changedStartDate = "startDate" in patch;
  const changeKinds = [Boolean(nextPayProfile), wantsPayoutUpdate, changedGovernment, changedRestDay, changedStartDate].filter(Boolean).length;
  const action = changeKinds > 1
    ? "Employee profile updated"
    : nextPayProfile
      ? "Employee payroll profile updated"
      : wantsPayoutUpdate
        ? "Employee payout details updated"
        : changedGovernment
          ? "Employee government identity updated"
          : changedStartDate
            ? "Employee employment dates updated"
            : "Employee work schedule updated";

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action,
    resource: `${employee.firstName} ${employee.lastName} (${employee.employeeNo})`,
    metadata: {
      employeeId,
      fields: [...Object.keys(patch), ...(nextPayProfile ? ["payBasis", "rateAmount", "standardWorkDaysPerMonth", "standardHoursPerDay"] : [])],
      payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
      payEffectiveDate,
      payChangeReason,
      payRevisionId: result.revisionId,
      retroAdjustments: result.retroAdjustments,
      retroTotal: result.retroTotal,
      previousStartDate: changedStartDate ? employee.startDate : undefined,
      newStartDate: changedStartDate ? updated.startDate : undefined,
      previousRestDay: changedRestDay ? employee.restDay : undefined,
      newRestDay: changedRestDay ? updated.restDay : undefined,
      restDayEffectiveDate: changedRestDay ? restDayEffectiveDate : undefined,
      restDayChangeReason: changedRestDay ? restDayChangeReason : undefined,
      restDayRevisionId: changedRestDay ? result.restDayRevisionId : undefined,
    },
  });

  return Response.json({
    employee: {
      ...updated,
      bankAccount: maskBankAccount(updated.bankAccount),
      tin: maskGovernmentId(updated.tin),
      tinBranchCode: maskGovernmentId(updated.tinBranchCode),
      sssNo: maskGovernmentId(updated.sssNo),
      philHealthNo: maskGovernmentId(updated.philHealthNo),
      pagIbigNo: maskGovernmentId(updated.pagIbigNo),
      payBasis: nextPayProfile?.payBasis ?? existingPayProfile?.payBasis ?? "monthly",
      payRate: (nextPayProfile?.rateAmount ?? Number(existingPayProfile?.rateAmount ?? updated.basicRate)).toFixed(2),
      standardWorkDaysPerMonth: (nextPayProfile?.standardWorkDaysPerMonth ?? Number(existingPayProfile?.standardWorkDaysPerMonth ?? 22)).toFixed(2),
      standardHoursPerDay: (nextPayProfile?.standardHoursPerDay ?? Number(existingPayProfile?.standardHoursPerDay ?? 8)).toFixed(2),
    },
    payChange: nextPayProfile ? {
      effectiveDate: payEffectiveDate,
      reason: payChangeReason,
      revisionId: result.revisionId,
      retroAdjustments: result.retroAdjustments,
      retroTotal: Number(result.retroTotal.toFixed(2)),
    } : null,
    scheduleChange: changedRestDay ? {
      effectiveDate: restDayEffectiveDate,
      reason: restDayChangeReason,
      revisionId: result.restDayRevisionId,
      previousRestDay: employee.restDay,
      newRestDay: updated.restDay,
    } : null,
  });
}
