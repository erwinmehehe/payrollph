import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legacySignupTableFallback } from "../src/lib/saas-workspace-access";

test("unmigrated private-pilot tenants may continue only when self-serve is disabled", () => {
  assert.equal(legacySignupTableFallback(false), false);
  assert.throws(
    () => legacySignupTableFallback(true),
    /billing migration is required/,
  );
});

test("the legacy schema fallback is a read-only existence probe, not an automatic production migration", () => {
  const source = readFileSync("src/lib/saas-workspace-access.ts", "utf8");
  assert.ok(source.includes("to_regclass('public.saas_signup_verifications')"));
  assert.ok(source.includes("publicSelfServeReady()"));
  assert.ok(source.includes("legacySignupTableFallback(publicSelfServeReady())"));
  assert.ok(source.includes("from(saasSignupVerifications)"));
  assert.ok(!source.includes("CREATE TABLE"));
  assert.ok(!source.includes("DROP TABLE"));
});

test("app server uses the shared gate, preserving billing redirects for subscribed self-serve employers", () => {
  const page = readFileSync("src/app/app/page.tsx", "utf8");
  assert.ok(page.includes("await isSelfServeOrganization(companyOrganizationId)"));
  assert.ok(page.includes('billing.status === "pending_payment"'));
  assert.ok(page.includes('redirect("/billing/setup")'));
  assert.ok(page.includes("isSelfServeCustomer={isSelfServe}"));
  assert.ok(!page.includes("db.select({ organizationId: saasSignupVerifications.organizationId })"));
});

test("authoritative paid-write service remains gated for real self-serve employers", () => {
  const source = readFileSync("src/lib/saas-workspace-access.ts", "utf8");
  assert.ok(source.includes("if (!(await isSelfServeOrganization(organizationId))) return null;"));
  assert.ok(source.includes("if (entitlements.active) return null;"));
  assert.ok(source.includes("SUBSCRIPTION_REQUIRED"));
  assert.ok(source.includes("status: 402"));
});
