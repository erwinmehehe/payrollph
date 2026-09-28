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

test("the software homepage keeps the real interactive product surfaces", () => {
  const page = read("src/components/marketing/software-home.tsx");
  assert.ok(page.includes('<WorkspacePreview mode="interactive" />'), "interactive workspace preview must remain mounted");
  assert.ok(page.includes("<StatutoryLab />"), "live statutory calculator must remain mounted");
});

test("the software page names competitors and carries the honest-status block", () => {
  const page = read("src/components/marketing/software-home.tsx");
  for (const competitor of ["Sprout", "PayrollHero", "GreatDay HR", "Kazam"]) {
    assert.ok(page.includes(competitor), `comparison table must name ${competitor}`);
  }
  assert.ok(/Production status:/i.test(page), "must disclose readiness honestly");
  assert.ok(page.includes("/api/readiness"), "must link to the live gate list");
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
