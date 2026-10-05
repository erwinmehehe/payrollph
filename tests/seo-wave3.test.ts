import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Wave 3 adds the Philippine payroll knowledge cluster", () => {
  const content = read("src/lib/seo-content-wave3.ts");
  for (const slug of [
    "13th-month-pay-philippines",
    "overtime-pay-philippines",
    "night-differential-philippines",
    "holiday-pay-philippines",
    "final-pay-philippines",
    "separation-pay-philippines",
    "payroll-process-philippines",
    "payroll-cutoff",
    "common-payroll-errors",
    "payroll-audit-checklist",
    "payslip-guide",
    "payroll-annualization",
  ]) {
    assert.ok(content.includes(`slug: "${slug}"`), `missing payroll knowledge guide: ${slug}`);
  }
});

test("Wave 3 adds deeper compliance pages without universal filing claims", () => {
  const content = read("src/lib/seo-content-wave3.ts");
  for (const slug of [
    "bir-2316",
    "1601-c",
    "alphalist",
    "withholding-tax",
    "calendar",
    "regulatory-updates",
    "payroll-audit",
  ]) {
    assert.ok(content.includes(`slug: "${slug}"`), `missing compliance guide: ${slug}`);
  }
  assert.ok(content.includes("Do not hard-code one universal filing date"));
  assert.ok(content.includes("generation separate from filing validation"));
  assert.ok(!content.includes("guaranteed compliance"));
  assert.ok(!content.includes("100% compliant"));
});

test("separation-pay guidance avoids pretending entitlement is a universal formula", () => {
  const content = read("src/lib/seo-content-wave3.ts");
  assert.ok(content.includes("Determine entitlement before calculating"));
  assert.ok(content.includes("should not be treated as an automatic amount for every employee who leaves"));
  assert.ok(content.includes("without presenting a universal separation-pay calculator as legal advice"));
  assert.ok(!read("src/lib/calculators.ts").includes('"separation-pay"'));
});

test("source-backed guides expose official references and review dates", () => {
  const content = read("src/lib/seo-content-wave3.ts");
  const shell = read("src/components/marketing/seo-landing-page.tsx");
  assert.ok(content.includes("Last reviewed") === false, "review labels should be rendered by the page shell, not duplicated in content");
  assert.ok(content.includes("lastReviewed: reviewed"));
  assert.ok(content.includes("dole.gov.ph"));
  assert.ok(content.includes("bir.gov.ph"));
  assert.ok(content.includes("sss.gov.ph"));
  assert.ok(content.includes("philhealth.gov.ph"));
  assert.ok(content.includes("pagibigfund.gov.ph"));
  assert.ok(shell.includes("Official references"));
  assert.ok(shell.includes("Last reviewed:"));
});

test("glossary and regulatory update routes exist", () => {
  for (const path of [
    "src/app/glossary/page.tsx",
    "src/app/glossary/[slug]/page.tsx",
    "src/app/resources/updates/page.tsx",
    "src/app/resources/updates/[slug]/page.tsx",
  ]) {
    assert.ok(existsSync(path), `${path} must exist`);
  }
  const content = read("src/lib/seo-content-wave3.ts");
  assert.ok(content.includes("glossaryEntries"));
  assert.ok(content.includes("regulatoryUpdates"));
  assert.ok(content.includes("dole-final-pay-reminder-2026"));
  assert.ok(content.includes("bir-alphalist-reminder-2026"));
});

test("Wave 3 adds final pay, rate and outsourcing calculators with safe framing", () => {
  const catalog = read("src/lib/calculators.ts");
  const advanced = read("src/components/marketing/advanced-payroll-calculator.tsx");
  for (const slug of ["final-pay", "daily-rate", "hourly-rate", "payroll-outsourcing-roi"]) {
    assert.ok(catalog.includes(`"${slug}"`), `missing calculator: ${slug}`);
  }
  assert.ok(advanced.includes("does not determine legal entitlement"));
  assert.ok(advanced.includes("does not determine legal entitlement, the correct payroll divisor, tax treatment or guaranteed outsourcing savings"));
  assert.ok(advanced.includes("Estimated final-pay subtotal"));
});

test("generated SEO pages emit page-level structured data", () => {
  const resource = read("src/app/resources/[slug]/page.tsx");
  const compliance = read("src/app/compliance/[slug]/page.tsx");
  const calculator = read("src/app/calculators/[slug]/page.tsx");
  const industry = read("src/app/industries/[slug]/page.tsx");
  const structured = read("src/components/marketing/structured-data.tsx");

  assert.ok(resource.includes("article={{"));
  assert.ok(compliance.includes("article={{"));
  assert.ok(calculator.includes("webApplication={{"));
  assert.ok(industry.includes("service={{"));
  assert.ok(structured.includes('"BreadcrumbList"'));
  assert.ok(structured.includes('"WebApplication"'));
  assert.ok(structured.includes('"Service"'));
  assert.ok(!structured.includes("aggregateRating"));
});

test("sitemap includes Wave 3 evergreen, glossary and update families", () => {
  const sitemap = read("src/app/sitemap.ts");
  assert.ok(sitemap.includes("complianceWave3"));
  assert.ok(sitemap.includes("resourceWave3"));
  assert.ok(sitemap.includes("glossaryEntries"));
  assert.ok(sitemap.includes("regulatoryUpdates"));
  assert.ok(sitemap.includes('path: "/glossary"'));
  assert.ok(sitemap.includes('path: "/resources/updates"'));
});

test("resource navigation exposes glossary and regulatory updates without expanding primary nav", () => {
  const navigation = read("src/components/marketing/public-navigation.ts");
  assert.ok(navigation.includes('{ label: "Payroll glossary", href: "/glossary" }'));
  assert.ok(navigation.includes('{ label: "Regulatory updates", href: "/resources/updates" }'));
  const primary = navigation.slice(navigation.indexOf("PUBLIC_PRIMARY_LINKS"), navigation.indexOf("PUBLIC_FOOTER_GROUPS"));
  assert.ok(!primary.includes("/glossary"));
  assert.ok(!primary.includes("/resources/updates"));
});
