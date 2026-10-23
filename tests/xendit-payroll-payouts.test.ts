import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PAYROLL_PAYOUT_PROVIDER,
  configuredPayrollPayoutProvider,
  xenditPayrollLiveReadiness,
  payrollPayoutProviderForReleaseReceipt,
} from "../src/lib/payroll-payout-provider";
import {
  buildXenditPayrollPayout,
  createXenditPayrollPayout,
  getXenditPayrollPayout,
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

test("Xendit is preferred only after the exact gate, preserving legacy PayMongo when disabled", () => {
  assert.equal(DEFAULT_PAYROLL_PAYOUT_PROVIDER, "xendit");
  assert.equal(configuredPayrollPayoutProvider({}), "paymongo");
  assert.equal(configuredPayrollPayoutProvider({ XENDIT_PAYOUTS_ENABLED: "TRUE" }), "paymongo");
  assert.equal(configuredPayrollPayoutProvider({ XENDIT_PAYOUTS_ENABLED: "true" }), "xendit");
  assert.equal(configuredPayrollPayoutProvider({ PAYROLL_PAYOUT_PROVIDER: "paymongo" }), "paymongo");
  assert.throws(() => configuredPayrollPayoutProvider({ PAYROLL_PAYOUT_PROVIDER: "xendit" }), /XENDIT_PAYOUTS_ENABLED/);
  assert.equal(configuredPayrollPayoutProvider({ ...env, PAYROLL_PAYOUT_PROVIDER: "paymongo" }), "paymongo");
  assert.throws(() => configuredPayrollPayoutProvider({ PAYROLL_PAYOUT_PROVIDER: "wire" }), /must be/);
  assert.equal(payrollPayoutProviderForReleaseReceipt({}), "paymongo");
  assert.equal(payrollPayoutProviderForReleaseReceipt({ PAYROLL_PAYOUT_PROVIDER: "xendit" }), null);
  assert.equal(payrollPayoutProviderForReleaseReceipt({ XENDIT_PAYOUTS_ENABLED: "true" }), "xendit");
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
  assert.equal(request?.redirect, "error", "Payroll MONEY-OUT credentials must never follow a redirect");
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

test("Xendit read-only reconciliation never follows credential-bearing redirects", async () => {
  const payoutId = "po-b2c3d4e5-f6a7-8901-bcde-f23456789012";
  let observed: Request | undefined;
  const mockFetch: typeof fetch = async (url, options) => {
    observed = new Request(String(url), options);
    return Response.json({
      payout_id: payoutId, reference_id: "PAY-25-E001", status: "ACCEPTED",
      source_currency: "PHP", source_amount: 1550123,
      destination_currency: "PHP", business_id: "biz-sample",
    });
  };
  const payout = await getXenditPayrollPayout(payoutId,
    { referenceNumber: "PAY-25-E001", amountCents: 1550123, businessId: "biz-sample" },
    mockFetch, env);
  assert.equal(payout.status, "ACCEPTED");
  assert.equal(observed?.redirect, "error");
  assert.equal(observed?.method, "GET");
  assert.equal(observed?.url, "https://api.xendit.co/v3/payouts/" + payoutId);
});

test("read-only lookup binds the response payout ID to the requested ID only when explicitly enabled", async () => {
  const requested = "po-requested-0001";
  const other = "po-different-0002";
  const expected = { referenceNumber: "PAY-25-E001", amountCents: 1550123, businessId: "biz-sample" };
  let calls = 0;
  const mock: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), "https://api.xendit.co/v3/payouts/" + requested);
    assert.equal(new Request(String(url), options).method, "GET");
    return Response.json({ payout_id: other, reference_id: expected.referenceNumber,
      status: "SUCCEEDED", source_currency: "PHP", destination_currency: "PHP",
      source_amount: expected.amountCents, business_id: expected.businessId });
  };
  assert.equal((await getXenditPayrollPayout(requested, expected, mock, env)).payoutId, other,
    "Default-off retains the previous response behavior");
  await assert.rejects(getXenditPayrollPayout(requested, expected, mock, {
    ...env, XENDIT_RECONCILIATION_IDENTITY_ENABLED: "true",
  }), /XENDIT_RECONCILIATION_PAYOUT_ID_MISMATCH/);
  assert.equal(calls, 2, "Each invocation performs one read and never retries or submits");
});

test("enabled read-only identity guard accepts an exact payout and retains amount/business validation", async () => {
  const payoutId = "po-exact-identity-0001";
  const expected = { referenceNumber: "PAY-25-E001", amountCents: 1550123, businessId: "biz-sample" };
  const enabled = { ...env, XENDIT_RECONCILIATION_IDENTITY_ENABLED: "true" };
  const payload = { payout_id: payoutId, reference_id: expected.referenceNumber,
    status: "SUCCEEDED", source_currency: "PHP", destination_currency: "PHP",
    source_amount: expected.amountCents, business_id: expected.businessId };
  assert.equal((await getXenditPayrollPayout(payoutId, expected,
    async () => Response.json(payload), enabled)).payoutId, payoutId);
  for (const changed of [{ source_amount: 1 }, { business_id: "foreign-business" },
    { reference_id: "PAY-99-E999" }, { payout_id: "malformed" }]) {
    await assert.rejects(getXenditPayrollPayout(payoutId, expected,
      async () => Response.json({ ...payload, ...changed }), enabled), /Reconciliation required/);
  }
});
