/**
 * CI-only disposable build shim for a still-release-disabled multi-entity HR
 * feature. This NEVER changes committed production source or feature policy.
 * The exact activation guard must be restored after compilation. The resulting
 * HTTP acceptance is synthetic-path evidence, not production release approval.
 */
import assert from "node:assert/strict";
import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  PINS, blob, verifyPins, requireDisposableMultiHr,
} from "./tenant-hr-cases-multi-entity-contract.mjs";

export const ACTIVATION_PATH = "src/lib/hr-case-activation.ts";
const GUARDED =
  '  return criticalReleaseFlagEnabled("employeeHrCases", env) &&\n' +
  '    !criticalReleaseFlagEnabled("multiEntity", env);';
const SYNTHETIC =
  '  return criticalReleaseFlagEnabled("employeeHrCases", env) &&\n' +
  '    true /* ephemeral fictional PG16 HTTP build only; release guard restored */;';

export function syntheticActivation(source) {
  assert.equal(blob(source), PINS[ACTIVATION_PATH],
    "HR_ENTITY_REFUSED: production activation guard has drifted");
  assert.equal(source.split(GUARDED).length, 2,
    "HR_ENTITY_REFUSED: expected one deferred multi-entity activation guard");
  return source.replace(GUARDED, SYNTHETIC);
}
export function restoredActivation(source) {
  assert.equal(source.split(SYNTHETIC).length, 2,
    "HR_ENTITY_REFUSED: unexpected synthetic activation source");
  const original = source.replace(SYNTHETIC, GUARDED);
  assert.equal(blob(original), PINS[ACTIVATION_PATH],
    "HR_ENTITY_REFUSED: synthetic modification exceeded one activation guard");
  return original;
}

function main() {
  const action = process.argv[2];
  assert.ok(["apply", "restore", "verify"].includes(action),
    "HR_ENTITY_REFUSED: use apply, restore or verify");
  requireDisposableMultiHr();
  const path = resolve(process.cwd(), ACTIVATION_PATH);
  const source = readFileSync(path, "utf8");
  if (action === "apply") {
    verifyPins();
    writeFileSync(path, syntheticActivation(source));
    console.log("HR_ENTITY_CI_ONLY: synthetic multi-entity HR path compiled locally; production release gate not changed in Git");
  } else if (action === "restore") {
    writeFileSync(path, restoredActivation(source));
    verifyPins();
    console.log("HR_ENTITY_CI_ONLY: original deferred release guard restored byte-for-byte");
  } else {
    verifyPins();
    assert.equal(blob(source), PINS[ACTIVATION_PATH]);
    console.log("HR_ENTITY_CI_ONLY: production activation guard remains original and feature-off under multi-entity");
  }
}
if (process.argv[1]?.replaceAll("\\", "/")
  .endsWith("/tenant-hr-cases-multi-entity-build-activation.mjs")) {
  try { main(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
