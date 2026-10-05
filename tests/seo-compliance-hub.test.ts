import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("compliance hub exposes the core Philippine payroll authority cluster", () => {
  const page = read("src/app/compliance/page.tsx");

  for (const href of [
    "/compliance/bir",
    "/compliance/sss",
    "/compliance/philhealth",
    "/compliance/pag-ibig",
    "/compliance/dole",
    "/compliance/withholding-tax",
    "/compliance/bir-2316",
    "/compliance/1601-c",
    "/compliance/calendar",
    "/resources/updates",
    "/compliance/payroll-audit",
  ]) {
    assert.ok(page.includes(`href: "${href}"`), `compliance hub must link to ${href}`);
  }
});

test("compliance hub keeps calculation, filing and legal applicability separate", () => {
  const page = read("src/app/compliance/page.tsx");

  assert.ok(page.includes("Does Linaw guarantee that a payroll is legally compliant?"));
  assert.ok(page.includes("What is the difference between payroll calculation and government filing readiness?"));
  assert.ok(page.includes("How should payroll teams handle regulatory changes?"));
  assert.ok(page.includes("What should be reviewed after payroll is released?"));

  assert.ok(!page.includes("100% compliant"), "compliance hub must not promise 100% compliance");
  assert.ok(!page.includes("guaranteed compliance"), "compliance hub must not promise guaranteed compliance");
});
