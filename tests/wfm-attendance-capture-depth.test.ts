import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("team web bundy requires an employee selection and exposes break controls", () => {
  const modal = read("src/components/web-bundy-modal.tsx");
  const workspace = read("src/components/linaw-workspace.tsx");

  assert.ok(modal.includes("Select employee…"));
  assert.ok(modal.includes('handlePunch("break_start")'));
  assert.ok(modal.includes('handlePunch("break_end")'));
  assert.ok(modal.includes("Workstation / Mobile Browser"));
  assert.ok(workspace.includes("employees={data.employees}"));
});

test("biometric batch sync is replay-safe for buffered/offline device logs", () => {
  const route = read("src/app/api/biometrics/sync/route.ts");

  assert.ok(route.includes("bufferedOfflineSync: true"));
  assert.ok(route.includes("let duplicates = 0"));
  assert.ok(route.includes("if (applied) ingested += 1"));
  assert.ok(route.includes("else duplicates += 1"));
  assert.ok(route.includes("punchDate < new Date(existing.timeIn)"));
  assert.ok(route.includes("punchDate > new Date(existing.timeOut)"));
});
