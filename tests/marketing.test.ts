import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("the root route owns the public payroll software landing page", () => {
  const root = read("src/app/page.tsx");
  const welcome = read("src/app/welcome/page.tsx");
  assert.ok(root.includes("SoftwareHome"), "signed-out root must render the product landing page");
  assert.ok(root.includes("Payroll Software Philippines"), "root metadata must target payroll software intent");
  assert.ok(welcome.includes("permanentRedirect(\"/\")"), "/welcome must redirect to the canonical root");
});

test("pricing is read from the database, never hardcoded in the homepage UI", () => {
  const page = read("src/components/marketing/software-home.tsx");
  const catalog = read("src/lib/pricing-catalog.ts");

  assert.ok(page.includes("getPublicPricingPlans"), "homepage must load pricing through the database pricing helper");
  assert.ok(catalog.includes("from \"@/db/schema\""), "pricing helper must use the database schema");
  assert.ok(catalog.includes("pricingPlans"), "pricing helper must read the pricingPlans table");
  assert.ok(catalog.includes(".select()"), "pricing helper must select persisted pricing rows");
  assert.ok(!/₱\s?1,499|₱\s?4,499|₱\s?12,999/.test(page), "prices must not be hardcoded in the page");
});

test("the redesigned homepage keeps the interactive payroll simulation", () => {
  const page = read("src/components/marketing/software-home.tsx");
  assert.ok(page.includes('<WorkspacePreview mode="interactive" />'), "interactive payroll simulation must remain mounted");
  assert.ok(page.includes('id="simulation"'), "simulation must have a direct anchor");
  assert.ok(page.includes("Try a payroll run before you sign up."), "simulation must be introduced as a real product experience");
});

test("the redesigned homepage stays customer-facing instead of restoring the old comparison wall", () => {
  const page = read("src/components/marketing/software-home.tsx");
  assert.ok(page.includes("Philippine payroll, without the guesswork."), "homepage must keep the simplified payroll proposition");
  assert.ok(page.includes("Prepare") && page.includes("Calculate") && page.includes("Review") && page.includes("Approve") && page.includes("Release"),
    "homepage must explain the payroll workflow");
  for (const competitor of ["Sprout", "PayrollHero", "GreatDay HR", "Kazam"]) {
    assert.ok(!page.includes(competitor), `homepage should not restore the old ${competitor} comparison table`);
  }
  assert.ok(existsSync("src/app/demo/page.tsx"), "role-based demo page must exist");
});

test("payroll outsourcing has its own service route and conversion path", () => {
  assert.ok(existsSync("src/app/payroll-outsourcing/page.tsx"), "payroll outsourcing page must exist");
  assert.ok(existsSync("src/components/marketing/payroll-quote-form.tsx"), "outsourcing quote form must exist");
  assert.ok(existsSync("src/app/api/payroll-outsourcing/quote/route.ts"), "outsourcing enquiry endpoint must exist");

  const page = read("src/app/payroll-outsourcing/page.tsx");
  assert.ok(page.includes("Payroll Outsourcing Philippines"), "service metadata must target outsourcing intent");
  assert.ok(page.includes("Get a payroll quote"), "service page must use a quote CTA");
  assert.ok(!page.includes("PricingTable"), "outsourcing page must not reuse product pricing");
});
