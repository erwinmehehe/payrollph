import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PAYROLL_PAYOUT_PROVIDER,
  configuredPayrollPayoutProvider,
  xenditPayrollLiveReadiness,
} from "../src/lib/payroll-payout-provider";
import {
  buildXenditPayrollPayout,
  createXenditPayrollPayout,
  normalizeXenditPayout,
  normalizeXenditPayoutWebhook,
  verifyXenditPayoutWebhookToken,
  xenditPayrollPayoutIdempotencyKey,
  xenditPayoutState,
} from "../src/lib/xendit-payroll-payouts";

const payee = {
  employeeNo: "E001",
  employeeName: "Maria Santos",
  firstName: "Maria",
  lastName: "Santos",
  accountNumber: "1234567890",
  bankName: "BDO",
  amountCents: 1550123,
  referenceNumber: "PAY-25-E001",
};
const env = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://payrollsoftware.ph",
  XENDIT_PAYOUT_SECRET_KEY: "payroll-specific-key",
  XENDIT_PAYOUT_CALLBACK_TOKEN: "very-long-confirmed-callback-token",
  XENDIT_PAYOUT_BUSINESS_ID: "biz-sample",
  XENDIT_PAYOUT_ALLOWED_ORGANIZATION_ID: "12",
  XENDIT_PAYOUT_ALLOWED_LEGAL_ENTITY_ID: "21",
  XENDIT_PAYOUTS_ENABLED: "true",
  XENDIT_PAYOUTS_LIVE_APPROVED: "true",
};

test("Xendit is the default selection, but not a live permission", () => {
  assert.equal(DEFAULT_PAYROLL_PAYOUT_PROVIDER, "xendit");
  assert.equal(configuredPayrollPayoutProvider({}), "xendit");
  assert.equal(configuredPayrollPayoutProvider({ PAYROLL_PAYOUT_PROVIDER: "paymongo" }), "paymongo");
  assert.throws(() => configuredPayrollPayoutProvider({ PAYROLL_PAYOUT_PROVIDER: "wire" }), /must be/);
  assert.equal(xenditPayrollLiveReadiness({ organizationId: 12, legalEntityId: 21 }, {}).ready, false);
  assert.equal(xenditPayrollLiveReadiness({ organizationId: 12, legalEntityId: 21 }, env).ready, true);
  assert.equal(xenditPayrollLiveReadiness({ organizationId: 13, legalEntityId: 21 }, env).ready, false);
  assert.equal(xenditPayrollLiveReadiness({ organizationId: 12, legalEntityId: 22 }, env).ready, false);
});

test("Xendit V3 request sends PHP minor units and verified bank routing", () => {
  const body = buildXenditPayrollPayout(payee, env);
  assert.equal(body.payout_details.source_amount, 1550123);
  assert.equal(body.payout_details.source_currency, "PHP");
  assert.equal(body.purpose_code, "SALARY");
  assert.equal(body.recipient.account_details.routing_value_1, "BNORPHMM");
  assert.equal(body.recipient.account_details.account_number, "1234567890");
  assert.equal(xenditPayrollPayoutIdempotencyKey(12, 25, "E001"), "linaw-ph-12-25-E001");
});

test("Xendit bank and account identity cannot be silently guessed", () => {
  assert.throws(() => buildXenditPayrollPayout({ ...payee, bankName: "Unknown" }, env), /Unverified/);
  assert.throws(() => buildXenditPayrollPayout({ ...payee, employeeName: "Other Person" }, env), /differs/);
  assert.throws(() => buildXenditPayrollPayout({ ...payee, accountNumber: "abc" }, env), /invalid/);
});

test("Xendit response fails closed when reference, business or amount differs", () => {
  const payload = {
    payout_id: "po-b2c3d4e5-f6a7-8901-bcde-f23456789012",
    reference_id: "PAY-25-E001", status: "ACCEPTED",
    source_currency: "PHP", source_amount: 1550123,
    destination_currency: "PHP", business_id: "biz-sample",
  };
  const expected = { referenceNumber: "PAY-25-E001", amountCents: 1550123, businessId: "biz-sample" };
  assert.equal(normalizeXenditPayout(payload, expected).status, "ACCEPTED");
  assert.throws(() => normalizeXenditPayout({ ...payload, source_amount: 1 }, expected), /Reconciliation required/);
  assert.throws(() => normalizeXenditPayout({ ...payload, business_id: "other" }, expected), /Reconciliation required/);
});

test("Xendit V3 payout HTTP uses separate money-out key and deterministic idempotency", async () => {
  let request: Request | undefined;
  const mockFetch: typeof fetch = async (url, init) => {
    request = new Request(String(url), init);
    return Response.json({
      payout_id: "po-b2c3d4e5-f6a7-8901-bcde-f23456789012",
      reference_id: "PAY-25-E001", status: "ACCEPTED",
      source_currency: "PHP", source_amount: 1550123,
      destination_currency: "PHP", business_id: "biz-sample",
    });
  };
  await createXenditPayrollPayout(payee, { organizationId: 12, payrollRunId: 25, businessId: "biz-sample" }, mockFetch, env);
  assert.equal(request?.url, "https://api.xendit.co/v3/payouts");
  assert.equal(request?.headers.get("api-version"), "2025-09-01");
  assert.equal(request?.headers.get("idempotency-key"), "linaw-ph-12-25-E001");
  assert.equal(request?.headers.get("authorization"), "Basic " + Buffer.from("payroll-specific-key:").toString("base64"));
});

test("Xendit webhook rejects mismatched callback token and rejects unsupported statuses", () => {
  assert.equal(verifyXenditPayoutWebhookToken("different", env.XENDIT_PAYOUT_CALLBACK_TOKEN), false);
  assert.equal(verifyXenditPayoutWebhookToken(env.XENDIT_PAYOUT_CALLBACK_TOKEN, env.XENDIT_PAYOUT_CALLBACK_TOKEN), true);
  assert.equal(xenditPayoutState("REVERSED"), "reversed");
  assert.equal(xenditPayoutState("UNKNOWN"), "unknown");
  assert.equal(normalizeXenditPayoutWebhook({}, "biz-sample"), null);
});
