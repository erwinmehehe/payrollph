import assert from "node:assert/strict";
import test from "node:test";
import { newUnregisteredFlagReads } from "../scripts/qa/release-flag-new-usage-guard.mjs";

const registry = 'export const flags = { old: { env: "KNOWN_ENABLED", owner: "Operations", risk: "P0", approval: "Human" } }';

test("registered release toggles are accepted in added source lines", () => {
  const diff = [
    "diff --git a/src/module.ts b/src/module.ts",
    "+++ b/src/module.ts",
    '+const flag = process.env.KNOWN_ENABLED === "true";',
  ].join("\n");
  assert.deepEqual(newUnregisteredFlagReads(diff, registry), []);
});

test("unknown added direct and destructured toggles are rejected once per file/flag", () => {
  const diff = [
    "diff --git a/src/module.ts b/src/module.ts",
    "+++ b/src/module.ts",
    '+const enabled = process.env.NEW_ENABLED === "true";',
    '+const enabledAgain = process.env.NEW_ENABLED;',
    '+const another = process.env["BRACKET_ENABLED"];',
    "+const { DESTRUCTURED_ENABLED, KNOWN_ENABLED } = process.env;",
  ].join("\n");
  const findings = newUnregisteredFlagReads(diff, registry);
  assert.deepEqual(findings.map((entry) => entry.flag).sort(), [
    "BRACKET_ENABLED", "DESTRUCTURED_ENABLED", "NEW_ENABLED",
  ]);
  assert.ok(findings.every((entry) => entry.file === "src/module.ts"));
});

test("removed lines, tests and unrelated environment names cannot trigger the gate", () => {
  const diff = [
    "diff --git a/src/module.ts b/src/module.ts",
    "+++ b/src/module.ts",
    '-const was = process.env.REMOVED_ENABLED;',
    '+const regular = process.env.INTERNAL_SECRET;',
    "diff --git a/tests/check.test.ts b/tests/check.test.ts",
    "+++ b/tests/check.test.ts",
    '+const irrelevant = process.env.UNREGISTERED_ENABLED;',
  ].join("\n");
  assert.deepEqual(newUnregisteredFlagReads(diff, registry), []);
});

test("same unknown toggle in separate source files has an independent report entry", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "+++ b/src/a.ts",
    '+process.env.UNREGISTERED_ENABLED;',
    "diff --git a/src/b.tsx b/src/b.tsx",
    "+++ b/src/b.tsx",
    '+process.env.UNREGISTERED_ENABLED;',
  ].join("\n");
  assert.equal(newUnregisteredFlagReads(diff, registry).length, 2);
});
