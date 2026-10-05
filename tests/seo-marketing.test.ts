import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("public SEO infrastructure exists", () => {
  assert.ok(existsSync("src/app/sitemap.ts"), "public sitemap route must exist");
  assert.ok(existsSync("src/app/robots.ts"), "robots route must exist");

  const sitemap = read("src/app/sitemap.ts");
  const robots = read("src/app/robots.ts");
  for (const route of ["/hris", "/time-and-attendance", "/employee-self-service", "/compliance", "/implementation", "/security", "/trust", "/integrations", "/developers", "/resources", "/calculators", "/payroll-health-check", "/industries/bpo"]) {
    assert.ok(sitemap.includes(`path: "${route}"`), `sitemap must include ${route}`);
  }
  assert.ok(sitemap.includes("compliancePages.map"), "compliance child pages must be generated into the sitemap");
  assert.ok(sitemap.includes("resourcePages.map"), "resource child pages must be generated into the sitemap");
  assert.ok(sitemap.includes("Object.keys(CALCULATORS)"), "calculator pages must be generated into the sitemap");
  assert.ok(robots.includes('"/api/"'), "robots must keep API routes out of crawl discovery");
  assert.ok(robots.includes('"/app/"'), "robots must keep the authenticated app out of crawl discovery");
});

test("money and authority pages have dedicated indexable routes", () => {
  const pages = [
    ["src/app/hris/page.tsx", "HRIS Philippines"],
    ["src/app/time-and-attendance/page.tsx", "Timekeeping System Philippines"],
    ["src/app/employee-self-service/page.tsx", "Employee Self-Service Philippines"],
    ["src/app/compliance/page.tsx", "Payroll Compliance Philippines"],
    ["src/app/implementation/page.tsx", "Payroll System Implementation Philippines"],
    ["src/app/security/page.tsx", "Payroll Software Security Philippines"],
    ["src/app/industries/bpo/page.tsx", "BPO Payroll Software Philippines"],
    ["src/app/pricing/page.tsx", "Payroll Software Pricing Philippines"],
  ] as const;

  for (const [path, keyword] of pages) {
    assert.ok(existsSync(path), `${path} must exist`);
    const source = read(path);
    assert.ok(source.includes(keyword), `${path} metadata must target ${keyword}`);
    assert.ok(source.includes("alternates: { canonical:"), `${path} must declare a canonical`);
  }
});

test("config-driven compliance, resource and industry clusters exist", () => {
  const content = read("src/lib/seo-content.ts");
  for (const slug of ["bir", "sss", "philhealth", "pag-ibig", "dole"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `compliance cluster must include ${slug}`);
  }
  for (const slug of ["best-payroll-software-philippines", "payroll-software-vs-outsourcing", "payroll-migration-checklist", "payroll-security-checklist", "payroll-software-vs-excel"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `resource cluster must include ${slug}`);
  }
  for (const slug of ["accounting-firms", "manpower", "manufacturing"]) {
    assert.ok(content.includes(`slug: "${slug}"`), `industry cluster must include ${slug}`);
  }
});

test("calculator pages reuse payroll rule functions", () => {
  const calculator = read("src/components/marketing/payroll-calculator.tsx");
  for (const helper of ["computeSss", "computePhilHealth", "computePagIbig", "computeMonthlyWithholdingTax", "holidayMultiplier", "computeThirteenthMonthPay"]) {
    assert.ok(calculator.includes(helper), `calculator must reuse ${helper}`);
  }
  assert.ok(calculator.includes("Educational estimate only"), "calculator must carry an explicit estimate disclaimer");
});

test("payroll health check does not collect employee PII or claim certification", () => {
  const health = read("src/components/marketing/payroll-health-check.tsx");
  assert.ok(health.includes("process-maturity screen"), "health check must describe itself as process maturity");
  assert.ok(health.includes("not a legal compliance certification"), "health check must not imply compliance certification");
  for (const pii of ["government ID", "bank account", "employee name"]) {
    assert.ok(!health.toLowerCase().includes(pii), `health-check questions must not collect ${pii}`);
  }
});

test("compliance copy does not overstate government filing readiness", () => {
  const page = read("src/app/compliance/page.tsx");
  const childContent = read("src/lib/seo-content.ts");
  assert.ok(page.includes("DRAFT until validated"), "compliance page must preserve government-output validation language");
  assert.ok(page.includes("calculation equals filing"), "compliance page must distinguish computation from filing readiness");
  assert.ok(childContent.includes("filing readiness separate"), "child guides must retain filing-validation separation");
  assert.ok(!childContent.includes("guaranteed compliance"), "compliance guides must not promise guaranteed compliance");
  assert.ok(!childContent.includes("100% compliant"), "compliance guides must not claim 100% compliance");
});

test("security and trust pages only claim repository-evidenced controls", () => {
  const security = read("src/app/security/page.tsx");
  const trust = read("src/app/trust/page.tsx");
  assert.ok(security.includes("TOTP multi-factor authentication"), "security page should expose implemented MFA");
  assert.ok(security.includes("Tenant isolation"), "security page should expose tenant-isolation controls");
  assert.ok(security.includes("does not claim ISO, SOC 2"), "security page must explicitly avoid unsupported certification claims");
  assert.ok(trust.includes("verified, partial or absent"), "trust center must preserve evidence-status language");
});

test("developer center matches implemented API security model", () => {
  const page = read("src/app/developers/page.tsx");
  const route = read("src/app/api/developer/route.ts");
  assert.ok(page.includes("SHA-256 hashed API keys"));
  assert.ok(page.includes("HMAC-SHA256 webhook signatures"));
  assert.ok(route.includes("ALLOWED_API_SCOPES"), "developer route must define explicit scopes");
  assert.ok(route.includes("requireSensitiveActionMfa"), "developer credential mutations must retain MFA-sensitive control");
});

test("public navigation exposes the SEO program without hiding the live demo", () => {
  const navigation = read("src/components/marketing/public-navigation.ts");
  for (const route of ["/demo", "/resources", "/compliance", "/trust", "/integrations", "/developers", "/calculators", "/payroll-health-check", "/industries"]) {
    assert.ok(navigation.includes(`href: "${route}"`), `public navigation must expose ${route}`);
  }
});
