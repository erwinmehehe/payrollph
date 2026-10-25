#!/usr/bin/env node
/**
 * #1102 final remaining gate: review an operator's actual HOSTED UI/API and
 * separately verified DB amounts. No network, secrets, database or writes.
 * A passing offline comparison is NOT proof that the observations are genuine.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fictionalPublicDemoPayroll } from "../../src/lib/public-demo-payroll-fixture.ts";

const PERIODS = Object.freeze([
  { runId: 1, status: "Released", period: "Aug 16–31, 2026" },
  { runId: 2, status: "Pending approval", period: "Sep 1–15, 2026" },
  { runId: 3, status: "Needs review", period: "Sep 16–30, 2026" },
]);
const ALLOWED_FIELDS = Object.freeze([
  "runId", "status", "period", "detailCount",
  "dbGross", "dbNet", "apiGross", "apiNet", "uiGross", "uiNet",
]);

function moneyToCents(value) {
  assert.equal(typeof value, "string", "MONEY_MUST_BE_OBSERVED_STRING");
  const match = /^(?:₱\s*|PHP\s*)?(-?(?:[0-9]+|[1-9][0-9]{0,2}(?:,[0-9]{3})+))\.([0-9]{2})$/.exec(value);
  assert.ok(match, "INVALID_MONEY_FORMAT");
  return BigInt(match[1].replaceAll(",", "")) * 100n +
    (match[1].startsWith("-") ? -1n : 1n) * BigInt(match[2]);
}

export function verifyHostedDemoObservation(evidence) {
  assert.ok(evidence && typeof evidence === "object" && !Array.isArray(evidence), "INVALID_EVIDENCE");
  // The observer must separately confirm the actual SERVED app+DB target.
  assert.match(evidence.runningSha ?? "", /^[a-f0-9]{40}$/, "RUNNING_SHA_REQUIRED");
  assert.ok(Number.isFinite(Date.parse(evidence.observedAt)), "OBSERVATION_TIMESTAMP_REQUIRED");
  assert.equal(evidence.verifiedOriginalDbTarget, true, "ORIGINAL_DB_TARGET_NOT_VERIFIED");
  assert.equal(evidence.verifiedServedAppDbBinding, true, "SERVED_APP_DB_BINDING_NOT_VERIFIED");
  assert.ok(typeof evidence.observerRole === "string" && evidence.observerRole.length >= 3,
    "OBSERVER_ROLE_REQUIRED");
  assert.ok(Array.isArray(evidence.runs) && evidence.runs.length === 3, "THREE_ACTUAL_UI_RUNS_REQUIRED");
  assert.deepEqual(evidence.runs.map(x => x.runId).sort((a, b) => a - b), [1, 2, 3],
    "THREE_DISTINCT_RUN_IDS_REQUIRED");
  for (const [index, spec] of PERIODS.entries()) {
    const row = evidence.runs.find(x => x.runId === spec.runId);
    assert.ok(row, "MISSING_RUN");
    assert.deepEqual(Object.keys(row).sort(), [...ALLOWED_FIELDS].sort(),
      "UNKNOWN_FIELD_MAY_CONTAIN_PRIVATE_DATA");
    assert.equal(row.status, spec.status, "STATUS_MISMATCH");
    assert.equal(row.period, spec.period, "PERIOD_MISMATCH");
    assert.equal(row.detailCount, 6, "SIX_DETAILS_REQUIRED");
    const expected = fictionalPublicDemoPayroll(index);
    for (const [kind, reference] of [
      ["Gross", moneyToCents(expected.grossPay)],
      ["Net", moneyToCents(expected.netPay)],
    ]) {
      for (const source of ["db", "api", "ui"]) {
        assert.equal(moneyToCents(row[source + kind]), reference,
          "HEADER_DETAIL_OR_HOSTED_UI_MISMATCH_" + spec.runId + "_" + source + kind);
      }
    }
  }
  return Object.freeze({
    runsCompared: 3, amountsCompared: 18,
    status: "OFFLINE_EVIDENCE_VALUES_CONSISTENT",
    realAppVerifiedByScript: false,
    actualDbQueriedByScript: false,
    ownerAcceptanceGranted: false,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(pathToFileURL(import.meta.url).pathname)) {
  try {
    assert.equal(process.argv.length, 4, "Usage: npx tsx scripts/qa/verify-1102-hosted-ui-evidence.mjs --file /private/evidence.json");
    assert.equal(process.argv[2], "--file", "EXPLICIT_LOCAL_FILE_REQUIRED");
    const input = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const result = verifyHostedDemoObservation(input);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    process.stderr.write("ISSUE1102_OFFLINE_EVIDENCE_BLOCKED: " +
      (error instanceof Error ? error.message : "unknown") + "\n");
    process.exitCode = 1;
  }
}
