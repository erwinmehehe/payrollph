import assert from "node:assert/strict";
import test from "node:test";
import {
  newUnregisteredFlagReads,
  registeredReleaseFlagNames,
} from "../scripts/qa/release-flag-new-usage-guard.mjs";

const registry = [
  "export const CRITICAL_RELEASE_FLAGS = {",
  "  old: {",
  '    env: "KNOWN_ENABLED",',
  '    owner: "Operations",',
  '    risk: "P0 release control",',
  '    approval: "Independent review",',
  "  },",
  "} as const;",
].join("\n");

test("registered release toggles are accepted in added source lines", () => {
  const diff = [
    "diff --git a/src/module.ts b/src/module.ts",
    "+++ b/src/module.ts",
    '+const flag = process.env.KNOWN_ENABLED === "true";',
  ].join("\n");
  assert.deepEqual(newUnregisteredFlagReads(diff, registry), []);
});

test("unknown added dotted, bracket and destructured toggles are rejected once per file/flag", () => {
  const diff = [
    "diff --git a/src/module.ts b/src/module.ts",
    "+++ b/src/module.ts",
    '+const enabled = process.env.NEW_ENABLED === "true";',
    '+const enabledAgain = process.env.NEW_ENABLED;',
    '+const another = process.env["BRACKET_ENABLED"];',
    '+const { DESTRUCTURED_ENABLED, KNOWN_ENABLED } = process.env;',
  ].join("\n");
  const findings = newUnregisteredFlagReads(diff, registry);
  assert.deepEqual(findings.map((entry) => entry.flag).sort(), [
    "BRACKET_ENABLED", "DESTRUCTURED_ENABLED", "NEW_ENABLED",
  ]);
  assert.ok(findings.every((entry) => entry.file === "src/module.ts"));
});

test("split source expressions and optional chaining cannot bypass the A-7 gate", () => {
  const diff = [
    "diff --git a/src/split.ts b/src/split.ts",
    "+++ b/src/split.ts",
    "@@ -0,0 +1,17 @@",
    "+const flag = process",
    "+  .env",
    "+  .SPLIT_ENABLED === 'true';",
    "+const optional = process?.env?.OPTIONAL_ENABLED;",
    '+const literal = process.env?.["BRACKET_OPTIONAL_ENABLED"];',
    "+const template = process.env[" + String.fromCharCode(96) + "TEMPLATE_ENABLED" + String.fromCharCode(96) + "];",
    "+const {",
    "+  DESTRUCTURED_MULTILINE_ENABLED: enabled,",
    "+  KNOWN_ENABLED,",
    "+} = process.env;",
  ].join("\n");
  assert.deepEqual(newUnregisteredFlagReads(diff, registry).map((x) => x.flag).sort(), [
    "BRACKET_OPTIONAL_ENABLED", "DESTRUCTURED_MULTILINE_ENABLED",
    "OPTIONAL_ENABLED", "SPLIT_ENABLED", "TEMPLATE_ENABLED",
  ]);
});

test("removed lines, test paths, non-flags and hunk boundaries cannot trigger the gate", () => {
  const diff = [
    "diff --git a/src/module.ts b/src/module.ts",
    "+++ b/src/module.ts",
    "-const was = process.env.REMOVED_ENABLED;",
    "+const regular = process.env.INTERNAL_SECRET;",
    "@@ -2,0 +3 @@",
    "+const other = process",
    "@@ -5,0 +6 @@",
    "+.env.NOT_CONTIGUOUS_ENABLED;",
    "diff --git a/tests/check.test.ts b/tests/check.test.ts",
    "+++ b/tests/check.test.ts",
    "+const irrelevant = process.env.UNREGISTERED_ENABLED;",
  ].join("\n");
  assert.deepEqual(newUnregisteredFlagReads(diff, registry), []);
});

test("unknown toggle in separate source files is reported independently", () => {
  const diff = [
    "diff --git a/src/a.ts b/src/a.ts",
    "+++ b/src/a.ts",
    "+process.env.UNREGISTERED_ENABLED;",
    "diff --git a/src/b.tsx b/src/b.tsx",
    "+++ b/src/b.tsx",
    "+process.env.UNREGISTERED_ENABLED;",
  ].join("\n");
  assert.equal(newUnregisteredFlagReads(diff, registry).length, 2);
});

test("non-registered names in registry comments do not count as registered", () => {
  const spoofed = registry + '\n// env: "SPOOFED_ENABLED"';
  const diff = "+++ b/src/app.ts\n+process.env.SPOOFED_ENABLED;";
  assert.deepEqual(newUnregisteredFlagReads(diff, spoofed).map((x) => x.flag), ["SPOOFED_ENABLED"]);
});

test("incomplete, duplicate or unparseable registry entries fail closed", () => {
  assert.deepEqual([...registeredReleaseFlagNames(registry)], ["KNOWN_ENABLED"]);
  assert.throws(() => registeredReleaseFlagNames(registry.replace('owner: "Operations",', 'owner: "",')),
    /A7_REGISTRY_INCOMPLETE_ENTRY:old/);
  assert.throws(() => registeredReleaseFlagNames(registry.replace('approval: "Independent review",', "")),
    /A7_REGISTRY_INCOMPLETE_ENTRY:old/);
  assert.throws(() => registeredReleaseFlagNames(registry.replace("  old: {", '  old: {\n    // env: "DUPLICATE_ENABLED"')),
    /A7_REGISTRY_UNPARSED_ENV_FIELD/);
  const twice = registry.replace("} as const;", [
    "  another: {",
    '    env: "KNOWN_ENABLED", owner: "Other", risk: "P0", approval: "New review",',
    "  },",
    "} as const;",
  ].join("\n"));
  assert.throws(() => registeredReleaseFlagNames(twice), /A7_REGISTRY_DUPLICATE_ENV:KNOWN_ENABLED/);
  assert.throws(() => registeredReleaseFlagNames('export const flags = { env: "SPOOFED_ENABLED" }'),
    /A7_REGISTRY_DECLARATION_MISSING/);
});
