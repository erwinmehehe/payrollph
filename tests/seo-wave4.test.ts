import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Wave 4 developer docs match implemented API contracts", () => {
  const docs = read("src/lib/developer-docs.ts");
  const developerRoute = read("src/app/api/developer/route.ts");
  const employeesRoute = read("src/app/api/v1/employees/route.ts");
  const payrollRoute = read("src/app/api/v1/payroll-runs/route.ts");
  const webhookSigning = read("src/lib/webhook-signing.ts");

  for (const scope of ["employees:read", "employees:write", "payroll:read"]) {
    assert.ok(docs.includes(scope), `developer docs must include scope ${scope}`);
    assert.ok(developerRoute.includes(scope), `developer route must implement scope ${scope}`);
  }

  assert.ok(docs.includes("Idempotency-Key"));
  assert.ok(employeesRoute.includes("idempotency-key"));
  assert.ok(docs.includes("GET /api/v1/payroll-runs"));
  assert.ok(payrollRoute.includes('requireScope(auth.scopes, "payroll:read")'));

  for (const event of ["payroll.released", "payroll.processed", "employee.onboarded", "employee.offboarded", "leave.approved", "approval.decided"]) {
    assert.ok(docs.includes(event), `docs must include webhook event ${event}`);
    assert.ok(webhookSigning.includes(event), `implementation must include webhook event ${event}`);
  }
});

test("developer docs do not claim a public webhook REST endpoint that does not exist", () => {
  const docs = read("src/lib/developer-docs.ts");
  assert.ok(!docs.includes("POST /api/v1/webhooks"));
  assert.ok(!docs.includes("GET /api/v1/webhooks"));
});

test("procurement checklists are local-only and printable", () => {
  const component = read("src/components/marketing/procurement-checklist.tsx");
  assert.ok(component.includes("window.print()"));
  assert.ok(component.includes("Nothing in this checklist is submitted to Linaw."));
  assert.ok(!component.includes("fetch("));
});

test("Wave 4 adds RFP and security procurement templates", () => {
  for (const path of [
    "src/app/templates/payroll-rfp-checklist/page.tsx",
    "src/app/templates/payroll-security-checklist/page.tsx",
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
  }
  const rfp = read("src/app/templates/payroll-rfp-checklist/page.tsx");
  const security = read("src/app/templates/payroll-security-checklist/page.tsx");
  assert.ok(rfp.includes("Payroll Software RFP Checklist"));
  assert.ok(rfp.includes("Vendor distinguishes live capabilities, partial capabilities and roadmap items."));
  assert.ok(security.includes("Payroll Software Security Checklist"));
  assert.ok(security.includes("Certifications are distinguished from internal controls."));
});

test("comparison hub keeps neutral guides and requires evidence for named competitors", () => {
  const compare = read("src/app/compare/page.tsx");
  for (const route of [
    "/resources/payroll-software-vs-outsourcing",
    "/resources/payroll-software-vs-excel",
    "/resources/cloud-vs-on-premise-payroll",
    "/resources/build-vs-buy-payroll-software",
  ]) {
    assert.ok(compare.includes(route), `comparison hub must include ${route}`);
  }

  if (compare.includes("Sprout")) {
    assert.ok(existsSync("src/lib/seo-content-wave17.ts"), "Sprout comparison must have a source-backed content registry");
    const sprout = read("src/lib/seo-content-wave17.ts");
    assert.ok(sprout.includes("https://sprout.ph/product/payroll-management/"));
    assert.ok(sprout.includes("not a universal ranking"));
    assert.ok(!sprout.toLowerCase().includes("sprout is insecure"));
    assert.ok(!sprout.toLowerCase().includes("sprout is non-compliant"));
  }

  if (compare.includes("Salarium")) {
    assert.ok(existsSync("src/lib/seo-content-wave18.ts"), "Salarium comparison must have a source-backed content registry");
    const salarium = read("src/lib/seo-content-wave18.ts");
    assert.ok(salarium.includes("https://support.salarium.com/"));
    assert.ok(salarium.includes("not claiming to be better"));
    assert.ok(!salarium.toLowerCase().includes("salarium is insecure"));
    assert.ok(!salarium.toLowerCase().includes("salarium is non-compliant"));
  }

  assert.ok(!compare.includes("GreatDay"), "GreatDay must not be named until a source-backed comparison page exists");
});

test("customer story infrastructure cannot fabricate social proof", () => {
  const stories = read("src/lib/customer-stories.ts");
  assert.ok(stories.includes("approved: boolean"));
  assert.ok(stories.includes("evidenceNote"));
  assert.ok(stories.includes("CUSTOMER_STORIES: CustomerStory[] = []"));
  assert.ok(stories.includes("Keep this empty rather than manufacturing social proof."));
});

test("Wave 4 routes are discoverable without crowding primary navigation", () => {
  const sitemap = read("src/lib/sitemap-data.ts");
  const nav = read("src/components/marketing/public-navigation.ts");
  for (const route of [
    "/compare",
    "/templates/payroll-rfp-checklist",
    "/templates/payroll-security-checklist",
  ]) {
    assert.ok(sitemap.includes(route), `sitemap must include ${route}`);
    assert.ok(nav.includes(route), `resource navigation must include ${route}`);
  }
  assert.ok(sitemap.includes('["authentication", "employees", "payroll-runs", "webhooks"]'));
  assert.ok(sitemap.includes('path: `/developers/${slug}`'), "sitemap must generate developer documentation routes");
});
