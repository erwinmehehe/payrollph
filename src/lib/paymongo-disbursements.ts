import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { paymongoAuthorization } from "@/lib/paymongo";

/**
 * PayMongo Disbursements (Transfers V2) as an alternative to negotiating
 * host-to-host access with each bank individually. Same PAYMONGO_SECRET_KEY
 * already used for billing checkout, this is a second use of the same
 * merchant account, not a new relationship.
 *
 * Docs: https://docs.paymongo.com/docs/money-movement-disbursements
 *       https://docs.paymongo.com/reference/create-batch-transfer
 *
 * Prerequisites the operator must confirm before setting
 * PAYMONGO_DISBURSEMENTS_ENABLED=true (this module cannot verify these
 * itself without a live call, and a wrong assumption here means real
 * payroll money going nowhere):
 *   1. The PayMongo account is a "Registered Business" (Sole Prop, Partnership,
 *      OPC, or Corporation), an Individual/Unregistered account cannot send
 *      to external banks or e-wallets at all.
 *   2. The Wallet is "Enabled" (not Closed-loop), check the banner under
 *      Money Movement -> Wallets in the PayMongo Dashboard.
 *   3. The wallet is funded, a disbursement debits the wallet balance, it
 *      does not draw from your card-payment proceeds directly.
 */

export type PayrollPayoutRow = {
  employeeNo: string;
  employeeName: string;
  accountNumber: string;
  bankName: string;
  amountCents: number;
  referenceNumber: string;
};

type ReceivingInstitution = { name: string; bic: string };

function requirePaymongoSecret(): string {
  const secret = process.env.PAYMONGO_SECRET_KEY;
  if (!secret) throw new Error("PAYMONGO_SECRET_KEY is not configured.");
  return secret;
}

/**
 * PayMongo's batch rule is one rail per batch. PayMongo's own guidance is to
 * use PESONet for payroll runs specifically (higher per-transaction cap,
 * designed for bulk settlement) rather than InstaPay, which is meant for
 * single time-sensitive payouts. We only drop to InstaPay for a genuine
 * single-recipient, sub-₱50,000 correction run.
 */
export function choosePayrollRail(rows: PayrollPayoutRow[]): "instapay" | "pesonet" {
  const INSTAPAY_CAP_CENTS = 50_000 * 100;
  const isSingleSmallPayout = rows.length === 1 && rows[0].amountCents <= INSTAPAY_CAP_CENTS;
  return isSingleSmallPayout ? "instapay" : "pesonet";
}

