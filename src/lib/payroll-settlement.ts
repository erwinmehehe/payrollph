import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { assertSpendModeAvailable, loadSpendClaimEvidence, lockReviewedSpendOrganization, spendPayrollEnabled } from "@/lib/spend-claim-evidence";
import { reimbursementEligible, reimbursementLineBenefitTreatmentMatches, reimbursementLineEvidenceMatches, reimbursementLineTaxMatches, reimbursementSettlementDecision, receiptObjectIdentityMatches } from "@/lib/spend-payroll-reimbursement";
import { readVerifiedSpendReceipt } from "@/lib/spend-receipt-storage";
import { sameBankAccount } from "@/lib/bank-account-crypto";
import { exactLoanPaymentReplayMatches, payrollLoanPosting } from "@/lib/payroll-loan-settlement";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { verifiedExitPayrollTrace } from "@/lib/approved-exit-payroll";
import { holidayCalendarFingerprint } from "@/lib/payroll-calendar";
import { NATIONAL_HOLIDAYS_2026, type HolidayCalendarEntry } from "@/lib/wage-orders";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import {
  auditEvents,
  earnedWageRequests,
  employeeLoans,
  employeePayProfiles,
  employeePayRetroAdjustments,
  employees,
  expenseClaims,
  holidays,
  orgUnits,
  leaveConversions,
  loanPayments,
  payrollEntries,
  payrollRuns,
  supplementaryEarnings,
  yearEndAdjustments,
  separationRecords,
} from "@/db/schema";

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function storedLines(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ code: string; amount: number; notes: string[] }>;
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.code !== "string") return [];
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) return [];
    return [{ code: row.code, amount,
      notes: Array.isArray(row.notes) ? row.notes.filter((v): v is string => typeof v === "string") : [],
    }];
  });
}

