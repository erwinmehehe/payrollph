#!/usr/bin/env node
/**
 * A complete, traceable human-review queue for unmodified 0124-0126 Squawk
 * findings. This file never drops, waives, downgrades or auto-fixes a warning.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { classifySquawkReport } from "./lib/independent-schema-evidence.mjs";

const directory = "qa-artifacts/independent-pg16/";
const files = Object.freeze([
  "drizzle/0124_attendance_exception_forward_repair.sql",
  "drizzle/0125_wfm_availability_open_shifts_forward_repair.sql",
  "drizzle/0126_compensation_governance_forward_repair.sql",
]);
const source = Object.fromEntries(files.map(file => {
  const sql = readFileSync(file, "utf8");
  return [file, { sha256:createHash("sha256").update(sql).digest("hex"),
    lineCount: sql.split("\n").length }];
}));
const decisions = Object.freeze({
  "require-lock-timeout": "VERIFY_PROTECTED_RUNNER_LOCK_TIMEOUT_WITH_DBA",
  "require-statement-timeout": "VERIFY_PROTECTED_RUNNER_STATEMENT_TIMEOUT_WITH_DBA",
  "prefer-bigint-over-int": "REVIEW_EXISTING_INTEGER_PK_FK_AND_APP_CONTRACT",
  "prefer-identity": "REVIEW_LEGACY_SERIAL_SEQUENCE_AND_IDENTITY_COMPATIBILITY",
  "prefer-text-field": "REVIEW_VARCHAR_LENGTH_AND_SCHEMA_CONTRACT",
});
const raw = readFileSync(directory + "squawk.json", "utf8");
const exit = Number(readFileSync(directory + "squawk-exit.txt", "utf8").trim());
const verdict = classifySquawkReport(raw, exit);
const findings = JSON.parse(raw);
assert.equal(findings.length, verdict.findingCount);
const reviewed = findings.map((x,i) => {
  assert.ok(Object.hasOwn(source, x.file),
    "Squawk emitted out-of-scope source file");
  assert.ok(Number.isInteger(x.line) && x.line >= 0 &&
    x.line <= source[x.file].lineCount, "Squawk finding line out of source");
  return {
    id: i + 1, file: x.file, sourceSha256: source[x.file].sha256,
    line: x.line, column: x.column, severity: x.level,
    rule: x.rule_name, message: x.message, help: x.help,
    disposition: "OPEN_INDEPENDENT_ENGINEERING_DBA_REVIEW",
    reviewQuestion: decisions[x.rule_name] || "UNCLASSIFIED_FINDING_STOP_AND_REVIEW",
    waiverGranted: false, migrationEdited: false,
  };
});
const totals = {};
for (const file of files) {
  totals[file] = Object.fromEntries([...new Set(reviewed.filter(x=>x.file===file)
    .map(x=>x.rule))].sort().map(rule => [rule,
    reviewed.filter(x=>x.file===file && x.rule===rule).length]));
}
const evidence = {
  status: verdict.status === "PASS" ? "NO_SQUAWK_FINDINGS_NOT_RELEASE_APPROVAL" :
    "BLOCKED_PENDING_INDEPENDENT_REVIEW",
  version: "squawk-cli@2.65.0",
  postgres: 16, transactionAssumed: true,
  actualRunnerTimeoutsInSource: {
    lock_timeout: "5000ms", statement_timeout: "90000ms",
    provenUsedInProduction: false,
  },
  rulesDisabled: 0, autoWaived: 0, changedHistoricalSQL: false,
  sourceSha256: source, squawkExit: exit,
  warningCount: findings.filter(x=>x.level==="Warning").length,
  parserErrorCount: findings.filter(x=>x.level==="Error").length,
  groupedByFileAndRule: totals,
  findings: reviewed,
  evidenceOnly: true, databaseAccessed: false,
  productionApproved: false,
  prHeadSha: process.env.PR_HEAD_SHA || null,
};
writeFileSync(directory + "squawk-independent-review.json",
  JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({
  status:evidence.status,warnings:evidence.warningCount,
  parserErrors:evidence.parserErrorCount,
  byFile:totals, approvedForProd:false,
}));
if (!findings.every(x => reviewed.find(r => r.id === findings.indexOf(x)+1)))
  throw new Error("Squawk findings were omitted from the evidence queue");
// Deliberately do not exit 1 here: the separate unchanged independent
// Squawk checker blocks the workflow after this artifact is retained.
