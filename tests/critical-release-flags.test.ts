import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CRITICAL_RELEASE_FLAGS, criticalReleaseFlagEnabled, criticalReleaseFlagInventory,
} from "../src/lib/critical-release-flags";
import { isCentralSchedulerEnabled } from "../src/lib/scheduler-activation";

test("every critical boolean release gate defaults OFF, only exact 'true' turns it on", () => {
  for (const item of criticalReleaseFlagInventory()) {
    assert.equal(item.defaultEnabled, false, item.key);
    assert.ok(item.owner.length > 0 && item.approval.length > 0 && item.risk.length > 0);
    const key = item.key as keyof typeof CRITICAL_RELEASE_FLAGS;
    for (const raw of [undefined, "", "1", "TRUE", "True", "false", "on", "enabled"]) {
      assert.equal(criticalReleaseFlagEnabled(key, { [item.env]: raw }), false, item.key);
    }
    assert.equal(criticalReleaseFlagEnabled(key, { [item.env]: "true" }), true);
  }
});

test("unknown release-critical flags are rejected instead of silently enabled", () => {
  assert.throws(() => criticalReleaseFlagEnabled("totallyUnreviewed" as never, {
    totallyUnreviewed: "true",
  }), /Unknown release-critical/);
});

test("the critical gate registry contains no duplicate env variable names", () => {
  const names = criticalReleaseFlagInventory().map((item) => item.env);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("PAYMONGO_DISBURSEMENTS_ENABLED"));
  assert.ok(names.includes("OPENAI_AUTOMATION_DRAFT_ENABLED"));
  assert.ok(names.includes("CENTRAL_SCHEDULER_ENABLED"));
});

test("central scheduler activation must consult typed gate even with a worker enabled", () => {
  assert.equal(isCentralSchedulerEnabled({ WORKER_ENABLED: "true" }), false);
  assert.equal(isCentralSchedulerEnabled({ CENTRAL_SCHEDULER_ENABLED: "true" }), true);
  const source = readFileSync("src/lib/scheduler-activation.ts", "utf8");
  assert.match(source, /criticalReleaseFlagEnabled\("centralScheduler", env\)/);
});

test("production document uploads are gated behind registry without changing isolated dev acceptance", () => {
  const source = readFileSync("src/lib/storage.ts", "utf8");
  assert.ok(source.includes('criticalReleaseFlagEnabled("documentUploads")'));
  assert.ok(source.includes('process.env.NODE_ENV !== "production"'));
});