function numericId(code: string, prefix: string) {
  if (!code.startsWith(prefix)) return null;
  const id = Number(code.slice(prefix.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}


type VerifiedSpendReceipt = Readonly<{ employeeId: number; storageKey: string; sha256: string; byteSize: number }>;

/**
 * Read the actual scanned private receipt bytes outside the payroll settlement
 * transaction. Never hold money-ledger or employee row locks across S3 GETs.
 * The locked settlement re-compares this snapshot to approved SQL evidence.
 * Four concurrent reads bound provider load. A missing/tampered private object
 * is a hard release failure, not a warning to pay without the receipt.
 */
async function verifySpendReceiptsBeforeSettlement(
  runId: number, organizationId: number,
): Promise<Map<number, VerifiedSpendReceipt>> {
  const verified = new Map<number, VerifiedSpendReceipt>();
  if (!spendPayrollEnabled()) return verified;
  const entries = await db.select({ employeeId: payrollEntries.employeeId, lineItems: payrollEntries.lineItems })
    .from(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));
  const claimEmployees = new Map<number, number>();
  for (const entry of entries) {
    for (const line of storedLines(entry.lineItems)) {
      if (!line.code.startsWith("EXP-")) continue;
      const claimId = numericId(line.code, "EXP-");
      if (!claimId || line.code !== "EXP-" + claimId || claimEmployees.has(claimId)) {
        throw new Error("The payroll register contains a duplicate expense reimbursement or invalid expense code.");
      }
      claimEmployees.set(claimId, entry.employeeId);
    }
  }
  if (claimEmployees.size === 0) return verified;
  const coreClaims = await db.select().from(expenseClaims).where(and(
    eq(expenseClaims.organizationId, organizationId),
    inArray(expenseClaims.id, [...claimEmployees.keys()]),
  ));
  const claims = await loadSpendClaimEvidence(db, coreClaims);
  // The locked transaction remains responsible for detecting changed, paid,
  // absent and unapproved claims. They must never cause an object read here.
  const payable = claims.filter(claim => reimbursementEligible(claim, true) &&
    claim.employeeId === claimEmployees.get(claim.id));
  for (let i = 0; i < payable.length; i += 4) {
    await Promise.all(payable.slice(i, i + 4).map(async claim => {
      const storageKey = claim.receiptStorageKey!;
      const sha256 = claim.receiptSha256!;
      const byteSize = claim.receiptByteSize!;
      try {
        await readVerifiedSpendReceipt({
          key: storageKey, organizationId: claim.organizationId,
          employeeId: claim.employeeId, sha256, byteSize,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = ["RECEIPT_IDENTITY_INVALID", "RECEIPT_READ_UNAVAILABLE", "RECEIPT_SIZE_MISMATCH", "RECEIPT_HASH_MISMATCH"]
          .includes(message) ? message : "RECEIPT_READ_UNAVAILABLE";
        throw new Error("RECEIPT_RELEASE_VERIFICATION_FAILED for claim #" + claim.id + ": " +
          code);
      }
      verified.set(claim.id, { employeeId: claim.employeeId, storageKey, sha256, byteSize });
    }));
  }
  return verified;
}

type PaymentSnapshot = {
  employeeName: string;
  employeeNo: string;
  bankAccount: string | null;
  bankCode: string | null;
  mobile: string | null;
};

function readPaymentSnapshot(value: unknown): PaymentSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payment = (value as Record<string, unknown>).payment;
  if (!payment || typeof payment !== "object") return null;
  const row = payment as Record<string, unknown>;
  const employeeName = typeof row.employeeName === "string" ? row.employeeName.trim() : "";
  const employeeNo = typeof row.employeeNo === "string" ? row.employeeNo.trim() : "";
  if (!employeeName || !employeeNo) return null;
  const nullable = (field: unknown) => typeof field === "string" && field.trim() ? field.trim() : null;
  return {
    employeeName,
    employeeNo,
    bankAccount: nullable(row.bankAccount),
    bankCode: nullable(row.bankCode),
    mobile: nullable(row.mobile),
  };
}

function samePaymentValue(left: string | null | undefined, right: string | null | undefined) {
  return (left ?? "").trim() === (right ?? "").trim();
}

type PayProfileSnapshot = {
  payBasis: string;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
  monthlyEquivalent: number;
};

function readPayProfileSnapshot(value: unknown): PayProfileSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const payProfile = (value as Record<string, unknown>).payProfile;
  if (!payProfile || typeof payProfile !== "object") return null;
  const row = payProfile as Record<string, unknown>;
  const payBasis = typeof row.payBasis === "string" ? row.payBasis.trim() : "";
  const rateAmount = Number(row.rateAmount);
  const standardWorkDaysPerMonth = Number(row.standardWorkDaysPerMonth);
  const standardHoursPerDay = Number(row.standardHoursPerDay);
  const monthlyEquivalent = Number(row.monthlyEquivalent);
  if (
    !payBasis ||
    !Number.isFinite(rateAmount) ||
    !Number.isFinite(standardWorkDaysPerMonth) ||
    !Number.isFinite(standardHoursPerDay) ||
    !Number.isFinite(monthlyEquivalent)
  ) return null;
  return { payBasis, rateAmount, standardWorkDaysPerMonth, standardHoursPerDay, monthlyEquivalent };
}

function traceInputString(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return null;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return null;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  return typeof raw === "string" ? raw.slice(prefix.length) : null;
}

function orgUnitAncestorIds(
  orgUnitId: number | null,
  unitMap: Map<number, typeof orgUnits.$inferSelect>,
) {
  const ids = new Set<number>();
  let cursor = orgUnitId;
  let guard = 0;
  while (cursor != null && guard < 50) {
    if (ids.has(cursor)) break;
    ids.add(cursor);
    cursor = unitMap.get(cursor)?.parentId ?? null;
    guard += 1;
  }
  return ids;
}

function samePayrollNumber(left: string | number | null | undefined, right: string | number | null | undefined) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
}

/**
 * Settles every payroll-linked sub-ledger and flips the run to Released in one
 * database transaction. Any stale expense, advance, leave conversion, or loan
 * aborts the whole transaction so a run can never be half-settled.
 *
 * The release route claims Ready for release -> Releasing before calling this
 * function. That outer claim prevents concurrent release requests; this
 * transaction makes the financial mutations and final state atomic.
 */
