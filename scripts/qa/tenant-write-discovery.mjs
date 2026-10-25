#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { describeTables, buildWritePlan } from "./tenant-write-generator.mjs";

const args = process.argv.slice(2);
if (args.length !== 1 || !["--plan", "--probe"].includes(args[0])) {
  console.error("usage: node --import tsx scripts/qa/tenant-write-discovery.mjs --plan|--probe"); process.exit(2);
}
if (args[0] === "--probe") {
  const { requireWriteProbeTarget } = await import("./tenant-write-probe-http.mjs");
  requireWriteProbeTarget();
}
const schemaModule = await import("../../src/db/schema.ts");
const tables = describeTables(schemaModule.default ?? schemaModule);
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const plan = buildWritePlan(manifest, file => {
  const path = resolve(file), rel = relative(resolve("src/app/api"), path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw Error("ROUTE_OUTSIDE_WORKSPACE");
  return readFileSync(path, "utf8");
}, tables);
const destination = resolve("outputs/tenant-write-discovery");
mkdirSync(destination, { recursive: true });
writeFileSync(resolve(destination, "plan.json"), JSON.stringify({ ...plan, catalogue: tables }, null, 2) + "\n", { mode: 0o600 });
const summary = { kind: plan.kind, writesInventoried: plan.writes.length, tables: Object.keys(tables).length,
  executableCandidates: plan.writes.filter(r => !r.executionHold).length, coverageCredits: 0 };
if (args[0] === "--probe") {
  const { runWriteProbe } = await import("./tenant-write-probe-http.mjs");
  const result = await runWriteProbe(plan, tables);
  writeFileSync(resolve(destination, "results.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, ...result.summary, isolationAccepted: false }));
  if (result.summary.unavailable > 0) process.exitCode = 1;
} else console.log(JSON.stringify(summary));
