import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Treasury admin clearly identifies disabled and enabled operator separation", () => {
  const s = readFileSync("src/components/treasury-controls-panel.tsx", "utf8");
  assert.match(s, /data-treasury-separation-off/);
  assert.match(s, /Treasury separation is OFF/);
  assert.match(s, /data-treasury-separation-on/);
  assert.match(s, /Treasury separation is ON/);
  assert.match(s, /data\.policy\.enabled/);
  assert.match(s, /data\.canConfigure/);
});

test("new hire and legacy pay editor provide explicit monthly conversion guidance", () => {
  for (const path of ["src/components/new-hire-modal.tsx", "src/components/workspace/people.tsx"]) {
    const s = readFileSync(path, "utf8");
    assert.match(s, /data-monthly-workday-divisor-guidance/);
    assert.match(s, /standardWorkDaysPerMonth/);
    assert.match(s, /"22"/);
    assert.match(s, /"26"/);
    assert.match(s, /261\/262/);
    assert.match(s, /313\/314/);
  }
});
