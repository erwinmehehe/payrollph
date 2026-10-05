import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("public SEO infrastructure exists", () => {
  assert.ok(existsSync("src/app/sitemap.ts"), "public sitemap route must exist");
  assert.ok(existsSync("src/app/robots.ts"), "robots route must exist");

  const sitemap = read("src/app/sitemap.ts");
  const robots = read("src/app/robots.ts");
  for (const route of ["/hris", "/time-and-attendance", "/employee-self-service", "/compliance", "/implementation", "/security", "/industries/bpo"]) {
    assert.ok(sitemap.includes(`path: "${route}"`), `sitemap must include ${route}`);
  }
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
  ] as const;

  for (const [path, keyword] of pages) {
    assert.ok(existsSync(path), `${path} must exist`);
    const source = read(path);
    assert.ok(source.includes(keyword), `${path} metadata must target ${keyword}`);
    assert.ok(source.includes("alternates: { canonical:"), `${path} must declare a canonical`);
  }
});

test("compliance copy does not overstate government filing readiness", () => {
  const page = read("src/app/compliance/page.tsx");
  assert.ok(page.includes("DRAFT until validated"), "compliance page must preserve government-output validation language");
  assert.ok(page.includes("calculation equals filing"), "compliance page must distinguish computation from filing readiness");
  assert.ok(!page.includes("guaranteed compliance"), "compliance page must not promise guaranteed compliance");
  assert.ok(!page.includes("100% compliant"), "compliance page must not claim 100% compliance");
});

test("security page only claims repository-evidenced controls", () => {
  const page = read("src/app/security/page.tsx");
  assert.ok(page.includes("TOTP multi-factor authentication"), "security page should expose implemented MFA");
  assert.ok(page.includes("Tenant isolation"), "security page should expose tenant-isolation controls");
  assert.ok(page.includes("does not claim ISO, SOC 2"), "security page must explicitly avoid unsupported certification claims");
});

test("public navigation exposes new authority routes", () => {
  const navigation = read("src/components/marketing/public-navigation.ts");
  for (const route of ["/hris", "/time-and-attendance", "/compliance", "/implementation", "/security", "/industries/bpo"]) {
    assert.ok(navigation.includes(`href: "${route}"`), `public navigation must expose ${route}`);
  }
});
