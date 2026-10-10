import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("banking and government worksheet labels fail closed on uncertified export formats", () => {
  const ui = readFileSync("src/components/workspace/exports.tsx", "utf8");
  const route = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  const exporter = readFileSync("src/lib/exporters.ts", "utf8");
  assert.ok(ui.includes("data-government-draft-warning"));
  assert.ok(ui.includes("not certified portal upload files"));
  assert.ok(ui.includes("not Form 2316"));
  assert.ok(route.includes('"X-Linaw-Government-File-Status"'));
  assert.ok(route.includes('"Cache-Control": "private, no-store"'));
  assert.ok(exporter.includes("DRAFT ONLY, not a certified government submission file"));
});
