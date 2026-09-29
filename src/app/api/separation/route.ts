import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  employeeLoans,
  employeePayRetroAdjustments,
  employees,
  loanPayments,
  separationRecords,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  PAYROLL_RELEASE_ROLES,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { seedProvisioning } from "@/lib/provisioning";
import { ensureFinalPaySchema } from "@/lib/final-pay-schema";
import {
  computeFinalPayPackage,
  type FinalPayInputs,
} from "@/lib/final-pay-service";
import type { SeparationCause } from "@/lib/final-pay";

export const dynamic = "force-dynamic";

const SEPARATION_TYPES = new Set<SeparationCause>([
  "resignation",
  "end_of_contract",
  "just_cause",
  "labor_saving_device",
  "redundancy",
  "retrenchment",
  "closure_not_serious_losses",
  "closure_serious_losses",
  "disease",
  "retirement",
]);

function todayPh() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function numberInput(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

function finalPayInputs(body: Record<string, unknown>): FinalPayInputs {
  const separationType = String(body.separationType ?? "resignation") as SeparationCause;
  if (!SEPARATION_TYPES.has(separationType)) throw new Error("Unsupported separation category.");

  const numeric = {
    unusedLeaveCredits: numberInput(body.unusedLeaveCredits),
    unpaidBasicSalary: numberInput(body.unpaidBasicSalary),
    otherUnpaidTaxableEarnings: numberInput(body.otherUnpaidTaxableEarnings),
    additionalThirteenthMonthBasic: numberInput(body.additionalThirteenthMonthBasic),
    retirementPlanBenefit: numberInput(body.retirementPlanBenefit),
    additionalCompanyBenefit: numberInput(body.additionalCompanyBenefit),
  };
  const invalid = Object.entries(numeric).find(([, value]) => !Number.isFinite(value));
  if (invalid) throw new Error(`${invalid[0]} must be zero or greater.`);

  return {
    organizationId: Number(body.organizationId),
    employeeId: Number(body.employeeId),
    separationType,
    noticeDate: String(body.noticeDate ?? ""),
    lastDay: String(body.lastDay ?? ""),
    unusedLeaveCredits: numeric.unusedLeaveCredits,
    leaveBasisNote: String(body.leaveBasisNote ?? ""),
    finalPayrollVerified: Boolean(body.finalPayrollVerified),
    unpaidBasicSalary: numeric.unpaidBasicSalary,
    otherUnpaidTaxableEarnings: numeric.otherUnpaidTaxableEarnings,
    additionalThirteenthMonthBasic: numeric.additionalThirteenthMonthBasic,
    deductOutstandingLoans: Boolean(body.deductOutstandingLoans),
    separationPayTaxExemptConfirmed: Boolean(body.separationPayTaxExemptConfirmed),
    retirementPlanBenefit: numeric.retirementPlanBenefit,
    retirementPlanReference: String(body.retirementPlanReference ?? ""),
    retirementTaxExemptConfirmed: Boolean(body.retirementTaxExemptConfirmed),
    additionalCompanyBenefit: numeric.additionalCompanyBenefit,
    additionalCompanyBenefitTaxable: body.additionalCompanyBenefitTaxable !== false,
  };
}

function storedInputs(value: unknown): FinalPayInputs | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!raw.inputs || typeof raw.inputs !== "object") return null;
  try {
    return finalPayInputs(raw.inputs as Record<string, unknown>);
  } catch {
    return null;
  }
}

function storedCalculationKey(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const key = (value as Record<string, unknown>).calculationKey;
  return typeof key === "string" && key ? key : null;
}

