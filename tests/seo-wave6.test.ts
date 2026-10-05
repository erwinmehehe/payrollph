import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Wave 6 closes the remaining mapped industry gaps", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  for (const slug of ["construction", "logistics", "security-agencies", "real-estate", "media", "ngo", "shopping-centers"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `missing Wave 6 industry: ${slug}`);
  }
  for (const title of [
    "Construction Payroll Software Philippines | Linaw",
    "Logistics Payroll Software Philippines | Linaw",
    "Security Agency Payroll Software Philippines | Linaw",
    "Real Estate Payroll Software Philippines | Linaw",
    "Media Payroll Software Philippines | Linaw",
    "NGO Payroll Software Philippines | Nonprofit Payroll | Linaw",
    "Shopping Center Payroll Software Philippines | Linaw",
  ]) {
    assert.ok(content.includes(title), `missing Wave 6 industry title: ${title}`);
  }
});

test("construction payroll page stays scoped to implemented payroll capabilities", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  const intents = read("src/lib/seo-intent-ownership.ts");

  const start = content.indexOf('slug: "construction"');
  const end = content.indexOf("\n  },", start);
  assert.ok(start >= 0 && end > start, "construction industry page must exist");
  const page = content.slice(start, end);

  assert.ok(page.includes("Attendance and biometric ingestion workflows"));
  assert.ok(page.includes("Maker-checker payroll release controls"));
  assert.ok(page.includes("does not claim a full construction project-costing module"));
  assert.ok(page.includes("Project costing, equipment, procurement"));
  assert.ok(!page.includes("hazard pay automation"));
  assert.ok(intents.includes('primaryIntent: "construction payroll software philippines"'));
  assert.ok(intents.includes('ownerPath: "/industries/construction"'));
});

test("logistics payroll page stays scoped to implemented payroll capabilities", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  const intents = read("src/lib/seo-intent-ownership.ts");

  const start = content.indexOf('slug: "logistics"');
  const end = content.indexOf("\n  },", start);
  assert.ok(start >= 0 && end > start, "logistics industry page must exist");
  const page = content.slice(start, end);

  assert.ok(page.includes("Shift and attendance workflows"));
  assert.ok(page.includes("Bank and accounting export workflows"));
  assert.ok(page.includes("No such capability is claimed here"));
  assert.ok(page.includes("GPS, route planning, fleet maintenance and fuel management"));
  assert.ok(intents.includes('primaryIntent: "logistics payroll software philippines"'));
  assert.ok(intents.includes('ownerPath: "/industries/logistics"'));
});

test("security agency payroll page stays scoped to implemented payroll capabilities", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  const intents = read("src/lib/seo-intent-ownership.ts");

  const start = content.indexOf('slug: "security-agencies"');
  const end = content.indexOf("\n  },", start);
  assert.ok(start >= 0 && end > start, "security-agency industry page must exist");
  const page = content.slice(start, end);

  assert.ok(page.includes("Guard and office employee payroll"));
  assert.ok(page.includes("Maker-checker payroll release controls"));
  assert.ok(page.includes("does not claim SOSIA reporting"));
  assert.ok(page.includes("firearm tracking, guard-post deployment, licensing or guard-tour management"));
  assert.ok(intents.includes('primaryIntent: "security agency payroll software philippines"'));
  assert.ok(intents.includes('ownerPath: "/industries/security-agencies"'));
});

test("Wave 6 integration pages stay tied to implemented product surfaces", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  const biometric = read("src/app/api/biometrics/sync/route.ts");
  const exportsRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  const exporters = read("src/lib/exporters.ts");

  for (const slug of ["biometrics", "accounting-exports", "bank-payout-exports"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `missing Wave 6 integration: ${slug}`);
  }

  assert.ok(content.includes("ADMS push support"));
  assert.ok(biometric.includes('protocolsSupported: ["ADMS (Push SDK)", "Port Forwarding (TCP/IP)", "REST Webhook (Cloud)"]'));
  assert.ok(biometric.includes("verifyBiometricDeviceCredential"));

  assert.ok(content.includes("Released-payroll gate"));
  assert.ok(exportsRoute.includes('kind === "journal" && run.status !== "Released"'));
  assert.ok(exporters.includes("generateJournalCsv"));

  assert.ok(content.includes("Dry-run file validation"));
  assert.ok(content.includes("does not pretend that one CSV works for every Philippine bank"));
  assert.ok(exporters.includes("will not generate a guessed CSV substitute"));
  assert.ok(exporters.includes("no verified bank-provided file mapping"));
});

test("Wave 6 does not invent Bundy or universal native integrations", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  assert.ok(!content.includes("Bundy"));
  assert.ok(!content.includes("Linaw has a native integration with every"));
  assert.ok(content.includes("does not claim universal plug-and-play compatibility"));
  assert.ok(content.includes("A native integration should only be claimed"));
});

test("Wave 6 dynamic routes include metadata, canonicals and structured data", () => {
  const industries = read("src/app/industries/[slug]/page.tsx");
  const integrations = read("src/app/integrations/[slug]/page.tsx");

  assert.ok(industries.includes("industryWave6"));
  assert.ok(industries.includes("page.metaTitle ??"));
  assert.ok(industries.includes("service={{ name: page.title"));

  assert.ok(existsSync("src/app/integrations/[slug]/page.tsx"));
  assert.ok(integrations.includes("integrationWave6"));
  assert.ok(integrations.includes("page.metaTitle ??"));
  assert.ok(integrations.includes('canonical: `/integrations/${slug}`'));
  assert.ok(integrations.includes("service={{ name: page.title"));
});

test("Wave 6 pages are discoverable from hubs and XML sitemap", () => {
  const industries = read("src/app/industries/page.tsx");
  const integrations = read("src/app/integrations/page.tsx");
  const sitemap = read("src/lib/sitemap-data.ts");

  assert.ok(industries.includes("industryWave6"));
  for (const route of [
    "/integrations/biometrics",
    "/integrations/accounting-exports",
    "/integrations/bank-payout-exports",
  ]) {
    assert.ok(integrations.includes(route), `integration hub must link ${route}`);
  }

  assert.ok(sitemap.includes("industryWave6"));
  assert.ok(sitemap.includes("integrationWave6.map"));
  assert.ok(sitemap.includes('path: `/integrations/${slug}`'));
});

test("Wave 6 high-risk integration copy preserves validation boundaries", () => {
  const content = read("src/lib/seo-content-wave6.ts");
  assert.ok(content.includes("Generating a file does not prove that a bank portal accepted it."));
  assert.ok(content.includes("Portal UAT and template-version evidence remain separate implementation controls."));
  assert.ok(content.includes("An export is a controlled handoff, not a claim of a native connection"));
  assert.ok(content.includes("specific hardware should still be tested before describing it as supported"));
});
