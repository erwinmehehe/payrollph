import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("legacy trial and register URLs both redirect to the one canonical signup", () => {
  for (const path of ["src/app/trial/page.tsx", "src/app/register/page.tsx"]) {
    assert.ok(existsSync(path));
    assert.ok(read(path).includes('redirect("/signup")'), path + " must redirect to the owner registration");
    assert.ok(!read(path).includes("<AccessRequestForm"), "No parallel access request form is allowed");
  }
  const signup = read("src/app/signup/page.tsx");
  assert.ok(signup.includes('alternates: { canonical: "/signup" }'));
  assert.ok(signup.includes("<SelfServeSignupForm"));
  assert.ok(signup.includes('robots: { index: false, follow: false }'));
});

test("pilot registration publishes actual fixed terms without presenting payment checkout", () => {
  const signup = read("src/app/signup/page.tsx");
  const form = read("src/components/marketing/self-serve-signup-form.tsx");
  assert.ok(signup.includes("14-day development pilot"));
  assert.ok(signup.includes("Use fictional/test data only"));
  assert.ok(form.includes("10 employee seats"));
  assert.ok(form.includes("No card required"));
  assert.ok(form.includes('fetch("/api/signup"'));
  assert.ok(!form.includes('fetch("/api/billing/subscription/start"'));
  assert.ok(!form.includes("free forever"));
});

test("self-serve sample demo and company signup remain distinct experiences", () => {
  const signup = read("src/app/signup/page.tsx");
  assert.ok(signup.includes('href="/demo"'), "The demo remains immediately accessible");
  assert.ok(signup.includes("Separate company and employee records"));
  assert.ok(signup.includes("Email verification before owner access"));
  assert.ok(!signup.includes("AccessRequestForm"));
});

test("public footer and pricing link to the single registration destination", () => {
  const nav = read("src/components/marketing/public-navigation.ts");
  const pricing = read("src/app/pricing/page.tsx");
  assert.ok(nav.includes('{ label: "Create company account", href: "/signup" }'));
  assert.ok(pricing.includes('href="/signup"'));
  assert.ok(!nav.includes('href: "/trial"'));
  assert.ok(!pricing.includes('href="/trial"'));
});

test("redirect-only trial route is not indexed; demo owns former trial intent", () => {
  const sitemap = read("src/lib/sitemap-data.ts");
  const registry = read("src/lib/static-seo-routes.ts");
  const owner = read("src/lib/seo-intent-ownership.ts");
  const signup = read("src/app/signup/page.tsx");
  assert.ok(!sitemap.includes('{ path: "/trial"'));
  assert.ok(!registry.includes('{ path: "/trial"'));
  assert.ok(owner.includes('"payroll software trial philippines"'));
  assert.ok(!owner.includes('ownerPath: "/trial"'));
  assert.ok(signup.includes("robots: { index: false, follow: false }"));
});
