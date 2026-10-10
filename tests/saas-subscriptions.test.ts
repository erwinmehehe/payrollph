import assert from "node:assert/strict";
import { test } from "node:test";
import {
  firstRecurringAnchor, isSellablePlan, nextBillingMonth,
  paidAccessAllowed, safeSeats, subscriptionQuote,
} from "../src/lib/saas-pricing";
import { checkoutHostnameAllowed } from "../src/lib/saas-launch-config";
import { buildXenditSubscriptionSession } from "../src/lib/xendit-subscriptions";

test("only active employer plans can start paid subscriptions", () => {
  assert.equal(isSellablePlan("Core"), true);
  assert.equal(isSellablePlan("Scale"), true);
  assert.equal(isSellablePlan("Enterprise"), true);
  assert.equal(isSellablePlan("Solo"), false);
  assert.equal(isSellablePlan("__proto__"), false);
});

test("subscription prices include the base and every selected employee seat", () => {
  const q = subscriptionQuote({ name: "Core", monthlyBase: "1500", perEmployee: "50", active: true }, 10);
  assert.deepEqual(q, {
    plan: "Core", seats: 10, billingCycle: "monthly", currency: "PHP",
    baseCents: 150_000, seatCents: 5_000,
    amountCents: 200_000, amountPhp: 2000,
  });
  assert.equal(subscriptionQuote({ name: "Scale", monthlyBase: "4499", perEmployee: "79", active: true }, 25).amountCents, 647_400);
  assert.throws(() => subscriptionQuote({ name: "Core", monthlyBase: "100", perEmployee: "2", active: false }, 1));
  assert.throws(() => subscriptionQuote({ name: "Core", monthlyBase: "-1", perEmployee: "50", active: true }, 1));
});

test("seat counts reject fractions, negative values, overflow, and invalid strings", () => {
  assert.equal(safeSeats("25"), 25);
  for (const invalid of ["", "0", "-1", "1.5", "2500", "nan", "1e99", undefined]) {
    assert.equal(safeSeats(invalid), null);
  }
});

test("paid subscription access expires at paid-through even after cancellation", () => {
  const until = new Date("2026-12-01T00:00:00Z");
  const now = new Date("2026-11-10T00:00:00Z");
  assert.equal(paidAccessAllowed({ status: "active", paidThrough: until, now }), true);
  assert.equal(paidAccessAllowed({ status: "past_due", paidThrough: until, now }), true);
  assert.equal(paidAccessAllowed({ status: "cancel_at_period_end", paidThrough: until, now }), true);
  assert.equal(paidAccessAllowed({ status: "cancelled", paidThrough: until, now }), true);
  assert.equal(paidAccessAllowed({ status: "pending_payment", paidThrough: until, now }), false);
  assert.equal(paidAccessAllowed({ status: "active", paidThrough: until, now: until }), false);
});

test("month arithmetic clips shorter months without parsing a locale string", () => {
  assert.equal(nextBillingMonth(new Date("2026-01-31T09:00:00Z")).toISOString(), "2026-02-28T09:00:00.000Z");
  assert.equal(nextBillingMonth(new Date("2026-04-30T09:00:00Z")).toISOString(), "2026-05-30T09:00:00.000Z");
  assert.equal(firstRecurringAnchor(new Date("2026-01-31T22:00:00Z")), "2026-02-28T09:00:00.000Z");
});

test("provider checkout URLs must be genuine HTTPS Xendit hosts", () => {
  assert.equal(checkoutHostnameAllowed("https://checkout.xendit.co/test"), true);
  assert.equal(checkoutHostnameAllowed("https://xen.to/abcd"), true);
  assert.equal(checkoutHostnameAllowed("https://xendit.co.evil.com/pay"), false);
  assert.equal(checkoutHostnameAllowed("http://checkout.xendit.co/pay"), false);
  assert.equal(checkoutHostnameAllowed("javascript:alert(1)"), false);
});

test("hosted session is PHP monthly subscription with explicit recurring schedule", () => {
  const payload = buildXenditSubscriptionSession({
    referenceId: "linaw_sub_18_abcdef", organizationId: 18, userId: 45,
    name: "Maria Dela Cruz", email: "maria@example.com", plan: "Core",
    seats: 10, amountCents: 200_000,
    successUrl: "https://linaw.ph/billing/setup?return=success",
    cancelUrl: "https://linaw.ph/billing/setup?return=cancel",
  }, new Date("2026-10-09T10:00:00Z"));
  assert.equal(payload.session_type, "SUBSCRIPTION");
  assert.equal(payload.mode, "PAYMENT_LINK");
  assert.equal(payload.amount, 2000);
  assert.equal(payload.subscription.immediate_payment, true);
  assert.equal(payload.subscription.schedule.interval, "MONTH");
  assert.equal(payload.subscription.schedule.total_retry, 3);
  assert.equal(payload.customer.email, "maria@example.com");
  assert.ok(!JSON.stringify(payload).includes("bankAccount"));
});
