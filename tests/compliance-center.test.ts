import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("Compliance Center exposes statutory remittance evidence without claiming certification", () => {
  const panels = read("src/components/workspace/panels.tsx");
  const remittance = read("src/components/workspace/statutory-remittance-panel.tsx");

  assert.ok(panels.includes("StatutoryRemittancePanel"), "compliance workspace must expose remittance controls");
  assert.ok(panels.includes('title="Compliance"'), "compliance workspace should have a clear heading");
  assert.ok(panels.includes("prepared output is not agency acceptance"), "government output must remain evidence-gated");
  assert.ok(remittance.includes("Deducted does not mean remitted."), "remittance control must distinguish deductions from posting");
  assert.ok(remittance.includes("agency posting"), "employee-level posting reconciliation must remain visible");
  assert.ok(!panels.includes("official Philippine verification seals"), "UI must not imply government certification");
});