export async function listReceivingInstitutions(provider: "instapay" | "pesonet"): Promise<ReceivingInstitution[]> {
  const secret = requirePaymongoSecret();
  const response = await fetch(`https://api.paymongo.com/v2/transfers/receiving_institutions?provider=${provider}`, {
    headers: { Authorization: paymongoAuthorization(secret) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail ?? `PayMongo returned HTTP ${response.status} listing ${provider} institutions.`);
  }
  const list = payload?.data ?? payload?.institutions ?? [];
  return list.map((item: { name?: string; attributes?: { name?: string; bic?: string }; bic?: string }) => ({
    name: item.attributes?.name ?? item.name ?? "",
    bic: item.attributes?.bic ?? item.bic ?? "",
  }));
}

/**
 * Matches a free-text bank name (whatever is stored on the employee record,
 * e.g. "BDO", "BPI", "UnionBank") against PayMongo's live receiving
 * institutions list for the chosen rail. Deliberately does not ship a
 * hardcoded name->BIC table: bank BICs are exactly the kind of fact that is
 * wrong to guess from memory when the output routes real payroll money, and
 * PayMongo's supported-bank list changes over time. Always resolves against
 * the live list.
 */
export function matchReceivingInstitution(bankName: string, institutions: ReceivingInstitution[]): ReceivingInstitution {
  const needle = bankName.trim().toLowerCase();
  const match = institutions.find(
    (inst) => inst.name.toLowerCase().includes(needle) || needle.includes(inst.name.toLowerCase()),
  );
  if (!match) {
    throw new Error(
      `No receiving institution matched bank name "${bankName}". Check the employee's bank name against PayMongo's supported bank list before retrying.`,
    );
  }
  return match;
}

export function buildBatchTransferPayload(
  rows: PayrollPayoutRow[],
  provider: "instapay" | "pesonet",
  bicByBankName: Map<string, string>,
) {
  return {
    transfers: rows.map((row) => {
      const bic = bicByBankName.get(row.bankName);
      if (!bic) throw new Error(`No resolved BIC for bank "${row.bankName}" (employee ${row.employeeNo}).`);
      return {
        provider,
        amount: row.amountCents,
        currency: "PHP",
        destination_account: {
          number: row.accountNumber,
          name: row.employeeName,
          bic,
        },
        reference_number: row.referenceNumber,
        purpose: "Payroll disbursement",
        description: `Payroll payout for ${row.employeeName} (${row.employeeNo})`,
      };
    }),
  };
}

export type BatchDisbursementResult = {
  batchId: string;
  provider: "instapay" | "pesonet";
  transfers: Array<{
    id: string;
    referenceNumber: string;
    status: string;
    amountCents: number;
    providerReferenceNumber: string | null;
  }>;
};


export type PayrollDisbursementPreflight = {
  provider: "instapay" | "pesonet";
  employeeCount: number;
  totalAmountCents: number;
  banks: Array<{ bankName: string; bic: string }>;
  ready: true;
};

/**
 * Safe live preflight: verifies credentials can read PayMongo's current
 * receiving-institution list and that every employee bank name resolves.
 * It never calls the batch-transfer endpoint and therefore cannot move money.
 */
export async function preflightPaymongoPayrollDisbursement(runId: number): Promise<PayrollDisbursementPreflight> {
  const rows = await loadPayrollPayoutRows(runId);
  if (rows.length === 0) throw new Error("No payroll payout rows found for this run.");

  const missingAccounts = rows.filter((row) => !row.accountNumber || !row.bankName);
  if (missingAccounts.length > 0) {
    throw new Error(
      `${missingAccounts.length} employee(s) are missing a bank account or bank name: ${missingAccounts.map((row) => row.employeeNo).join(", ")}.`,
    );
  }

  const provider = choosePayrollRail(rows);
  const institutions = await listReceivingInstitutions(provider);
  const banks = [...new Set(rows.map((row) => row.bankName))].map((bankName) => {
    const institution = matchReceivingInstitution(bankName, institutions);
    return { bankName, bic: institution.bic };
  });

  return {
    provider,
    employeeCount: rows.length,
    totalAmountCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
    banks,
    ready: true,
  };
}

/**
 * Submits one PayMongo batch transfer for a set of payroll payout rows.
 * Caller is responsible for idempotencyKey, reuse the same key on retry of
 * the same run, use a new one for a genuinely new run, per PayMongo's
 * idempotency guidance.
 */
export async function createPaymongoBatchDisbursement(
  rows: PayrollPayoutRow[],
  idempotencyKey: string,
): Promise<BatchDisbursementResult> {
  if (rows.length === 0) throw new Error("No payout rows to disburse.");
  if (rows.length > 1000) throw new Error("PayMongo batch disbursements are capped at 1,000 transfers. Split this run into multiple batches.");

  const secret = requirePaymongoSecret();
  const provider = choosePayrollRail(rows);
  const institutions = await listReceivingInstitutions(provider);

  const bicByBankName = new Map<string, string>();
  for (const bankName of new Set(rows.map((row) => row.bankName))) {
    bicByBankName.set(bankName, matchReceivingInstitution(bankName, institutions).bic);
  }

  const response = await fetch("https://api.paymongo.com/v2/batch_transfers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: paymongoAuthorization(secret),
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(buildBatchTransferPayload(rows, provider, bicByBankName)),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail ?? `PayMongo returned HTTP ${response.status} creating the batch transfer.`);
  }

  const batchId = payload?.data?.id;
  const transfers = payload?.data?.transfers ?? [];
  if (!batchId) throw new Error("PayMongo returned a batch transfer response without an id.");

  return {
    batchId,
    provider,
    transfers: transfers.map((t: {
      id: string;
      reference_number: string;
      status: string;
      amount: number;
      provider_reference_number?: string | null;
    }) => ({
      id: t.id,
      referenceNumber: t.reference_number,
      status: t.status,
      amountCents: t.amount,
      providerReferenceNumber: t.provider_reference_number ?? null,
    })),
  };
}

/** Loads a payroll run's entries and shapes them for createPaymongoBatchDisbursement. */
export async function loadPayrollPayoutRows(runId: number): Promise<PayrollPayoutRow[]> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found.");

  const entries = await db
    .select({ entry: payrollEntries, employee: employees })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(eq(payrollEntries.payrollRunId, runId))
    .orderBy(asc(employees.id));

  return entries.map(({ entry, employee }) => ({
    employeeNo: employee.employeeNo,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    accountNumber: employee.bankAccount ?? "",
    bankName: employee.bankCode ?? "",
    amountCents: Math.round(Number(entry.netPay) * 100),
    referenceNumber: `PAY-${run.id}-${employee.employeeNo}`,
  }));
}

