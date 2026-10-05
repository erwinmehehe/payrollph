import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SEO_INTENT_OWNERS } from "../src/lib/seo-intent-ownership";
import { pagesSitemapEntries } from "../src/lib/sitemap-data";
import { STATIC_SEO_ROUTES } from "../src/lib/static-seo-routes";

const read = (path: string) => readFileSync(path, "utf8");

test("system status owns branded operational-status intent", () => {
  const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/status");
  assert.equal(owner?.primaryIntent, "linaw system status");
  assert.equal(owner?.intentClass, "trust");
});

test("system status is included in sitemap and static metadata governance", () => {
  const sitemapPaths = new Set(pagesSitemapEntries.map((entry) => entry.path));
  assert.ok(sitemapPaths.has("/status"));

  const staticRoute = STATIC_SEO_ROUTES.find((entry) => entry.path === "/status");
  assert.equal(staticRoute?.pageFile, "src/app/status/page.tsx");
});

test("system status keeps transparent first-party scope language", () => {
  const page = read("src/app/status/page.tsx");
  assert.ok(page.includes("This is Linaw&apos;s own"));
  assert.ok(page.includes("not a third-party status-page estimate"));
  assert.ok(page.includes("do not certify transactional email"));
  assert.ok(page.includes("BIR, SSS, PhilHealth and Pag-IBIG portal availability"));
});

test("system status has self-canonical and breadcrumb schema", () => {
  const page = read("src/app/status/page.tsx");
  assert.ok(page.includes('alternates: { canonical: "/status" }'));
  assert.ok(page.includes('name: "System status", path: "/status"'));
  assert.ok(page.includes("<StructuredData"));
});

test("system status does not publish unsupported uptime guarantees", () => {
  const page = read("src/app/status/page.tsx");
  assert.ok(!page.includes("99.99%"));
  assert.ok(!page.includes("guaranteed uptime"));
  assert.ok(!page.includes("100% uptime"));
});
