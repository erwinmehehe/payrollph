import { createHmac, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, payrollEntries, payrollRuns, payoutBatches, payoutProfiles } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { payoutCentsFromNetPay } from "@/lib/payout-ledger-rules";
import { loadPayrollPayoutRows } from "@/lib/paymongo-disbursements";
import { prepareInitialPayoutBatch } from "@/lib/payout-ledger";
import { withPayrollRunPayoutLock } from "@/lib/payroll-run-payout-lock";
import { xenditPayrollLiveReadiness } from "@/lib/payroll-payout-provider";
import {
  buildXenditPayrollPayout, createXenditPayrollPayout, getXenditPayrollPayout,
  type XenditPayrollPayee,
} from "@/lib/xendit-payroll-payouts";
import {
  xenditPayoutLedger, claimNextXenditPayout, markXenditPayoutUnknown,
  recordXenditPayoutObservation, type XenditPayoutLedgerRow,
} from "@/lib/xendit-payout-ledger";
import { latestApprovedPayoutDestinationChangeForRun } from "@/lib/payout-destination-controls";

type PayrollRun = typeof payrollRuns.$inferSelect;

/** Produce API-compatible integer cents without silently losing precision. */
function checkedXenditPayeeTotalCents(rows: readonly { payee: XenditPayrollPayee }[]): number {
  const cents = rows.reduce((total, row) => total + BigInt(row.payee.amountCents), BigInt(0));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(0)) {
    throw new Error("XENDIT_UNSAFE_PAYOUT_TOTAL_CENTAVOS");
  }
  return Number(cents);
}

async function xenditFrozenPayroll(run: PayrollRun) {
  if (run.status !== "Released") throw new Error("Xendit payouts require a released payroll run.");
  if (!run.legalEntityId) throw new Error("Select the actual legal employer before Xendit payout.");
  const [configuredProfile] = await db.select({
    defaultMethod: payoutProfiles.defaultMethod, active: payoutProfiles.active,
  }).from(payoutProfiles).where(and(
    eq(payoutProfiles.organizationId, run.organizationId),
    eq(payoutProfiles.legalEntityId, run.legalEntityId),
  )).limit(1);
  if (configuredProfile?.active && configuredProfile.defaultMethod !== "xendit") {
    throw new Error("This legal employer explicitly selected another active payout method. Switch its approved profile to Xendit before preflighting salary.");
  }
  const [payees, staff, entries] = await Promise.all([
    loadPayrollPayoutRows(run.id),
    db.select().from(employees).where(eq(employees.organizationId, run.organizationId)),
    db.select({ id: payrollEntries.id, employeeId: payrollEntries.employeeId,
      netPay: payrollEntries.netPay }).from(payrollEntries)
      .where(eq(payrollEntries.payrollRunId, run.id)),
  ]);
  const byNo = new Map(staff.map((e) => [e.employeeNo, e]));
  const entryById = new Map(entries.map((e) => [e.employeeId, e]));
  const rows: Array<{ payee: XenditPayrollPayee; employeeId: number; payrollEntryId: number }> = [];
  for (const row of payees) {
    if (row.amountCents === 0) continue;
    const employee = byNo.get(row.employeeNo);
    const entry = employee ? entryById.get(employee.id) : undefined;
    if (!employee || !entry || employee.organizationId !== run.organizationId
      || payoutCentsFromNetPay(entry.netPay) !== row.amountCents) {
      throw new Error("XENDIT_RELEASED_EMPLOYEE_IDENTITY_OR_AMOUNT_MISMATCH");
    }
    const payee: XenditPayrollPayee = {
      ...row, firstName: employee.firstName, lastName: employee.lastName,
    };
    // No network call. Route, name, currency and minor units must validate
    // before any transfer in the run is claimed.
    buildXenditPayrollPayout(payee);
    rows.push({ payee, employeeId: employee.id, payrollEntryId: entry.id });
  }
  if (!rows.length) throw new Error("No positive-net-pay employees to disburse.");
  if (rows.reduce((total, row) => total + BigInt(row.payee.amountCents), BigInt(0)) !== BigInt(payoutCentsFromNetPay(run.netPay))) {
    throw new Error("XENDIT_RELEASED_PAYROLL_TOTAL_MISMATCH");
  }
  const secret = process.env.XENDIT_PAYOUT_SECRET_KEY?.trim();
  if (!secret) throw new Error("Xendit payroll MONEY-OUT key is required even for payout preflight.");
  const businessId = process.env.XENDIT_PAYOUT_BUSINESS_ID?.trim();
  if (!businessId) throw new Error("Xendit payout business ID is required.");
  const fingerprint = createHmac("sha256", secret)
    .update(JSON.stringify({
      organizationId: run.organizationId, legalEntityId: run.legalEntityId,
      runId: run.id, businessId,
      rows: rows.map(({ payee, employeeId, payrollEntryId }) => ({
        employeeId, payrollEntryId, payee,
      })),
    })).digest("hex");
  return { rows, businessId, fingerprint };
}

