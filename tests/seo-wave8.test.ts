import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("public trial landing page exists and owns trial intent", () => {
  assert.ok(existsSync("src/app/trial/page.tsx"));
  const page = read("src/app/trial/page.tsx");
  assert.ok(page.includes("Payroll Software Trial Philippines | Linaw"));
  assert.ok(page.includes('alternates: { canonical: "/trial" }'));
  assert.ok(page.includes("Controlled trial access"));
  assert.ok(page.includes("StructuredData breadcrumbs="));
});

test("trial page does not invent free-trial terms", () => {
  const page = read("src/app/trial/page.tsx");
  assert.ok(page.includes("does not claim a specific free-trial duration"));
  assert.ok(page.includes("no-credit-card policy"));
  assert.ok(page.includes("automatic approval"));
  assert.ok(!page.includes("30-day free trial"));
  assert.ok(!page.includes("free forever"));
  assert.ok(!page.includes("no credit card required"));
});

test("trial page preserves immediate demo and controlled workspace distinction", () => {
  const page = read("src/app/trial/page.tsx");
  assert.ok(page.includes("The public demo is available immediately."));
  assert.ok(page.includes("dedicated trial workspace is requested and provisioned"));
  assert.ok(page.includes('href="/signup"'));
  assert.ok(page.includes('href="/demo"'));
});

test("public navigation and pricing route trial intent through the indexable page", () => {
  const nav = read("src/components/marketing/public-navigation.ts");
  const pricing = read("src/app/pricing/page.tsx");
  assert.ok(nav.includes('{ label: "Request trial access", href: "/trial" }'));
  assert.ok(pricing.includes('href="/trial"'));
  assert.ok(!pricing.includes('href="/signup" className="rounded-full bg-[#6161FF]'));
});

test("trial landing page is included in sitemap while signup remains noindex", () => {
  const sitemap = read("src/app/sitemap.ts");
  const signup = read("src/app/signup/page.tsx");
  assert.ok(sitemap.includes('{ path: "/trial"'));
  assert.ok(signup.includes("robots: { index: false, follow: false }"));
});