export async function createPaymongoPayrollDisbursement(runId: number): Promise<BatchDisbursementResult> {
  const rows = await loadPayrollPayoutRows(runId);
  const missingAccounts = rows.filter((row) => !row.accountNumber || !row.bankName);
  if (missingAccounts.length > 0) {
    throw new Error(
      `${missingAccounts.length} employee(s) are missing a bank account or bank name, fix these before disbursing: ${missingAccounts.map((r) => r.employeeNo).join(", ")}.`,
    );
  }
  return createPaymongoBatchDisbursement(rows, `payroll-run-${runId}`);
}


/**
 * Reads PayMongo's current batch state. This is the authoritative provider read
 * used by payout reconciliation; it never creates or retries a transfer.
 */
export async function getPaymongoBatchDisbursement(batchId: string): Promise<BatchDisbursementResult> {
  if (!/^batch_tr_[A-Za-z0-9_-]+$/.test(batchId)) {
    throw new Error("Invalid PayMongo batch transfer id.");
  }

  const secret = requirePaymongoSecret();
  const response = await fetch(`https://api.paymongo.com/v2/batch_transfers/${encodeURIComponent(batchId)}`, {
    headers: {
      Accept: "application/json",
      Authorization: paymongoAuthorization(secret),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.errors?.[0]?.detail ?? `PayMongo returned HTTP ${response.status} reading batch ${batchId}.`,
    );
  }

  const returnedBatchId = payload?.data?.id;
  const transfers = Array.isArray(payload?.data?.transfers) ? payload.data.transfers : [];
  if (returnedBatchId !== batchId) {
    throw new Error(`PayMongo returned an unexpected batch id while reconciling ${batchId}.`);
  }
  if (transfers.length === 0) {
    throw new Error(`PayMongo batch ${batchId} returned no transfers.`);
  }

  const provider = transfers[0]?.provider;
  if (provider !== "instapay" && provider !== "pesonet") {
    throw new Error(`PayMongo batch ${batchId} returned an unsupported transfer provider.`);
  }

  return {
    batchId,
    provider,
    transfers: transfers.map((transfer: {
      id?: string;
      reference_number?: string;
      status?: string;
      amount?: number;
      provider?: string;
      provider_reference_number?: string | null;
    }) => {
      if (
        typeof transfer.id !== "string"
        || typeof transfer.reference_number !== "string"
        || typeof transfer.status !== "string"
        || !Number.isFinite(Number(transfer.amount))
        || transfer.provider !== provider
      ) {
        throw new Error(`PayMongo batch ${batchId} returned a malformed transfer.`);
      }
      return {
        id: transfer.id,
        referenceNumber: transfer.reference_number,
        status: transfer.status,
        amountCents: Number(transfer.amount),
        providerReferenceNumber:
          typeof transfer.provider_reference_number === "string"
            ? transfer.provider_reference_number
            : null,
      };
    }),
  };
}

export function buildPayrollRetryIdempotencyKey(
  runId: number,
  sourceBatchIds: string[],
  referenceNumbers: string[],
) {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      runId,
      sourceBatchIds: [...sourceBatchIds].sort(),
      referenceNumbers: [...referenceNumbers].sort(),
    }))
    .digest("hex")
    .slice(0, 24);
  return `payroll-run-${runId}-retry-${digest}`;
}

export async function createPaymongoPayrollRetry(input: {
  runId: number;
  referenceNumbers: string[];
  sourceBatchIds: string[];
}): Promise<BatchDisbursementResult> {
  const requested = new Set(input.referenceNumbers);
  if (requested.size === 0) throw new Error("There are no failed transfers to retry.");

  const rows = await loadPayrollPayoutRows(input.runId);
  const retryRows = rows.filter((row) => requested.has(row.referenceNumber));
  if (retryRows.length !== requested.size) {
    const found = new Set(retryRows.map((row) => row.referenceNumber));
    const missing = [...requested].filter((reference) => !found.has(reference));
    throw new Error(`Retry references no longer match the released payroll: ${missing.join(", ")}.`);
  }

  const missingAccounts = retryRows.filter((row) => !row.accountNumber || !row.bankName);
  if (missingAccounts.length > 0) {
    throw new Error(
      `${missingAccounts.length} failed payout(s) now lack bank instructions: ${missingAccounts.map((row) => row.employeeNo).join(", ")}.`,
    );
  }

  return createPaymongoBatchDisbursement(
    retryRows,
    buildPayrollRetryIdempotencyKey(input.runId, input.sourceBatchIds, input.referenceNumbers),
  );
}