async function latestPassedXenditPreflight(run: PayrollRun) {
  // Scope before LIMIT: unrelated tenant audit traffic must never evict a valid receipt.
  const [event] = await db.select().from(auditEvents).where(and(
    eq(auditEvents.organizationId, run.organizationId),
    eq(auditEvents.action, "Xendit payroll preflight passed"),
    sql`${auditEvents.metadata} ->> 'runId' = ${String(run.id)}`,
  )).orderBy(desc(auditEvents.id)).limit(1);
  return event ?? null;
}

/**
 * Historical payout audit actions may predate the provider-wide payout ledger.
 * An already uploaded bank file has an UNKNOWN external outcome until verified,
 * so neither preflight nor submit may silently switch to Xendit.
 */
async function assertNoPriorPayrollDisbursement(run: PayrollRun) {
  const disbursementActions = [
    "Payroll payout completed manually",
    "Payroll payout submission initiated via PayMongo",
    "Payroll payout retry submission initiated via PayMongo",
    "Payroll payout retry outcome unknown",
    "Payroll payout submitted via PayMongo",
    "Payroll payout retry submitted via PayMongo",
    "Payroll payout completed via PayMongo",
    "PayMongo transfer webhook received",
    "bank export generated",
  ];
  const conflicts = await db.select({ id: auditEvents.id })
    .from(auditEvents).where(and(
      eq(auditEvents.organizationId, run.organizationId),
      inArray(auditEvents.action, disbursementActions),
      sql`${auditEvents.metadata} ->> 'runId' = ${String(run.id)}`,
      sql`(${auditEvents.action} <> 'bank export generated'
        OR (${auditEvents.metadata} ->> 'kind' = 'bank'
          AND COALESCE(${auditEvents.metadata} ->> 'dryRun', 'false') <> 'true'))`,
    )).limit(1);
  if (conflicts.length > 0) {
    throw new Error("XENDIT_PREVIOUS_PAYOUT_OR_BANK_FILE_UNCERTAIN: Existing manual, PayMongo, or final bank-file payout evidence must be independently reconciled. Never send salary again through a different provider.");
  }
}

export async function preflightXenditPayroll(run: PayrollRun, actor: string) {
  await assertNoPriorPayrollDisbursement(run);
  const readiness = xenditPayrollLiveReadiness({
    organizationId: run.organizationId, legalEntityId: run.legalEntityId,
  });
  const frozen = await xenditFrozenPayroll(run);
  const existing = await db.select().from(payoutBatches).where(and(
    eq(payoutBatches.organizationId, run.organizationId),
    eq(payoutBatches.payrollRunId, run.id),
  )).limit(1);
  if (existing[0] && existing[0].provider !== "xendit") {
    throw new Error("This payroll has already been staged for a different payment provider.");
  }
  const ready = readiness.ready;
  await recordAuditEvent({
    organizationId: run.organizationId, actor,
    action: ready ? "Xendit payroll preflight passed" : "Xendit payroll preflight blocked",
    resource: run.periodLabel,
    metadata: {
      runId: run.id, legalEntityId: run.legalEntityId,
      businessId: frozen.businessId, fingerprint: frozen.fingerprint,
      transferCount: frozen.rows.length,
      amountCents: checkedXenditPayeeTotalCents(frozen.rows),
      moneyMovedByLinaw: false,
      ...(ready ? {} : { blockers: readiness.blockers }),
    },
  });
  return { ready, provider: "xendit" as const, transferCount: frozen.rows.length,
    totalAmountCents: checkedXenditPayeeTotalCents(frozen.rows),
    blockers: readiness.blockers, moneyMoved: false };
}

