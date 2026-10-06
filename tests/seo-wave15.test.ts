import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { SEO_INTENT_OWNERS } from "../src/lib/seo-intent-ownership";
import { productSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("workforce analytics landing page exists with focused metadata and canonical", () => {
  assert.ok(existsSync("src/app/workforce-analytics/page.tsx"));
  const page = read("src/app/workforce-analytics/page.tsx");
  assert.ok(page.includes("Workforce Analytics Philippines | Payroll Reports | Linaw"));
  assert.ok(page.includes('alternates: { canonical: "/workforce-analytics" }'));
  assert.ok(page.includes('path: "/workforce-analytics"'));
  assert.ok(page.includes("Workforce Analytics and Payroll Reporting"));
});

test("workforce analytics copy matches implemented report keys", () => {
  const page = read("src/app/workforce-analytics/page.tsx");
  const reportsRoute = read("src/app/api/reports/route.ts");
  const analytics = read("src/components/workspace/analytics.tsx");

  for (const key of ["headcount", "cost", "turnover", "compliance"]) {
    assert.ok(reportsRoute.includes(`"${key}"`), `report API must implement ${key}`);
  }

  assert.ok(analytics.includes("Headcount movement"));
  assert.ok(analytics.includes("Payroll cost"));
  assert.ok(analytics.includes("Turnover risk"));
  assert.ok(analytics.includes("Compliance exceptions"));

  assert.ok(page.includes("Headcount movement report"));
  assert.ok(page.includes("Payroll cost history"));
  assert.ok(page.includes("Compliance exception report"));
});

test("CSV report export claim is backed by the report API and audit event", () => {
  const page = read("src/app/workforce-analytics/page.tsx");
  const route = read("src/app/api/reports/route.ts");

  assert.ok(route.includes('format === "csv"'));
  assert.ok(route.includes('"Content-Type": "text/csv"'));
  assert.ok(route.includes('action: "Report exported"'));
  assert.ok(page.includes("exported as CSV"));
  assert.ok(page.includes("records an audit event"));
});

test("company-wide analytics claim matches server authorization", () => {
  const page = read("src/app/workforce-analytics/page.tsx");
  const route = read("src/app/api/reports/route.ts");
  const dashboard = read("src/app/api/dashboard/route.ts");

  assert.ok(route.includes("PEOPLE_PAYROLL_ROLES"));
  assert.ok(route.includes("if (!access?.companyWide)"));
  assert.ok(route.includes("Company-wide analytics are not available to unit-scoped roles."));
  assert.ok(dashboard.includes('access.role === "employee"'));

  assert.ok(page.includes("Unit-scoped roles cannot use the company-wide reporting endpoint"));
  assert.ok(page.includes("employee self-service accounts cannot access the company dashboard"));
});

test("payroll variance claims map to implemented variance categories", () => {
  const page = read("src/app/workforce-analytics/page.tsx");
  const variance = read("src/lib/payroll-variance.ts");

  for (const category of [
    "salary_change",
    "overtime_spike",
    "retro",
    "new_hire",
    "separation",
    "bank_details",
    "statutory",
    "net_variance",
  ]) {
    assert.ok(variance.includes(`"${category}"`), `variance classifier must include ${category}`);
  }

  assert.ok(page.includes("salary changes"));
  assert.ok(page.includes("overtime spikes"));
  assert.ok(page.includes("retro pay"));
  assert.ok(page.includes("bank-detail changes"));
  assert.ok(page.includes("statutory changes"));
});

test("turnover analytics stays framed as an operational indicator, not predictive AI", () => {
  const page = read("src/app/workforce-analytics/page.tsx");
  const reports = read("src/lib/reports.ts");

  assert.ok(page.includes("not a predictive attrition model"));
  assert.ok(page.includes("No predictive attrition model is claimed."));
  assert.ok(reports.includes("separating"));
  assert.ok(reports.includes("disciplinary"));

  for (const unsupported of [
    "AI predicts employee turnover",
    "predictive attrition score",
    "machine learning forecast",
    "guaranteed retention",
  ]) {
    assert.ok(!page.includes(unsupported));
  }
});

test("workforce analytics owns its intent and is discoverable", () => {
  const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/workforce-analytics");
  assert.equal(owner?.primaryIntent, "workforce analytics philippines");
  assert.equal(owner?.intentClass, "commercial");

  assert.ok(productSitemapEntries.some((entry) => entry.path === "/workforce-analytics"));

  const nav = read("src/components/marketing/public-navigation.ts");
  const llms = read("src/app/llms.txt/route.ts");
  assert.ok(nav.includes('{ label: "Workforce analytics", href: "/workforce-analytics" }'));
  assert.ok(llms.includes('absolutePublicUrl("/workforce-analytics")'));
});