export async function settlePayrollRun(
  runId: number,
  releaseAudit?: {
    actor: string;
    resource: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [preflightRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!preflightRun) throw new Error("Payroll run not found.");
  await ensureEmployeePayProfiles(preflightRun.organizationId);
  const verifiedSpendReceipts = await verifySpendReceiptsBeforeSettlement(runId, preflightRun.organizationId);

  return db.transaction(async (tx) => {
    await lockReviewedSpendOrganization(tx, preflightRun.organizationId);
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
    if (!run) throw new Error("Payroll run not found.");
    if (run.status !== "Releasing") {
      throw new Error("Payroll run is no longer in the releasing state.");
    }

    const entries = await tx
      .select()
      .from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id));

    if (entries.length !== run.employeeCount) {
      throw new Error("Payroll register no longer matches the calculated employee count; recalculate before release.");
    }

    const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
    const currentEmployees = employeeIds.length
      ? await tx.select().from(employees).where(and(
          eq(employees.organizationId, run.organizationId),
          inArray(employees.id, employeeIds),
        ))
      : [];
    const employeeById = new Map(currentEmployees.map((employee) => [employee.id, employee]));
    const exitRows = criticalReleaseFlagEnabled("approvedExitPayroll") && employeeIds.length
      ? await tx.select({ id: separationRecords.id, employeeId: separationRecords.employeeId,
          lastDay: separationRecords.lastDay, unpaidBasicSalary: separationRecords.unpaidBasicSalary,
          preparedByUserId: separationRecords.preparedByUserId, approvedByUserId: separationRecords.approvedByUserId,
        }).from(separationRecords).where(and(
          eq(separationRecords.organizationId, run.organizationId),
          inArray(separationRecords.employeeId, employeeIds),
          inArray(separationRecords.status, ["approved", "released"]),
        )).for("update") : [];

    const [holidayRows, unitRows] = await Promise.all([
      tx.select().from(holidays).where(and(
        or(isNull(holidays.organizationId), eq(holidays.organizationId, run.organizationId)),
        lte(holidays.holidayDate, run.periodEnd),
      )),
      tx.select().from(orgUnits).where(eq(orgUnits.organizationId, run.organizationId)),
    ]);
    const unitMap = new Map(unitRows.map((unit) => [unit.id, unit]));
    const localHolidayRows = holidayRows.flatMap((row) => {
      const kind = row.kind === "regular" || row.kind === "special" ? row.kind : null;
      return kind ? [{
        date: String(row.holidayDate),
        name: row.name,
        kind: kind as "regular" | "special",
        orgUnitId: row.orgUnitId,
      }] : [];
    });
    const currentPayProfiles = employeeIds.length
      ? await tx.select().from(employeePayProfiles).where(and(
          eq(employeePayProfiles.organizationId, run.organizationId),
          inArray(employeePayProfiles.employeeId, employeeIds),
        ))
      : [];
    const payProfileByEmployee = new Map(currentPayProfiles.map((profile) => [profile.employeeId, profile]));
    const currentPendingRetro = employeeIds.length
      ? await tx.select().from(employeePayRetroAdjustments).where(and(
          eq(employeePayRetroAdjustments.organizationId, run.organizationId),
          eq(employeePayRetroAdjustments.status, "pending"),
          inArray(employeePayRetroAdjustments.employeeId, employeeIds),
        ))
      : [];
    const pendingRetroById = new Map(currentPendingRetro.map((retro) => [retro.id, retro]));
    const calculatedRetroIds = new Set<number>();
    for (const entry of entries) {
      for (const line of storedLines(entry.lineItems)) {
        const retroId = numericId(line.code, "RETRO-");
        if (!retroId) continue;
        calculatedRetroIds.add(retroId);
        const currentRetro = pendingRetroById.get(retroId);
        if (!currentRetro || !samePayrollNumber(currentRetro.amount, line.amount)) {
          throw new Error(
            `Retro pay adjustment ${retroId} changed after calculation; recalculate before release so the approved register matches the pending retro ledger.`,
          );
        }
      }
    }
    const missingRetro = currentPendingRetro.find((retro) => !calculatedRetroIds.has(retro.id));
    if (missingRetro) {
      throw new Error(
        `A new retro pay adjustment was added after calculation; recalculate before release so adjustment #${missingRetro.id} is included.`,
      );
    }

    const currentSupplementary = employeeIds.length
      ? await tx.select().from(supplementaryEarnings).where(and(
          eq(supplementaryEarnings.organizationId, run.organizationId),
          eq(supplementaryEarnings.status, "approved"),
          inArray(supplementaryEarnings.employeeId, employeeIds),
          gte(supplementaryEarnings.effectiveDate, run.periodStart),
          lte(supplementaryEarnings.effectiveDate, run.periodEnd),
          isNull(supplementaryEarnings.payrollRunId),
        ))
      : [];
    const supplementaryById = new Map(currentSupplementary.map((earning) => [earning.id, earning]));
    const calculatedSupplementaryIds = new Set<number>();
    for (const entry of entries) {
      for (const line of storedLines(entry.lineItems)) {
        const earningId = numericId(line.code, "EARN-");
        if (!earningId) continue;
        calculatedSupplementaryIds.add(earningId);
        const current = supplementaryById.get(earningId);
        if (
          !current
          || current.employeeId !== entry.employeeId
          || !samePayrollNumber(current.amount, line.amount)
        ) {
          throw new Error(
            `Supplementary earning ${earningId} changed after calculation; recalculate before release so the approved register matches the earnings ledger.`,
          );
        }
      }
    }
    const missingSupplementary = currentSupplementary.find(
      (earning) => !calculatedSupplementaryIds.has(earning.id),
    );
    if (missingSupplementary) {
      throw new Error(
        `A new supplementary earning was added after calculation; recalculate before release so earning #${missingSupplementary.id} is included.`,
      );
    }

    const currentYearEndAdjustments = await tx.select().from(yearEndAdjustments).where(and(
      eq(yearEndAdjustments.organizationId, run.organizationId),
      eq(yearEndAdjustments.payrollRunId, run.id),
      eq(yearEndAdjustments.status, "approved"),
    ));
    const yearEndById = new Map(currentYearEndAdjustments.map((adjustment) => [adjustment.id, adjustment]));
    const calculatedYearEndIds = new Set<number>();
    for (const entry of entries) {
      for (const line of storedLines(entry.lineItems)) {
        const adjustmentId = numericId(line.code, "YE-TAX-");
        if (!adjustmentId) continue;
        calculatedYearEndIds.add(adjustmentId);
        const adjustment = yearEndById.get(adjustmentId);
        if (
          !adjustment
          || adjustment.employeeId !== entry.employeeId
          || !samePayrollNumber(-Number(adjustment.adjustment), line.amount)
        ) {
          throw new Error(
            `Year-end tax adjustment ${adjustmentId} changed after calculation; recalculate before release so the approved register matches annualization.`,
          );
        }
      }
    }
    const missingYearEnd = currentYearEndAdjustments.find(
      (adjustment) => !calculatedYearEndIds.has(adjustment.id),
    );
    if (missingYearEnd) {
      throw new Error(
        `Approved year-end tax adjustment #${missingYearEnd.id} is missing from the payroll register; recalculate before release.`,
      );
    }

    for (const entry of entries) {
      const employee = employeeById.get(entry.employeeId);
      if (!employee) {
        throw new Error(`Employee #${entry.employeeId} no longer belongs to this payroll workspace; recalculate before release.`);
      }
      const workerExits = exitRows.filter(exit => exit.employeeId === employee.id);
      const approvedExit = workerExits.length > 0 && new Set(workerExits.map(exit => String(exit.lastDay))).size === 1
        && workerExits.every(exit => exit.preparedByUserId != null && exit.approvedByUserId != null
          && exit.preparedByUserId !== exit.approvedByUserId && Number(exit.unpaidBasicSalary) === 0
          && String(exit.lastDay) >= String(run.periodStart))
        && workerExits.some(exit => verifiedExitPayrollTrace(entry.trace,
          String(exit.lastDay) < String(run.periodEnd) ? String(exit.lastDay) : String(run.periodEnd), exit.id));
      if (criticalReleaseFlagEnabled("approvedExitPayroll") && traceInputString(entry.trace, "approvedExitProration") != null && !approvedExit) {
        throw new Error("PAYROLL_EXIT_EVIDENCE_CHANGED: Approved exit or wage overlap evidence changed after calculation; reapprove and recalculate before release.");
      }
      if (employee.status !== "Active" && !(employee.status === "Separating" && approvedExit)) {
        throw new Error(
          `${employee.firstName} ${employee.lastName} is now ${employee.status}; recalculate before release so non-active employees are excluded.`,
        );
      }

      const holidayScopeIds = orgUnitAncestorIds(employee.orgUnitId, unitMap);
      const currentHolidayCalendar: HolidayCalendarEntry[] = [
        ...NATIONAL_HOLIDAYS_2026,
        ...localHolidayRows
          .filter((holiday) => holiday.orgUnitId == null || holidayScopeIds.has(holiday.orgUnitId))
          .map(({ orgUnitId: _orgUnitId, ...holiday }) => holiday)
          .filter((local) => !NATIONAL_HOLIDAYS_2026.some(
            (national) =>
              national.date === local.date
              && national.name === local.name
              && national.kind === local.kind
          )),
      ];
      const storedHolidayFingerprint = traceInputString(entry.trace, "holidayCalendarFingerprint");
      const currentHolidayFingerprint = holidayCalendarFingerprint(currentHolidayCalendar);
      if (!storedHolidayFingerprint || storedHolidayFingerprint !== currentHolidayFingerprint) {
        throw new Error(
          `Holiday calendar for ${employee.firstName} ${employee.lastName} changed after payroll calculation; recalculate before release.`,
        );
      }

            const snapshot = readPaymentSnapshot(entry.trace);
      if (!snapshot) {
        throw new Error(
          `Payroll entry for ${employee.firstName} ${employee.lastName} lacks an immutable payment snapshot; recalculate before release.`,
        );
      }

      if (!snapshot.bankAccount && !snapshot.mobile) {
        throw new Error(
          `${snapshot.employeeName} has no captured bank account or mobile payout destination; add one and recalculate before release.`,
        );
      }

      const currentName = `${employee.firstName} ${employee.lastName}`.trim();
      const paymentChanged =
        !samePaymentValue(snapshot.employeeName, currentName) ||
        !samePaymentValue(snapshot.employeeNo, employee.employeeNo) ||
        !sameBankAccount(snapshot.bankAccount, employee.bankAccount) ||
        !samePaymentValue(snapshot.bankCode, employee.bankCode) ||
        !samePaymentValue(snapshot.mobile, employee.mobile);

      if (paymentChanged) {
        throw new Error(
          `Payment instructions for ${currentName} changed after calculation; recalculate before release so the approved register and payout file stay aligned.`,
        );
      }

      const paySnapshot = readPayProfileSnapshot(entry.trace);
      if (!paySnapshot) {
        throw new Error(
          `Payroll entry for ${currentName} lacks an immutable pay-profile snapshot; recalculate before release.`,
        );
      }
      const currentPayProfile = payProfileByEmployee.get(entry.employeeId);
      if (!currentPayProfile) {
        throw new Error(
          `Pay profile for ${currentName} is missing; configure it and recalculate before release.`,
        );
      }
      const payProfileChanged =
        paySnapshot.payBasis !== currentPayProfile.payBasis ||
        !samePayrollNumber(paySnapshot.rateAmount, currentPayProfile.rateAmount) ||
        !samePayrollNumber(paySnapshot.standardWorkDaysPerMonth, currentPayProfile.standardWorkDaysPerMonth) ||
        !samePayrollNumber(paySnapshot.standardHoursPerDay, currentPayProfile.standardHoursPerDay) ||
        !samePayrollNumber(paySnapshot.monthlyEquivalent, employee.basicRate);

      if (payProfileChanged) {
        throw new Error(
          `Pay profile for ${currentName} changed after calculation; recalculate before release so the approved register uses the current pay basis and rate.`,
        );
      }
    }

    // All payable reimbursements for this calculated workforce must have a
    // register line. Otherwise a late approval would be silently omitted.
    // Lock currently approved unlinked claims in deterministic order; existing
    // per-line locks and compare-and-swap still protect exact-once release.
    const expectedSpendClaimIds = spendPayrollEnabled() && employeeIds.length
      ? (await tx.select({ id: expenseClaims.id }).from(expenseClaims).where(and(
          eq(expenseClaims.organizationId, run.organizationId),
          inArray(expenseClaims.employeeId, employeeIds),
          eq(expenseClaims.status, "approved"),
          isNull(expenseClaims.payrollRunId),
        )).orderBy(expenseClaims.id).for("update")).map(claim => claim.id)
      : [];
    const seenExpenseClaimIds = new Set<number>();
    let expensesSettled = 0;
    let advancesSettled = 0;
    let loanPaymentsSettled = 0;
    let leaveConversionsSettled = 0;
    let retroAdjustmentsSettled = 0;
    let supplementaryEarningsSettled = 0;
    let yearEndTaxAdjustmentsSettled = 0;

    for (const entry of entries) {
      for (const line of storedLines(entry.lineItems)) {
        const expenseId = numericId(line.code, "EXP-");
        if (spendPayrollEnabled() && line.code.startsWith("EXP-") &&
            (!expenseId || line.code !== "EXP-" + expenseId)) {
          throw new Error("Invalid expense reimbursement code in the approved register.");
        }
        if (expenseId) {
          if (spendPayrollEnabled()) {
            if (seenExpenseClaimIds.has(expenseId)) {
              throw new Error("The payroll register contains duplicate expense reimbursement " + expenseId + ".");
            }
            seenExpenseClaimIds.add(expenseId);
          }
          const claimQuery = tx
            .select()
            .from(expenseClaims)
            .where(and(
              eq(expenseClaims.id, expenseId),
              eq(expenseClaims.organizationId, run.organizationId),
            ));
          const [coreClaim] = spendPayrollEnabled() ? await claimQuery.for("update").limit(1) : await claimQuery.limit(1);
          if (coreClaim?.status === "approved") await assertSpendModeAvailable(tx, [coreClaim]);
          const [claim] = coreClaim ? await loadSpendClaimEvidence(tx, [coreClaim]) : [];
          if (!claim || claim.employeeId !== entry.employeeId) {
            throw new Error(`Expense claim ${expenseId} no longer matches this payroll entry.`);
          }
          if (spendPayrollEnabled()) {
            if (!claim.receiptStorageKey || !receiptObjectIdentityMatches(
                claim.receiptStorageKey, claim.organizationId, claim.employeeId)) {
              throw new Error("Expense claim " + expenseId + " receipt belongs to another employer or worker.");
            }
            if (!reimbursementLineTaxMatches(claim.taxable === true, line.notes) ||
                !reimbursementLineBenefitTreatmentMatches(claim.taxable === true, line.notes) ||
                !reimbursementLineEvidenceMatches(claim, line.notes)) {
              throw new Error("Expense claim " + expenseId + " has a different taxable policy from its approved payslip.");
            }
            const decision = reimbursementSettlementDecision(claim, run.id, line.amount, true);
            if (decision !== "settle") {
              throw new Error(`Expense claim ${expenseId} cannot settle: ${decision}. Recalculate before release.`);
            }
            const bytesVerified = verifiedSpendReceipts.get(expenseId);
            if (!bytesVerified || bytesVerified.employeeId !== entry.employeeId ||
                bytesVerified.storageKey !== claim.receiptStorageKey ||
                bytesVerified.sha256 !== claim.receiptSha256 ||
                bytesVerified.byteSize !== claim.receiptByteSize) {
              throw new Error("Expense claim " + expenseId + " private receipt changed since byte verification.");
            }
          }
          if (claim.payrollRunId != null && claim.payrollRunId !== run.id) {
            throw new Error(`Expense claim ${expenseId} was already settled by another payroll run.`);
          }
          if (claim.payrollRunId === run.id && claim.status === "paid") continue;
          if (claim.status !== "approved") {
            throw new Error(`Expense claim ${expenseId} is no longer approved for payment.`);
          }
          const [settledClaim] = await tx.update(expenseClaims)
            .set({ status: "paid", payrollRunId: run.id })
            .where(and(
              eq(expenseClaims.id, expenseId),
              eq(expenseClaims.organizationId, run.organizationId),
              eq(expenseClaims.status, "approved"),
              isNull(expenseClaims.payrollRunId),
            ))
            .returning({ id: expenseClaims.id });
          if (!settledClaim) {
            throw new Error(`Expense claim ${expenseId} changed while payroll was being released; recalculate before release.`);
          }
          expensesSettled += 1;
          continue;
        }

        const advanceId = numericId(line.code, "EWA-");
        if (advanceId) {
          const [advance] = await tx
            .select()
            .from(earnedWageRequests)
            .where(and(
              eq(earnedWageRequests.id, advanceId),
              eq(earnedWageRequests.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!advance || advance.employeeId !== entry.employeeId) {
            throw new Error(`Earned-wage advance ${advanceId} no longer matches this payroll entry.`);
          }
          if (advance.payrollRunId != null && advance.payrollRunId !== run.id) {
            throw new Error(`Earned-wage advance ${advanceId} was already recovered by another payroll run.`);
          }
          if (advance.payrollRunId === run.id && advance.status === "repaid") continue;
          if (advance.status !== "approved") {
            throw new Error(`Earned-wage advance ${advanceId} is no longer approved for recovery.`);
          }
          const [settledAdvance] = await tx.update(earnedWageRequests)
            .set({ status: "repaid", payrollRunId: run.id })
            .where(and(
              eq(earnedWageRequests.id, advanceId),
              eq(earnedWageRequests.organizationId, run.organizationId),
              eq(earnedWageRequests.status, "approved"),
              isNull(earnedWageRequests.payrollRunId),
            ))
            .returning({ id: earnedWageRequests.id });
          if (!settledAdvance) {
            throw new Error(`Earned-wage advance ${advanceId} changed while payroll was being released; recalculate before release.`);
          }
          advancesSettled += 1;
          continue;
        }

        const conversionId = numericId(line.code, "LEAVE_CONV-");
        if (conversionId) {
          const [conversion] = await tx
            .select()
            .from(leaveConversions)
            .where(and(
              eq(leaveConversions.id, conversionId),
              eq(leaveConversions.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!conversion || conversion.employeeId !== entry.employeeId) {
            throw new Error(`Leave conversion ${conversionId} no longer matches this payroll entry.`);
          }
          if (conversion.payrollRunId != null && conversion.payrollRunId !== run.id) {
            throw new Error(`Leave conversion ${conversionId} was already settled by another payroll run.`);
          }
          if (conversion.payrollRunId === run.id && conversion.status === "paid") continue;
          if (conversion.status !== "approved") {
            throw new Error(`Leave conversion ${conversionId} is no longer approved for payment.`);
          }
          const [settledConversion] = await tx.update(leaveConversions)
            .set({ status: "paid", payrollRunId: run.id })
            .where(and(
              eq(leaveConversions.id, conversionId),
              eq(leaveConversions.organizationId, run.organizationId),
              eq(leaveConversions.status, "approved"),
              isNull(leaveConversions.payrollRunId),
            ))
            .returning({ id: leaveConversions.id });
          if (!settledConversion) {
            throw new Error(`Leave conversion ${conversionId} changed while payroll was being released; recalculate before release.`);
          }
          leaveConversionsSettled += 1;
          continue;
        }

        const earningId = numericId(line.code, "EARN-");
        if (earningId) {
          const [earning] = await tx.select().from(supplementaryEarnings)
            .where(and(
              eq(supplementaryEarnings.id, earningId),
              eq(supplementaryEarnings.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!earning || earning.employeeId !== entry.employeeId) {
            throw new Error(`Supplementary earning ${earningId} no longer matches this payroll entry.`);
          }
          if (earning.status === "settled" && earning.payrollRunId === run.id) continue;
          if (earning.status !== "approved" || earning.payrollRunId != null) {
            throw new Error(
              `Supplementary earning ${earningId} was already settled or changed; recalculate payroll before release.`,
            );
          }
          if (!samePayrollNumber(earning.amount, line.amount)) {
            throw new Error(
              `Supplementary earning ${earningId} amount changed after calculation; recalculate before release.`,
            );
          }
          const [settledEarning] = await tx.update(supplementaryEarnings)
            .set({ status: "settled", payrollRunId: run.id })
            .where(and(
              eq(supplementaryEarnings.id, earningId),
              eq(supplementaryEarnings.organizationId, run.organizationId),
              eq(supplementaryEarnings.status, "approved"),
              isNull(supplementaryEarnings.payrollRunId),
            ))
            .returning({ id: supplementaryEarnings.id });
          if (!settledEarning) {
            throw new Error(
              `Supplementary earning ${earningId} changed while payroll was being released; recalculate before release.`,
            );
          }
          supplementaryEarningsSettled += 1;
          continue;
        }

        const yearEndAdjustmentId = numericId(line.code, "YE-TAX-");
        if (yearEndAdjustmentId) {
          const [adjustment] = await tx.select().from(yearEndAdjustments).where(and(
            eq(yearEndAdjustments.id, yearEndAdjustmentId),
            eq(yearEndAdjustments.organizationId, run.organizationId),
            eq(yearEndAdjustments.payrollRunId, run.id),
          )).limit(1);
          if (!adjustment || adjustment.employeeId !== entry.employeeId) {
            throw new Error(`Year-end tax adjustment ${yearEndAdjustmentId} no longer matches this payroll entry.`);
          }
          if (
            adjustment.status !== "approved"
            || !samePayrollNumber(-Number(adjustment.adjustment), line.amount)
          ) {
            throw new Error(
              `Year-end tax adjustment ${yearEndAdjustmentId} changed after calculation; recalculate payroll before release.`,
            );
          }
          const [settledAdjustment] = await tx.update(yearEndAdjustments)
            .set({ status: "settled", settledAt: new Date() })
            .where(and(
              eq(yearEndAdjustments.id, yearEndAdjustmentId),
              eq(yearEndAdjustments.organizationId, run.organizationId),
              eq(yearEndAdjustments.payrollRunId, run.id),
              eq(yearEndAdjustments.status, "approved"),
            ))
            .returning({ id: yearEndAdjustments.id });
          if (!settledAdjustment) {
            throw new Error(
              `Year-end tax adjustment ${yearEndAdjustmentId} changed while payroll was being released; recalculate before release.`,
            );
          }
          yearEndTaxAdjustmentsSettled += 1;
          continue;
        }

        const retroId = numericId(line.code, "RETRO-");
        if (retroId) {
          const [retro] = await tx.select().from(employeePayRetroAdjustments)
            .where(and(
              eq(employeePayRetroAdjustments.id, retroId),
              eq(employeePayRetroAdjustments.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!retro || retro.employeeId !== entry.employeeId) {
            throw new Error(`Retro pay adjustment ${retroId} no longer matches this payroll entry.`);
          }
          if (retro.status === "settled" && retro.settledPayrollRunId === run.id) continue;
          if (retro.status !== "pending" || retro.settledPayrollRunId != null) {
            throw new Error(`Retro pay adjustment ${retroId} was already settled or changed; recalculate payroll before release.`);
          }
          const [settledRetro] = await tx.update(employeePayRetroAdjustments)
            .set({
              status: "settled",
              settledPayrollRunId: run.id,
              settledAt: new Date(),
            })
            .where(and(
              eq(employeePayRetroAdjustments.id, retroId),
              eq(employeePayRetroAdjustments.organizationId, run.organizationId),
              eq(employeePayRetroAdjustments.status, "pending"),
              isNull(employeePayRetroAdjustments.settledPayrollRunId),
            ))
            .returning({ id: employeePayRetroAdjustments.id });
          if (!settledRetro) {
            throw new Error(`Retro pay adjustment ${retroId} changed while payroll was being released; recalculate before release.`);
          }
          retroAdjustmentsSettled += 1;
          continue;
        }

                const loanId = numericId(line.code, "LOAN-");
        if (loanId) {
          const plannedDeduction = Math.abs(line.amount);
          if (plannedDeduction <= 0) continue;

          const [existingPayment] = await tx
            .select()
            .from(loanPayments)
            .where(and(
              eq(loanPayments.loanId, loanId),
              eq(loanPayments.payrollRunId, run.id),
            ))
            .limit(1);
          const [loan] = await tx
            .select()
            .from(employeeLoans)
            .where(and(
              eq(employeeLoans.id, loanId),
              eq(employeeLoans.organizationId, run.organizationId),
            ))
            .limit(1);
          if (!loan || loan.employeeId !== entry.employeeId) {
            throw new Error(`Loan ${loanId} no longer matches this payroll entry.`);
          }
          // Even an existing payment must bind to this tenant and employee.
          // When exact settlement is enabled, an amount mismatch is NOT a
          // successful idempotent replay, and aborts the release transaction.
          if (existingPayment) {
            if (criticalReleaseFlagEnabled("exactPayrollLoanSettlement") &&
                !exactLoanPaymentReplayMatches(plannedDeduction, existingPayment.amount)) {
              throw new Error(`Loan ${loanId} prior payment amount differs from this release; recalculate payroll.`);
            }
            continue;
          }
          if (loan.status !== "active") {
            throw new Error(`Loan ${loanId} is no longer active; recalculate payroll before release.`);
          }

          // Exact-centavo validation is an explicit default-off rollout.
          const posting = payrollLoanPosting({
            loanId, plannedDeduction, remainingBalance: loan.remainingBalance,
            totalPaid: loan.totalPaid,
          });
          await tx.insert(loanPayments).values({
            loanId,
            payrollRunId: run.id,
            amount: posting.deduction,
            paymentDate: run.payDate,
            reference: `Auto-deduct ${run.periodLabel}`,
          });
          const [updatedLoan] = await tx.update(employeeLoans)
            .set({
              remainingBalance: posting.remainingBalance,
              totalPaid: posting.totalPaid,
              status: posting.status,
            })
            .where(and(
              eq(employeeLoans.id, loanId),
              eq(employeeLoans.organizationId, run.organizationId),
              eq(employeeLoans.status, "active"),
              eq(employeeLoans.remainingBalance, loan.remainingBalance),
              // Exact posting must not overwrite a concurrent total-paid edit
              // whose balance happened to remain unchanged.
              criticalReleaseFlagEnabled("exactPayrollLoanSettlement")
                ? eq(employeeLoans.totalPaid, loan.totalPaid) : undefined,
            ))
            .returning({ id: employeeLoans.id });
          if (!updatedLoan) {
            throw new Error(`Loan ${loanId} balance changed while payroll was being released; recalculate before release.`);
          }
          loanPaymentsSettled += 1;
        }
      }
    }

    if (spendPayrollEnabled()) {
      const missingClaimId = expectedSpendClaimIds.find(id => !seenExpenseClaimIds.has(id));
      if (missingClaimId !== undefined) {
        throw new Error("Newly approved reimbursement #" + missingClaimId +
          " is missing from the payroll register; recalculate before release.");
      }
    }

    const [released] = await tx.update(payrollRuns)
      .set({ status: "Released" })
      .where(and(
        eq(payrollRuns.id, runId),
        eq(payrollRuns.status, "Releasing"),
      ))
      .returning();

    if (!released) {
      throw new Error("Payroll release state changed during settlement.");
    }

    const settlement = {
      expensesSettled,
      advancesSettled,
      loanPaymentsSettled,
      leaveConversionsSettled,
      retroAdjustmentsSettled,
      supplementaryEarningsSettled,
      yearEndTaxAdjustmentsSettled,
    };

    // The release audit is part of the same transaction as the ledger changes.
    // A release is not considered committed if its audit record cannot be written.
    if (releaseAudit) {
      await tx.insert(auditEvents).values({
        organizationId: run.organizationId,
        actor: releaseAudit.actor,
        action: "Payroll released",
        resource: releaseAudit.resource,
        metadata: {
          ...(releaseAudit.metadata ?? {}),
          settlement,
        },
      });
    }

    return {
      run: released,
      settlement,
    };
  });
}