export async function submitXenditPayroll(run: PayrollRun, actor: string) {
  await assertNoPriorPayrollDisbursement(run);
  if (run.status !== "Released" || !run.legalEntityId) throw new Error("A released legal-employer payroll is required.");
  const readiness = xenditPayrollLiveReadiness({
    organizationId: run.organizationId, legalEntityId: run.legalEntityId,
  });
  if (!readiness.ready) throw new Error(`Xendit live payout is disabled: ${readiness.blockers.join(" ")}`);
  const lastPreflight = await latestPassedXenditPreflight(run);
  if (!lastPreflight) throw new Error("Complete the authorized no-money Xendit preflight first.");
  const frozen = await xenditFrozenPayroll(run);
  const preflightMeta = lastPreflight.metadata as Record<string, unknown>;
  if (preflightMeta.fingerprint !== frozen.fingerprint
    || preflightMeta.businessId !== frozen.businessId
    || preflightMeta.legalEntityId !== run.legalEntityId) {
    throw new Error("Frozen payout destinations, amount or legal employer changed since preflight.");
  }
  if (await latestApprovedPayoutDestinationChangeForRun({
    organizationId: run.organizationId, runId: run.id, after: lastPreflight.createdAt,
  })) throw new Error("Payout destination changed after preflight. Revalidate before sending.");

  const initial = await xenditPayoutLedger(run.organizationId, run.id);
  if (!initial) {
    await withPayrollRunPayoutLock(run.organizationId, run.id, async () => {
      // Another process might have generated an externally uploaded bank
      // file while we fetched the frozen payroll or validated preflight.
      // The prior-file check and durable ledger claim must be atomic relative
      // to final bank-file generation, including concurrent requests.
      await assertNoPriorPayrollDisbursement(run);
      const rechecked = await xenditPayoutLedger(run.organizationId, run.id);
      if (rechecked) return;
      await prepareInitialPayoutBatch({
        organizationId: run.organizationId, payrollRunId: run.id, provider: "xendit",
        intents: frozen.rows.map(({ payee, employeeId, payrollEntryId }) => ({
          employeeId, payrollEntryId, referenceNumber: payee.referenceNumber,
          amountCents: payee.amountCents,
        })),
      });
    });
  }
  const submitted: string[] = [];
  for (let number = 0; number < 3; number += 1) {
    const claimed = await claimNextXenditPayout({
      organizationId: run.organizationId, payrollRunId: run.id,
    });
    if (!claimed) break;
    const owner = frozen.rows.find((r) => r.payee.referenceNumber === claimed.referenceNumber);
    if (!owner || owner.payee.amountCents !== claimed.amountCents || owner.payrollEntryId !== claimed.payrollEntryId) {
      await markXenditPayoutUnknown({
        organizationId: run.organizationId, payrollRunId: run.id,
        referenceNumber: claimed.referenceNumber,
      });
      throw new Error("Xendit instruction no longer matches frozen payroll. Reconciliation required.");
    }
    try {
      const provider = await createXenditPayrollPayout(owner.payee, {
        organizationId: run.organizationId, payrollRunId: run.id,
        businessId: frozen.businessId,
      });
      await recordXenditPayoutObservation({
        organizationId: run.organizationId, payrollRunId: run.id,
        referenceNumber: claimed.referenceNumber,
        amountCents: claimed.amountCents, providerPayoutId: provider.payoutId,
        providerBusinessId: provider.businessId, expectedBusinessId: frozen.businessId,
        providerStatus: provider.status,
      });
      submitted.push(claimed.referenceNumber);
    } catch {
      await markXenditPayoutUnknown({
        organizationId: run.organizationId, payrollRunId: run.id,
        referenceNumber: claimed.referenceNumber,
      });
      // This may already have moved money: never automatically retry.
      throw new Error(`Xendit payout outcome for ${claimed.referenceNumber} is uncertain. STOP: check Xendit by reference and reconcile the provider payout ID before continuing.`);
    }
  }
  const ledger = await xenditPayoutLedger(run.organizationId, run.id);
  await recordAuditEvent({
    organizationId: run.organizationId, actor,
    action: "Payroll payout submitted via Xendit",
    resource: run.periodLabel,
    metadata: { runId: run.id, submittedReferences: submitted, transferCount: submitted.length,
      provider: "xendit", moneyMovedByLinaw: submitted.length > 0 },
  });
  return { submitted, ledger, complete: ledger?.counts.prepared === 0 && ledger?.counts.unknown === 0 };
}

/**
 * A reconciliation request is a provider READ, never a new payout. Persist a
 * per-attempt receipt before every lookup, including failed/time-out lookups.
 * Repeated operator requests remain traceable to the original transfer.
 */
