#!/usr/bin/env node
/**
 * #1127 synthetic QA evidence gate. No network or SQL. A nonempty Atlas plan,
 * Squawk warning, CLI nonzero exit or unparsable report blocks the job.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classifyAtlasDiff, classifySquawkReport } from "./lib/independent-schema-evidence.mjs";

const path = resolve("qa-artifacts/independent-pg16");
const tool = process.argv[2];
if (!["squawk", "atlas"].includes(tool)) throw new Error("Expected squawk or atlas");

let result;
if (tool === "squawk") {
  const exitText = readFileSync(resolve(path, "squawk-exit.txt"), "utf8").trim();
  if (!/^(0|[1-9][0-9]*)$/.test(exitText)) throw new Error("Missing or malformed Squawk exit code");
  result = classifySquawkReport(
    readFileSync(resolve(path, "squawk.json"), "utf8"), Number(exitText)
  );
} else {
  result = classifyAtlasDiff(readFileSync(resolve(path, "atlas-source-vs-train.diff.sql"), "utf8"));
}
const summary = {
  tool, ...result,
  evidence: "SYNTHETIC_LOCAL_PG16_ONLY_NOT_PRODUCTION_PARITY",
  prHeadSha: process.env.PR_HEAD_SHA || null,
  workflowCommitSha: process.env.GITHUB_SHA || null,
  migrationReceipt: false,
  approvedForRelease: false,
};
writeFileSync(resolve(path, tool + "-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary));
if (summary.status !== "PASS") process.exitCode = 1;
