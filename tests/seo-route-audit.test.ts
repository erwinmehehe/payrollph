import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  approvedCustomerSitemapEntries,
  calculatorSitemapEntries,
  complianceSitemapEntries,
  developerSitemapEntries,
  glossarySitemapEntries,
  industrySitemapEntries,
  pagesSitemapEntries,
  productSitemapEntries,
  resourceSitemapEntries,
} from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

const sitemapEntries = [
  ...pagesSitemapEntries,
  ...productSitemapEntries,
  ...complianceSitemapEntries,
  ...industrySitemapEntries,
  ...resourceSitemapEntries,
  ...calculatorSitemapEntries,
  ...glossarySitemapEntries,
  ...developerSitemapEntries,
  ...approvedCustomerSitemapEntries(),
];

function routeFile(path: string) {
  if (path === "/") return "src/app/page.tsx";
  if (path.startsWith("/resources/updates/")) return "src/app/resources/updates/[slug]/page.tsx";
  if (path.startsWith("/resources/") && path !== "/resources/updates") return "src/app/resources/[slug]/page.tsx";
  if (path.startsWith("/compliance/")) return "src/app/compliance/[slug]/page.tsx";
  if (path === "/industries/bpo") return "src/app/industries/bpo/page.tsx";
  if (path.startsWith("/industries/")) return "src/app/industries/[slug]/page.tsx";
  if (path.startsWith("/integrations/")) return "src/app/integrations/[slug]/page.tsx";
  if (path.startsWith("/calculators/")) return "src/app/calculators/[slug]/page.tsx";
  if (path.startsWith("/glossary/")) return "src/app/glossary/[slug]/page.tsx";
  if (path.startsWith("/developers/")) return "src/app/developers/[slug]/page.tsx";
  if (path.startsWith("/customers/")) return "src/app/customers/[slug]/page.tsx";
  return `src/app${path}/page.tsx`;
}

test("every sitemap URL resolves to an implemented page route", () => {
  for (const entry of sitemapEntries) {
    const file = routeFile(entry.path);
    assert.ok(existsSync(file), `${entry.path} must resolve to ${file}`);
  }
});

test("every sitemap page exposes title description and canonical metadata", () => {
  for (const entry of sitemapEntries) {
    const file = routeFile(entry.path);
    const content = read(file);

    assert.ok(
      content.includes("export const metadata") || content.includes("generateMetadata"),
      `${entry.path} must expose page metadata`,
    );
    assert.ok(content.includes("title:"), `${entry.path} must expose title metadata`);
    assert.ok(content.includes("description:"), `${entry.path} must expose description metadata`);
    assert.ok(content.includes("alternates"), `${entry.path} must expose alternates metadata`);
    assert.ok(content.includes("canonical:"), `${entry.path} must expose canonical metadata`);
  }
});

test("sitemap URLs are not statically noindex", () => {
  for (const entry of sitemapEntries) {
    const file = routeFile(entry.path);
    const content = read(file);
    const explicitNoindex = content.includes("robots: { index: false");
    const explicitIndex = content.includes("robots: { index: true");

    assert.equal(
      explicitNoindex && !explicitIndex,
      false,
      `${entry.path} must not be both sitemap-listed and statically noindex`,
    );
  }
});

test("authentication and setup routes remain outside sitemap and explicitly noindex", () => {
  const publicPaths = new Set(sitemapEntries.map((entry) => entry.path));
  const routes = ["/login", "/signup", "/setup", "/invite", "/reset-password", "/verify-email"];

  for (const path of routes) {
    assert.equal(publicPaths.has(path), false, `${path} must stay out of sitemap data`);
    const content = read(routeFile(path));
    assert.ok(content.includes("robots: { index: false"), `${path} must declare noindex`);
  }
});

test("application routes remain outside the public sitemap", () => {
  const publicPaths = new Set(sitemapEntries.map((entry) => entry.path));
  assert.equal(publicPaths.has("/app"), false);
  assert.equal(publicPaths.has("/workspace"), false);
});

test("CI runs all SEO audits before production build", () => {
  const ci = read(".github/workflows/ci.yml");
  const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

  assert.equal(pkg.scripts?.["seo:audit"], "tsx scripts/seo-launch-audit.ts");
  assert.equal(pkg.scripts?.["seo:routes"], "tsx scripts/seo-route-audit.ts");
  assert.equal(pkg.scripts?.["seo:links"], "tsx scripts/seo-internal-link-audit.ts");

  const ownershipIndex = ci.indexOf("npm run seo:audit");
  const routeIndex = ci.indexOf("npm run seo:routes");
  const linkIndex = ci.indexOf("npm run seo:links");
  const buildIndex = ci.indexOf("npx next build");

  assert.ok(ownershipIndex >= 0);
  assert.ok(routeIndex > ownershipIndex);
  assert.ok(linkIndex > routeIndex);
  assert.ok(buildIndex > linkIndex);
});

test("route audit checks canonical metadata and noindex conflicts", () => {
  const audit = read("scripts/seo-route-audit.ts");
  assert.ok(audit.includes("missing-canonical"));
  assert.ok(audit.includes("sitemap-noindex-conflict"));
  assert.ok(audit.includes("private-route-in-sitemap"));
  assert.ok(audit.includes("private-route-not-noindex"));
});


test("internal-link audit prevents sitemap-only orphan SEO children", () => {
  const audit = read("scripts/seo-internal-link-audit.ts");

  assert.ok(audit.includes("orphan-hub-child"), "link audit must fail child routes that are absent from their hub");
  assert.ok(audit.includes("resourcePages"), "link audit must cover resource authority pages");
  assert.ok(audit.includes("compliancePages"), "link audit must cover compliance authority pages");
  assert.ok(audit.includes("industryPages"), "link audit must cover industry authority pages");
  assert.ok(audit.includes("integrationWave6"), "link audit must cover integration child pages");
  assert.ok(audit.includes("Object.keys(CALCULATORS)"), "link audit must cover every calculator");
  assert.ok(audit.includes("glossaryEntries"), "link audit must cover glossary discovery");
  assert.ok(audit.includes("regulatoryUpdates"), "link audit must cover regulatory update discovery");
  assert.ok(audit.includes("PUBLISHABLE_CUSTOMER_STORIES"), "link audit must cover approved customer stories");
});
