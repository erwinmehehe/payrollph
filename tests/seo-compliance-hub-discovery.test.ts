import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { compliancePages } from "../src/lib/seo-content";
import { complianceWave3 } from "../src/lib/seo-content-wave3";

const source = readFileSync("src/app/compliance/page.tsx", "utf8");

test("compliance hub directly links every compliance authority child", () => {
  for (const page of [...compliancePages, ...complianceWave3]) {
    const href = `/compliance/${page.slug}`;
    assert.ok(source.includes(`href: "${href}"`), `compliance hub must link ${href}`);
  }
});

test("compliance hub keeps evergreen update process separate from dated archive", () => {
  assert.ok(source.includes('href: "/compliance/regulatory-updates"'));
  assert.ok(source.includes('href: "/resources/updates"'));
  assert.ok(source.includes('label: "Regulatory update process"'));
  assert.ok(source.includes('label: "Regulatory update archive"'));
});

test("Alphalist authority page is linked directly from compliance hub", () => {
  assert.ok(source.includes('label: "BIR Alphalist"'));
  assert.ok(source.includes('href: "/compliance/alphalist"'));
});