async function auditedXenditPayoutLookup(input: {
  run: PayrollRun;
  actor: string;
  row: XenditPayoutLedgerRow;
  payoutId: string;
  businessId: string;
}) {
  const attemptId = randomUUID();
  const [firstAttempt] = await db.select({ metadata: auditEvents.metadata })
    .from(auditEvents).where(and(
      eq(auditEvents.organizationId, input.run.organizationId),
      eq(auditEvents.action, "Xendit payout read-only lookup initiated"),
      sql`${auditEvents.metadata} ->> 'transferId' = ${String(input.row.transferId)}`,
    )).orderBy(asc(auditEvents.id)).limit(1);
  const priorId = firstAttempt?.metadata && typeof firstAttempt.metadata === "object"
    ? (firstAttempt.metadata as Record<string, unknown>).attemptId : null;
  const evidence = {
    runId: input.run.id,
    transferId: input.row.transferId,
    referenceNumber: input.row.referenceNumber,
    providerPayoutId: input.payoutId,
    attemptId,
    retryOfAttemptId: typeof priorId === "string" ? priorId : null,
    provider: "xendit",
    moneyMovedByLinaw: false,
  };
  const base = {
    organizationId: input.run.organizationId,
    actor: input.actor,
    resource: `payroll-run-${input.run.id}`,
  };
  await recordAuditEvent({
    ...base, action: "Xendit payout read-only lookup initiated", metadata: evidence,
  });
  try {
    const provider = await getXenditPayrollPayout(input.payoutId, {
      referenceNumber: input.row.referenceNumber,
      amountCents: input.row.amountCents,
      businessId: input.businessId,
    });
    await recordAuditEvent({
      ...base, action: "Xendit payout read-only lookup completed",
      metadata: { ...evidence, providerStatus: provider.status },
    });
    return provider;
  } catch (error) {
    await recordAuditEvent({
      ...base, action: "Xendit payout read-only lookup failed",
      metadata: {
        ...evidence,
        error: error instanceof Error ? error.message.slice(0, 240) : "Provider lookup failed",
        outcomeVerified: false,
      },
    });
    throw error;
  }
}

export async function reconcileXenditPayroll(run: PayrollRun, actor: string, cursor = 0) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid reconciliation cursor.");
  const businessId = process.env.XENDIT_PAYOUT_BUSINESS_ID?.trim();
  if (!businessId) throw new Error("Xendit payout business ID is not configured.");
  const ledger = await xenditPayoutLedger(run.organizationId, run.id);
  if (!ledger) throw new Error("No Xendit payout ledger for this run.");
  const queryable = ledger.rows.filter((row) => row.providerPayoutId
    && ["submitted", "succeeded", "failed", "reversed"].includes(row.status));
  const page = queryable.filter((row) => row.transferId > cursor).slice(0, 10);
  const nextCursor = page.at(-1)?.transferId ?? cursor;
  const hasMore = queryable.some((row) => row.transferId > nextCursor);
  const updated: string[] = [];
  for (const row of page) {
    const provider = await auditedXenditPayoutLookup({
      run, actor, row, payoutId: row.providerPayoutId!, businessId,
    });
    await recordXenditPayoutObservation({
      organizationId: run.organizationId, payrollRunId: run.id,
      referenceNumber: row.referenceNumber, amountCents: row.amountCents,
      providerPayoutId: provider.payoutId, providerBusinessId: provider.businessId,
      expectedBusinessId: businessId, providerStatus: provider.status,
    });
    updated.push(row.referenceNumber);
  }
  await recordAuditEvent({
    organizationId: run.organizationId, actor, action: "Xendit payout provider reconciled",
    resource: run.periodLabel, metadata: { runId: run.id, checked: updated.length,
      moneyMovedByLinaw: false },
  });
  return { checked: updated.length, nextCursor, hasMore,
    ledger: await xenditPayoutLedger(run.organizationId, run.id) };
}

export async function resolveUnknownXenditPayroll(input: {
  run: PayrollRun; actor: string; referenceNumber: string; payoutId: string;
}) {
  const businessId = process.env.XENDIT_PAYOUT_BUSINESS_ID?.trim();
  if (!businessId) throw new Error("Xendit payout business ID is not configured.");
  const ledger = await xenditPayoutLedger(input.run.organizationId, input.run.id);
  const row = ledger?.rows.find((r) => r.referenceNumber === input.referenceNumber);
  if (!row || row.status !== "reconciliation_required" || row.providerPayoutId) {
    throw new Error("Only an unresolved, unlinked Xendit payout can be manually matched.");
  }
  // This is read-only at the provider. A missing ID must never trigger a new payout.
  const provider = await auditedXenditPayoutLookup({
    run: input.run, actor: input.actor, row, payoutId: input.payoutId, businessId,
  });
  await recordXenditPayoutObservation({
    organizationId: input.run.organizationId, payrollRunId: input.run.id,
    referenceNumber: row.referenceNumber, amountCents: row.amountCents,
    providerPayoutId: provider.payoutId, providerBusinessId: provider.businessId,
    expectedBusinessId: businessId, providerStatus: provider.status,
  });
  await recordAuditEvent({
    organizationId: input.run.organizationId, actor: input.actor,
    action: "Xendit unknown payout linked after provider read-only verification",
    resource: input.run.periodLabel,
    metadata: { runId: input.run.id, referenceNumber: row.referenceNumber,
      providerPayoutId: provider.payoutId, settlementVerified: provider.status === "SUCCEEDED" },
  });
  return await xenditPayoutLedger(input.run.organizationId, input.run.id);
}
