import { timingSafeEqual } from "node:crypto";
import { criticalReleaseFlagEnabled } from "./critical-release-flags";

export const XENDIT_PAYROLL_API_VERSION = "2025-09-01";
const XENDIT_PAYOUT_ENDPOINT = "https://api.xendit.co/v3/payouts";
const SWIFT = /^[A-Z]{4}PH[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const REFERENCE = /^PAY-[1-9]\d*-[A-Za-z0-9_-]+$/;
const PAYOUT_ID = /^po-[A-Za-z0-9-]{8,90}$/;

export type XenditPayrollPayee = {
  employeeNo: string;
  employeeName: string;
  firstName: string;
  lastName: string;
  accountNumber: string;
  bankName: string;
  amountCents: number;
  referenceNumber: string;
};

export type XenditPayoutResponse = {
  payoutId: string;
  referenceNumber: string;
  status: string;
  amountCents: number;
  businessId: string;
};

type XenditConfig = Readonly<Record<string, string | undefined>>;

const VERIFIED_BANK_SWIFT: Record<string, string> = {
  BDO: "BNORPHMM",
  BPI: "BOPIPHMM",
};

function bankRouting(bankName: string, env: XenditConfig): {
  routingType: "SWIFT" | "WALLET";
  routingValue: string;
} {
  const key = bankName.trim().toUpperCase();
  if (key === "GCASH" || key === "PH_GCASH") {
    return { routingType: "WALLET", routingValue: "PH_GCASH" };
  }
  let provided: unknown = {};
  if (env.XENDIT_PAYOUT_VERIFIED_BANK_BICS_JSON?.trim()) {
    try {
      provided = JSON.parse(env.XENDIT_PAYOUT_VERIFIED_BANK_BICS_JSON);
    } catch {
      throw new Error("Xendit payroll bank mapping JSON is invalid; no payout sent.");
    }
    if (!provided || typeof provided !== "object" || Array.isArray(provided)) {
      throw new Error("Xendit payroll bank mapping must be an object; no payout sent.");
    }
  }
  const extra = provided as Record<string, unknown>;
  const code = typeof extra[key] === "string" ? extra[key].trim().toUpperCase() : VERIFIED_BANK_SWIFT[key];
  if (!code || !SWIFT.test(code)) {
    throw new Error(`Unverified Xendit SWIFT/BIC for payout bank "${bankName}". Configure and confirm its routing before payroll.`);
  }
  return { routingType: "SWIFT", routingValue: code };
}

export function buildXenditPayrollPayout(
  row: XenditPayrollPayee,
  env: XenditConfig = process.env,
) {
  if (!REFERENCE.test(row.referenceNumber) || row.referenceNumber.length > 120) {
    throw new Error("Xendit payroll reference is invalid.");
  }
  if (!Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) {
    throw new Error("Xendit requires a positive exact-centavo payout amount.");
  }
  const first = row.firstName.trim();
  const last = row.lastName.trim();
  const holder = row.employeeName.trim().replace(/\s+/g, " ");
  if (!first || !last || first.length > 50 || last.length > 50
    || !holder || holder.length > 255
    || !holder.toLowerCase().startsWith(first.toLowerCase() + " ")
    || !holder.toLowerCase().endsWith(" " + last.toLowerCase())) {
    throw new Error("Xendit payroll recipient name differs from the released payroll snapshot; no payout sent.");
  }
  if (!/^\d{7,24}$/.test(row.accountNumber)) {
    throw new Error("Xendit payroll recipient account number is invalid; no payout sent.");
  }
  const routing = bankRouting(row.bankName, env);
  return {
    reference_id: row.referenceNumber,
    recipient: {
      type: "INDIVIDUAL" as const,
      given_name: first,
      surname: last,
      relationship: "EMPLOYEE" as const,
      account_details: {
        currency: "PHP" as const,
        account_country: "PH" as const,
        account_holder_name: holder,
        account_number: row.accountNumber,
        routing_type_1: routing.routingType,
        routing_value_1: routing.routingValue,
      },
      address: { country: "PH" as const },
    },
    payout_details: {
      source_currency: "PHP" as const,
      source_amount: row.amountCents,
      destination_currency: "PHP" as const,
    },
    source_of_fund: "BUSINESS_REVENUE" as const,
    purpose_code: "SALARY" as const,
    description: `Salary ${row.referenceNumber}`.slice(0, 100),
  };
}

export function xenditPayrollPayoutIdempotencyKey(organizationId: number, runId: number, employeeNo: string) {
  if (![organizationId, runId].every((value) => Number.isSafeInteger(value) && value > 0)
    || !/^[A-Za-z0-9_-]{1,32}$/.test(employeeNo)) {
    throw new Error("Xendit payout identity is invalid.");
  }
  const key = `linaw-ph-${organizationId}-${runId}-${employeeNo}`;
  if (key.length > 100) throw new Error("Xendit payout idempotency key is too long.");
  return key;
}

export function normalizeXenditPayout(
  raw: unknown,
  expected: { referenceNumber: string; amountCents: number; businessId: string },
): XenditPayoutResponse {
  const payload = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown> : {};
  const payoutId = payload.payout_id;
  const reference = payload.reference_id;
  const status = payload.status;
  const amount = payload.source_amount;
  const currency = payload.source_currency;
  const dest = payload.destination_currency;
  const businessId = payload.business_id;
  const allowed = [
    "ACCEPTED", "PENDING_COMPLIANCE_ASSESSMENT", "PENDING_COMPLIANCE_REVIEW", "REJECTED",
    "ROUTING", "REQUESTED", "READY", "LOCKED", "EXPIRED",
    "FAILED", "SUCCEEDED", "CANCELLED", "REVERSED",
  ];
  if (typeof payoutId !== "string" || !PAYOUT_ID.test(payoutId)
    || reference !== expected.referenceNumber
    || typeof status !== "string" || !allowed.includes(status)
    || !Number.isSafeInteger(amount) || amount !== expected.amountCents
    || currency !== "PHP" || dest !== "PHP"
    || typeof businessId !== "string" || businessId !== expected.businessId) {
    throw new Error("Xendit payout identity, amount, business, currency or status did not match the frozen instruction. Reconciliation required.");
  }
  return {
    payoutId,
    referenceNumber: reference,
    status,
    amountCents: amount,
    businessId,
  };
}

export function xenditPayoutState(status: string) {
  switch (status) {
    case "SUCCEEDED": return "succeeded" as const;
    case "FAILED":
    case "REJECTED":
    case "EXPIRED":
    case "CANCELLED": return "failed" as const;
    case "REVERSED": return "reversed" as const;
    case "ACCEPTED":
    case "REQUESTED":
    case "ROUTING":
    case "READY":
    case "LOCKED":
    case "PENDING_COMPLIANCE_ASSESSMENT":
    case "PENDING_COMPLIANCE_REVIEW": return "pending" as const;
    default: return "unknown" as const;
  }
}

export function verifyXenditPayoutWebhookToken(
  supplied: string | null,
  expected: string | undefined,
): boolean {
  if (!supplied || !expected || expected.length < 16) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeXenditPayoutWebhook(
  raw: unknown,
  expectedBusinessId: string,
) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (!data.business_id || data.business_id !== expectedBusinessId
    || typeof data.event !== "string" || !data.event.startsWith("v3_payout.")
    || !data.data || typeof data.data !== "object") return null;
  const payload = data.data as Record<string, unknown>;
  const events: Record<string, string> = {
    "v3_payout.succeeded": "SUCCEEDED",
    "v3_payout.failed": "FAILED",
    "v3_payout.reversed": "REVERSED",
    "v3_payout.rejected": "REJECTED",
    "v3_payout.pending_compliance": "PENDING_COMPLIANCE_ASSESSMENT",
  };
  const expectedStatus = events[data.event];
  if (!expectedStatus || (payload.status !== expectedStatus
    && !(expectedStatus === "PENDING_COMPLIANCE_ASSESSMENT" && payload.status === "PENDING_COMPLIANCE_REVIEW"))
    || typeof payload.payout_id !== "string" || !PAYOUT_ID.test(payload.payout_id)
    || typeof payload.reference_id !== "string" || !REFERENCE.test(payload.reference_id)
    || !Number.isSafeInteger(payload.source_amount) || Number(payload.source_amount) <= 0
    || payload.source_currency !== "PHP"
    || payload.destination_currency !== "PHP"
    || (payload.business_id && payload.business_id !== expectedBusinessId)) return null;
  return {
    payoutId: payload.payout_id,
    referenceNumber: payload.reference_id,
    amountCents: payload.source_amount as number,
    status: expectedStatus,
    event: data.event,
  };
}

function xenditAuth(env: XenditConfig): string {
  const key = env.XENDIT_PAYOUT_SECRET_KEY?.trim();
  if (!key) throw new Error("Dedicated Xendit payroll payout key is not configured.");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

export async function createXenditPayrollPayout(
  row: XenditPayrollPayee,
  input: { organizationId: number; payrollRunId: number; businessId: string },
  fetchImpl: typeof fetch = fetch,
  env: XenditConfig = process.env,
): Promise<XenditPayoutResponse> {
  const body = buildXenditPayrollPayout(row, env);
  const response = await fetchImpl(XENDIT_PAYOUT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: xenditAuth(env),
      "Content-Type": "application/json",
      "api-version": XENDIT_PAYROLL_API_VERSION,
      "idempotency-key": xenditPayrollPayoutIdempotencyKey(input.organizationId, input.payrollRunId, row.employeeNo),
    },
    body: JSON.stringify(body),
    // Never forward a MONEY-OUT Basic credential to redirected hosts.
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Xendit payout HTTP ${response.status}; do not automatically retry until authoritative reconciliation.`);
  }
  const payload = await response.json().catch(() => null);
  return normalizeXenditPayout(payload, {
    referenceNumber: row.referenceNumber,
    amountCents: row.amountCents,
    businessId: input.businessId,
  });
}

export async function getXenditPayrollPayout(
  payoutId: string,
  expected: { referenceNumber: string; amountCents: number; businessId: string },
  fetchImpl: typeof fetch = fetch,
  env: XenditConfig = process.env,
): Promise<XenditPayoutResponse> {
  if (!PAYOUT_ID.test(payoutId)) throw new Error("Invalid Xendit payout ID.");
  const response = await fetchImpl(`${XENDIT_PAYOUT_ENDPOINT}/${encodeURIComponent(payoutId)}`, {
    headers: { Authorization: xenditAuth(env), "api-version": XENDIT_PAYROLL_API_VERSION },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Xendit payout reconciliation returned HTTP ${response.status}.`);
  const payout = normalizeXenditPayout(await response.json().catch(() => null), expected);
  if (criticalReleaseFlagEnabled("xenditReconciliationIdentity", env) && payout.payoutId !== payoutId) {
    throw new Error("XENDIT_RECONCILIATION_PAYOUT_ID_MISMATCH: Provider lookup returned a different payout; investigate before linking or settling.");
  }
  return payout;
}