function storedBreakdown(packageResult: Awaited<ReturnType<typeof computeFinalPayPackage>>) {
  return {
    ...packageResult.snapshot,
    calculationKey: packageResult.calculationKey,
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  await ensureFinalPaySchema(organizationId);

  const filter = employeeId > 0
    ? and(eq(separationRecords.organizationId, organizationId), eq(separationRecords.employeeId, employeeId))
    : eq(separationRecords.organizationId, organizationId);

  const records = await db.select({
    sep: separationRecords,
    employee: employees,
  })
    .from(separationRecords)
    .innerJoin(employees, eq(separationRecords.employeeId, employees.id))
    .where(filter)
    .orderBy(desc(separationRecords.id));

  return Response.json({
    separations: records.map(({ sep, employee }) => ({
      ...sep,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeNo: employee.employeeNo,
      employeeTitle: employee.title,
      basicRate: employee.basicRate,
      hireDate: employee.startDate,
      birthDate: employee.birthDate,
      thirteenthMonthEligible: employee.thirteenthMonthEligible,
      thirteenthMonthExclusionReason: employee.thirteenthMonthExclusionReason,
      legacyCalculation: !storedInputs(sep.finalPayBreakdown),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  let input: FinalPayInputs;
  try {
    input = finalPayInputs(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid final pay inputs." }, { status: 400 });
  }
  if (!Number.isInteger(input.organizationId) || !Number.isInteger(input.employeeId)) {
    return Response.json({ error: "organizationId and employeeId are required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    user.id,
    input.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Your role is not allowed to manage this HR workflow.",
  );
  if (denied) return denied;

  await ensureFinalPaySchema(input.organizationId);

  const [openSeparation] = await db.select({ id: separationRecords.id })
    .from(separationRecords)
    .where(and(
      eq(separationRecords.organizationId, input.organizationId),
      eq(separationRecords.employeeId, input.employeeId),
      ne(separationRecords.status, "released"),
    ))
    .limit(1);
  if (openSeparation) {
    return Response.json({
      error: "This employee already has an open separation record. Recompute that record instead of creating a second final-pay package.",
      separationId: openSeparation.id,
    }, { status: 409 });
  }

  let packageResult;
  try {
    packageResult = await computeFinalPayPackage(input);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Final pay could not be computed." }, { status: 422 });
  }

  const [created] = await db.insert(separationRecords).values({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    separationType: input.separationType,
    noticeDate: input.noticeDate,
    lastDay: input.lastDay,
    finalPayDueDate: packageResult.columns.finalPayDueDate,
    clearanceStatus: "in_progress",
    itCleared: false,
    adminCleared: false,
    financeCleared: false,
    hrCleared: false,
    prorated13thMonth: packageResult.columns.prorated13thMonth.toFixed(2),
    unusedLeaveCredits: packageResult.columns.unusedLeaveCredits.toFixed(1),
    leaveMonetizationPay: packageResult.columns.leaveMonetizationPay.toFixed(2),
    taxAdjustment: packageResult.columns.taxAdjustment.toFixed(2),
    loanDeductions: packageResult.columns.loanDeductions.toFixed(2),
    netFinalPay: packageResult.columns.netFinalPay.toFixed(2),
    finalPayBreakdown: storedBreakdown(packageResult),
    status: "draft",
    coeIssued: false,
  }).returning();

  await seedProvisioning(input.organizationId, input.employeeId, "offboarding");

  // The employee remains payroll-active until the final package is released.
  // The separation record itself tracks the offboarding workflow; marking the
  // employee Separating here used to make the final payroll cutoff impossible.
  await recordAuditEvent({
    organizationId: input.organizationId,
    actor: user.name,
    action: "Separation final pay package computed",
    resource: `${packageResult.employee.firstName} ${packageResult.employee.lastName}`,
    metadata: {
      separationId: created.id,
      calculationKey: packageResult.calculationKey,
      blockers: packageResult.snapshot.blockers,
      netFinalPay: packageResult.columns.netFinalPay,
      dueDate: packageResult.columns.finalPayDueDate,
    },
  });

  return Response.json({
    ...created,
    blockers: packageResult.snapshot.blockers,
  }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const action = String(body.action ?? "clearance");

  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  await ensureFinalPaySchema();
  const [sep] = await db.select().from(separationRecords).where(eq(separationRecords.id, id)).limit(1);
  if (!sep) return Response.json({ error: "Separation record not found." }, { status: 404 });
  await ensureFinalPaySchema(sep.organizationId);

  const moneyAction = action === "approve" || action === "release";
  const denied = await assertOrganizationRole(
    user.id,
    sep.organizationId,
    moneyAction ? PAYROLL_RELEASE_ROLES : PEOPLE_PAYROLL_ROLES,
    moneyAction
      ? "Only payroll release roles can approve or release final pay."
      : "Your role is not allowed to manage separation and final pay.",
  );
  if (denied) return denied;

  if (action === "clearance") {
    if (sep.status === "released") {
      return Response.json({ error: "Released final pay cannot be edited." }, { status: 409 });
    }
    const itCleared = body.itCleared !== undefined ? Boolean(body.itCleared) : sep.itCleared;
    const adminCleared = body.adminCleared !== undefined ? Boolean(body.adminCleared) : sep.adminCleared;
    const financeCleared = body.financeCleared !== undefined ? Boolean(body.financeCleared) : sep.financeCleared;
    const hrCleared = body.hrCleared !== undefined ? Boolean(body.hrCleared) : sep.hrCleared;
    const allCleared = itCleared && adminCleared && financeCleared && hrCleared;

    const [updated] = await db.update(separationRecords).set({
      itCleared,
      adminCleared,
      financeCleared,
      hrCleared,
      clearanceStatus: allCleared ? "cleared" : "in_progress",
      status: sep.status === "approved" && !allCleared ? "draft" : sep.status,
    }).where(eq(separationRecords.id, id)).returning();

    return Response.json(updated);
  }

  if (action === "issue_coe") {
    const [updated] = await db.update(separationRecords).set({
      coeIssued: true,
    }).where(eq(separationRecords.id, id)).returning();

    await recordAuditEvent({
      organizationId: sep.organizationId,
      actor: user.name,
      action: "Certificate of Employment issued",
      resource: `Separation #${sep.id}`,
      metadata: { employeeId: sep.employeeId },
    });
    return Response.json(updated);
  }

  const inputs = storedInputs(sep.finalPayBreakdown);
  if (!inputs) {
    return Response.json({
      error: "This is a legacy final-pay record without a reproducible calculation snapshot. Recreate the separation package before approval or release.",
    }, { status: 409 });
  }

  let fresh;
  try {
    fresh = await computeFinalPayPackage(inputs);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Final pay could not be recomputed." }, { status: 422 });
  }

  if (action === "recompute") {
    const [updated] = await db.update(separationRecords).set({
      finalPayDueDate: fresh.columns.finalPayDueDate,
      prorated13thMonth: fresh.columns.prorated13thMonth.toFixed(2),
      unusedLeaveCredits: fresh.columns.unusedLeaveCredits.toFixed(1),
      leaveMonetizationPay: fresh.columns.leaveMonetizationPay.toFixed(2),
      taxAdjustment: fresh.columns.taxAdjustment.toFixed(2),
      loanDeductions: fresh.columns.loanDeductions.toFixed(2),
      netFinalPay: fresh.columns.netFinalPay.toFixed(2),
      finalPayBreakdown: storedBreakdown(fresh),
      status: "draft",
    }).where(eq(separationRecords.id, id)).returning();
    return Response.json({ ...updated, blockers: fresh.snapshot.blockers });
  }

  if (fresh.snapshot.blockers.length > 0) {
    return Response.json({
      error: "Final pay still has unresolved blockers.",
      blockers: fresh.snapshot.blockers,
    }, { status: 409 });
  }

  const storedKey = storedCalculationKey(sep.finalPayBreakdown);
  if (storedKey !== fresh.calculationKey) {
    return Response.json({
      error: "Payroll, leave, loans, pay history, or retro data changed after this final-pay package was computed. Recompute before approval.",
      actionRequired: "recompute",
    }, { status: 409 });
  }

  if (action === "approve") {
    if (sep.clearanceStatus !== "cleared") {
      return Response.json({ error: "All IT, Admin, Finance, and HR clearances must be complete before final-pay approval." }, { status: 409 });
    }
    const [updated] = await db.update(separationRecords).set({
      status: "approved",
    }).where(and(
      eq(separationRecords.id, id),
      eq(separationRecords.status, "draft"),
    )).returning();

    if (!updated) {
      return Response.json({ error: "Final pay is no longer in draft status." }, { status: 409 });
    }

    await recordAuditEvent({
      organizationId: sep.organizationId,
      actor: user.name,
      action: "Final pay approved",
      resource: `Separation #${sep.id}`,
      metadata: { calculationKey: fresh.calculationKey, netFinalPay: fresh.columns.netFinalPay },
    });
    return Response.json(updated);
  }

  if (action === "release") {
    if (sep.status !== "approved") {
      return Response.json({ error: "Final pay must be approved before release." }, { status: 409 });
    }
    if (sep.clearanceStatus !== "cleared") {
      return Response.json({ error: "All clearances must remain complete at release." }, { status: 409 });
    }
    if (todayPh() < String(sep.lastDay)) {
      return Response.json({ error: "Final pay cannot be released before the employee's effective last day." }, { status: 409 });
    }

    try {
      const result = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(separationRecords).set({
          status: "released",
          releasedAt: new Date(),
          releasedBy: user.name,
          finalPayBreakdown: storedBreakdown(fresh),
        }).where(and(
          eq(separationRecords.id, id),
          eq(separationRecords.status, "approved"),
        )).returning();
        if (!claimed) throw new Error("Final pay status changed before release.");

        const retro = fresh.snapshot.retro as { pendingIds?: number[] };
        for (const retroId of retro.pendingIds ?? []) {
          const [settled] = await tx.update(employeePayRetroAdjustments).set({
            status: "settled",
            settledSeparationId: id,
            settledAt: new Date(),
          }).where(and(
            eq(employeePayRetroAdjustments.id, retroId),
            eq(employeePayRetroAdjustments.organizationId, sep.organizationId),
            eq(employeePayRetroAdjustments.employeeId, sep.employeeId),
            eq(employeePayRetroAdjustments.status, "pending"),
          )).returning({ id: employeePayRetroAdjustments.id });
          if (!settled) throw new Error(`Retro adjustment #${retroId} changed during final-pay release.`);
        }

        const loanSnapshot = fresh.snapshot.loans as {
          ids?: number[];
          deductFromFinalPay?: boolean;
        };
        if (loanSnapshot.deductFromFinalPay) {
          for (const loanId of loanSnapshot.ids ?? []) {
            const [loan] = await tx.select().from(employeeLoans).where(and(
              eq(employeeLoans.id, loanId),
              eq(employeeLoans.organizationId, sep.organizationId),
              eq(employeeLoans.employeeId, sep.employeeId),
              eq(employeeLoans.status, "active"),
            )).limit(1);
            if (!loan) throw new Error(`Loan #${loanId} changed during final-pay release.`);

            const amount = Number(loan.remainingBalance);
            if (amount <= 0) continue;
            await tx.insert(loanPayments).values({
              loanId,
              payrollRunId: null,
              amount: amount.toFixed(2),
              paymentDate: sep.lastDay,
              reference: `Final pay separation #${id}`,
            });
            const [paid] = await tx.update(employeeLoans).set({
              remainingBalance: "0.00",
              totalPaid: (Number(loan.totalPaid) + amount).toFixed(2),
              status: "paid_off",
            }).where(and(
              eq(employeeLoans.id, loanId),
              eq(employeeLoans.remainingBalance, loan.remainingBalance),
              eq(employeeLoans.status, "active"),
            )).returning({ id: employeeLoans.id });
            if (!paid) throw new Error(`Loan #${loanId} balance changed during final-pay release.`);
          }
        }

        await tx.update(employees).set({ status: "Separated" }).where(and(
          eq(employees.id, sep.employeeId),
          eq(employees.organizationId, sep.organizationId),
        ));

        await tx.insert(auditEvents).values({
          organizationId: sep.organizationId,
          actor: user.name,
          action: "Final pay released",
          resource: `Separation #${sep.id}`,
          metadata: {
            calculationKey: fresh.calculationKey,
            netFinalPay: fresh.columns.netFinalPay,
            finalPayDueDate: fresh.columns.finalPayDueDate,
            retroSettled: retro.pendingIds?.length ?? 0,
            loansDeducted: loanSnapshot.deductFromFinalPay ? loanSnapshot.ids?.length ?? 0 : 0,
          },
        });

        return claimed;
      });

      return Response.json(result);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Final-pay release failed.",
      }, { status: 409 });
    }
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
