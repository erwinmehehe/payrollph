import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, payrollEntries, payrollRuns } from "@/db/schema";
import { decryptBankAccount } from "@/lib/bank-account-crypto";
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
 *      does not draw from your card-payment proceeds directly. Linaw checks
 *      the available balance before submitting and stops on a shortfall.
 *   4. PAYMONGO_WALLET_ID is set. The source account is read from that wallet.
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

/**
 * PayMongo's create-batch-transfer schema makes `source_account` (number, name,
 * bic) mandatory on every transfer; omitting it is a 422. It must be one of the
 * accounts attached to the wallet being debited, so it is read from the wallet
 * itself rather than typed into configuration where it could drift.
 *
 * Docs: https://docs.paymongo.com/reference/retrieve-a-wallet
 *       https://docs.paymongo.com/reference/create-batch-transfer
 */
export type PaymongoSourceAccount = { number: string; name: string; bic: string };

export type PaymongoWallet = {
  id: string;
  status: string | null;
  availableCents: number;
  pendingCents: number;
  sourceAccount: PaymongoSourceAccount;
};

/** PayMongo's documented BIC for every PayMongo wallet account. */
const PAYMONGO_WALLET_BIC = "PAEYPHM2XXX";

function centavos(value: unknown): number | null {
  const amount = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof amount === "number" && Number.isFinite(amount) && Number.isInteger(amount) ? amount : null;
}

/**
 * Reads a Retrieve Wallet response. Fails closed on any field it cannot read:
 * a guessed balance or account number would either block real payroll or point
 * a transfer at the wrong source, and this module never invents either.
 */
export function parsePaymongoWallet(payload: unknown): PaymongoWallet {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const data = root.data && typeof root.data === "object" ? root.data : root;
  const wallet = (data.attributes && typeof data.attributes === "object" ? data.attributes : data) as Record<string, any>;

  const id = typeof data.id === "string" ? data.id : typeof wallet.id === "string" ? wallet.id : null;
  const available = centavos(wallet.balance?.available ?? wallet.available_balance);
  const pending = centavos(wallet.balance?.pending ?? wallet.pending_balance) ?? 0;
  const number = wallet.account?.account_number;
  const name = wallet.account?.account_name;

  if (!id || available === null || typeof number !== "string" || !number || typeof name !== "string" || !name) {
    throw new Error(
      "PayMongo's wallet response did not include the balance and source account Linaw needs. No transfer was attempted.",
    );
  }

  return {
    id,
    status: typeof wallet.status === "string" ? wallet.status : null,
    availableCents: available,
    pendingCents: pending,
    sourceAccount: { number, name, bic: PAYMONGO_WALLET_BIC },
  };
}

