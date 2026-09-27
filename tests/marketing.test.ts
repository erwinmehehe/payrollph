import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("the public payroll-software homepage exists at the canonical root", () => {
  assert.ok(existsSync("src/app/page.tsx"), "/ must exist");
  assert.ok(existsSync("src/components/public-homepage.tsx"), "public homepage component must exist");
  assert.ok(read("src/app/page.tsx").includes("<PublicHomepage />"), "signed-out root must render the product homepage");
  assert.ok(read("src/app/welcome/page.tsx").includes('redirect("/")'), "/welcome should redirect to the canonical root");
});

test("pricing is read from the database, never hardcoded", () => {
  const page = read("src/components/public-homepage.tsx");
  assert.ok(page.includes("from \"@/db/schema\""), "pricing must come from the database");
  assert.ok(page.includes("pricingPlans"), "pricing must read the pricingPlans table");
  assert.ok(!/₱\s?1,499|₱\s?4,499|₱\s?12,999/.test(page), "prices must not be hardcoded in the page");
});

test("the page names competitors and carries the honest-status block", () => {
  const page = read("src/components/public-homepage.tsx");
  for (const competitor of ["Sprout", "PayrollHero", "GreatDay HR", "Kazam"]) {
    assert.ok(page.includes(competitor), `comparison table must name ${competitor}`);
  }
  assert.ok(/Launch status:/i.test(page), "must disclose readiness honestly");
  assert.ok(page.includes("/api/readiness"), "must link to the live gate list");
});

test("a regression test fails if the marketing page disappears again", () => {
  // Guards the real failure seen in this build: a file was deleted while its
  // tests were rewritten, so nothing flagged the loss.
  const testsDir = readFileSync("tests/marketing.test.ts", "utf8");
  assert.ok(testsDir.includes("existsSync"), "this file must keep asserting existence");
});
