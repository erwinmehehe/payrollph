import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPlatformOperator, platformOperatorConfigured } from "../src/lib/platform-operator";

const read = (path: string) => readFileSync(path, "utf8");

test("platform operator access is explicit and normalized", () => {
  const env = { PLATFORM_OPERATOR_EMAILS: " Ops@Example.com,second@example.com " } as NodeJS.ProcessEnv;
  assert.equal(platformOperatorConfigured(env), true);
  assert.equal(isPlatformOperator("ops@example.com", env), true);
  assert.equal(isPlatformOperator("SECOND@example.com", env), true);
  assert.equal(isPlatformOperator("tenant@example.com", env), false);
  assert.equal(platformOperatorConfigured({} as NodeJS.ProcessEnv), false);
});

test("public lead queue is platform-only and never tenant-role gated", () => {
  const page = read("src/app/operator/leads/page.tsx");
  assert.ok(page.includes("getSessionUser"), "lead queue must require an authenticated session");
  assert.ok(page.includes("platformOperatorConfigured"), "lead queue must fail closed when no operator allowlist exists");
  assert.ok(page.includes("isPlatformOperator"), "lead queue must check the signed-in email against the platform allowlist");
  assert.ok(page.includes("notFound()"), "unauthorized users must not receive the global lead surface");
  assert.ok(!page.includes("ORG_ADMIN_ROLES"), "tenant admin roles must never grant access to global leads");
  assert.ok(page.includes('robots: { index: false, follow: false }'), "operator queue must never be indexable");
});

test("public forms persist structured lead metadata and distinct lead types", () => {
  const demoRoute = read("src/app/api/demo-requests/route.ts");
  const quoteRoute = read("src/app/api/payroll-outsourcing/quote/route.ts");
  const accessForm = read("src/components/marketing/access-request-form.tsx");
  const demoForm = read("src/components/marketing/book-demo-form.tsx");
  const mailer = read("src/lib/mailer.ts");

  assert.ok(accessForm.includes('requestType: "trial"'), "trial form must identify itself explicitly");
  assert.ok(demoForm.includes('requestType: "demo"'), "demo form must identify itself explicitly");
  assert.ok(demoRoute.includes('"trial-access-request"'), "trial requests must use a distinct outbox purpose");
  assert.ok(demoRoute.includes("metadata:"), "demo/trial requests must persist structured metadata");
  assert.ok(quoteRoute.includes('leadType: "payroll-outsourcing"'), "outsourcing enquiries must persist a typed lead record");
  assert.ok(mailer.includes("recentPublicLeadOutbox"), "mailer must expose only the explicit public lead purposes to the platform queue");
  assert.ok(mailer.includes("isNull(outbox.organizationId)"), "public lead queue must remain separate from tenant outbox rows");
});