export async function getPaymongoWallet(): Promise<PaymongoWallet> {
  const secret = requirePaymongoSecret();
  const walletId = process.env.PAYMONGO_WALLET_ID?.trim();
  if (!walletId || !/^[A-Za-z0-9_-]+$/.test(walletId)) {
    throw new Error(
      "PAYMONGO_WALLET_ID is not configured. Set it to the wallet id shown under Money Movement -> Wallets in the PayMongo Dashboard.",
    );
  }

  const response = await fetch(`https://api.paymongo.com/v2/wallets/${encodeURIComponent(walletId)}`, {
    headers: { Accept: "application/json", Authorization: paymongoAuthorization(secret) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail ?? `PayMongo returned HTTP ${response.status} reading wallet ${walletId}.`);
  }
  const wallet = parsePaymongoWallet(payload);
  if (wallet.id !== walletId) {
    throw new Error(`PayMongo returned a different wallet than ${walletId}. No transfer was attempted.`);
  }
  return wallet;
}

export type WalletFunding = {
  availableCents: number;
  pendingCents: number;
  requiredCents: number;
  shortfallCents: number;
  sufficient: boolean;
};

/**
 * Only the available balance counts. Pending funds have not cleared, so
 * counting them would let a payout start that PayMongo then fails part-way.
 */
export function assessWalletFunding(wallet: PaymongoWallet, requiredCents: number): WalletFunding {
  const shortfallCents = Math.max(0, requiredCents - wallet.availableCents);
  return {
    availableCents: wallet.availableCents,
    pendingCents: wallet.pendingCents,
    requiredCents,
    shortfallCents,
    sufficient: shortfallCents === 0,
  };
}

function formatPeso(cents: number) {
  return `PHP ${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Throws before any transfer is created when the wallet cannot cover the batch. */
export function assertWalletFunded(wallet: PaymongoWallet, requiredCents: number): WalletFunding {
  if (wallet.status?.toLowerCase() === "deactivated") {
    throw new Error("The PayMongo wallet is deactivated. No transfer was attempted.");
  }
  const funding = assessWalletFunding(wallet, requiredCents);
  if (!funding.sufficient) {
    throw new Error(
      `The PayMongo wallet has ${formatPeso(funding.availableCents)} available but this payout needs ${formatPeso(requiredCents)}. Top up at least ${formatPeso(funding.shortfallCents)} and try again. No transfer was attempted.`,
    );
  }
  return funding;
}

export function buildBatchTransferPayload(
  rows: PayrollPayoutRow[],
  provider: "instapay" | "pesonet",
  bicByBankName: Map<string, string>,
  sourceAccount: PaymongoSourceAccount,
) {
  return {
    transfers: rows.map((row) => {
      const bic = bicByBankName.get(row.bankName);
      if (!bic) throw new Error(`No resolved BIC for bank "${row.bankName}" (employee ${row.employeeNo}).`);
      return {
        provider,
        amount: row.amountCents,
        currency: "PHP",
        source_account: sourceAccount,
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
    providerError: string | null;
    providerErrorCode: string | null;
  }>;
};


export type PayrollDisbursementPreflight = {
  provider: "instapay" | "pesonet";
  employeeCount: number;
  totalAmountCents: number;
  banks: Array<{ bankName: string; bic: string }>;
  wallet: WalletFunding & { id: string };
  /** False when the wallet cannot cover the run. Anything else failing throws. */
  ready: boolean;
};

/**
 * Safe live preflight: verifies credentials can read PayMongo's current
 * receiving-institution list, that every employee bank name resolves, and that
 * the wallet holds enough available funds. It only reads, and never calls the
 * batch-transfer endpoint, so it cannot move money.
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

  const totalAmountCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const wallet = await getPaymongoWallet();
  const funding = assessWalletFunding(wallet, totalAmountCents);

  return {
    provider,
    employeeCount: rows.length,
    totalAmountCents,
    banks,
    wallet: { id: wallet.id, ...funding },
    ready: funding.sufficient && wallet.status?.toLowerCase() !== "deactivated",
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

  // Read the wallet last, right before money moves, so the balance is as fresh
  // as it can be and a shortfall stops the run before any transfer exists.
  const wallet = await getPaymongoWallet();
  assertWalletFunded(wallet, rows.reduce((sum, row) => sum + row.amountCents, 0));

  const response = await fetch("https://api.paymongo.com/v2/batch_transfers", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: paymongoAuthorization(secret),
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(buildBatchTransferPayload(rows, provider, bicByBankName, wallet.sourceAccount)),
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
      provider_error?: string | null;
      provider_error_code?: string | null;
    }) => ({
      id: t.id,
      referenceNumber: t.reference_number,
      status: t.status,
      amountCents: t.amount,
      providerReferenceNumber: t.provider_reference_number ?? null,
      providerError: t.provider_error ?? null,
      providerErrorCode: t.provider_error_code ?? null,
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
    accountNumber: decryptBankAccount(employee.bankAccount) ?? "",
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
      provider_error?: string | null;
      provider_error_code?: string | null;
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
        providerError:
          typeof transfer.provider_error === "string" && transfer.provider_error
            ? transfer.provider_error
            : null,
        providerErrorCode:
          typeof transfer.provider_error_code === "string" && transfer.provider_error_code
            ? transfer.provider_error_code
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
