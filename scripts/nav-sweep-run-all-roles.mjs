/**
 * Runs each fictional navigation role in a separate Node/Chromium lifetime.
 * The original monolithic sweep lost the browser after 238 successful route
 * checks. Missing or duplicate roles/pages must never produce a green CI run.
 * No app mutations, production DB, or payout operations are performed here.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_DIR = "qa-artifacts/nav-sweep";
const VIEWPORTS = [1280, 390];
const slot = (role, viewport, page) => JSON.stringify([role, viewport, page]);
const safe = (value) => String(value ?? "").replace(/[\r\n|]+/g, " ").slice(0, 450);

function infra(role, detail) {
  return {
    role, viewport: 0, page: "SWEEP_INFRASTRUCTURE", result: "FAIL",
    elapsedMs: 0,
    findings: [{ kind: "infrastructure", detail: safe(detail) }],
    screenshot: null, skippedControls: 0, skippedExamples: [],
  };
}

/** Pure, fail-closed aggregation for the subprocess reports. */
export function aggregateNavSweep(manifest, outcomes) {
  assert.ok(Array.isArray(manifest?.roles) && manifest.roles.length > 0, "No navigation roles");
  assert.ok(Array.isArray(outcomes), "Missing role outcomes");
  const expected = new Set();
  const roles = new Set();
  const issues = [];
  const observed = new Map();

  for (const spec of manifest.roles) {
    assert.match(spec.role, /^[a-z][a-z0-9_-]{0,63}$/);
    assert.ok(!roles.has(spec.role), "Duplicate manifest role: " + spec.role);
    roles.add(spec.role);
    assert.ok(Array.isArray(spec.pages) && spec.pages.length > 0, "Empty role pages");
    assert.equal(new Set(spec.pages).size, spec.pages.length, "Duplicate page in " + spec.role);
    for (const width of VIEWPORTS) {
      for (const page of spec.pages) expected.add(slot(spec.role, width, page));
    }
  }

  const roleOutcomes = new Map();
  for (const outcome of outcomes) {
    if (!roles.has(outcome.role) || roleOutcomes.has(outcome.role)) {
      issues.push(infra(outcome.role ?? "unknown", "Unexpected or repeated role execution"));
      continue;
    }
    roleOutcomes.set(outcome.role, outcome);
  }

  for (const spec of manifest.roles) {
    const execution = roleOutcomes.get(spec.role);
    if (!execution) {
      issues.push(infra(spec.role, "Role execution missing: not tested"));
      continue;
    }
    if (execution.exitStatus !== 0 || execution.error || execution.signal) {
      issues.push(infra(spec.role, "Role process failed: status=" +
        String(execution.exitStatus) + " signal=" + String(execution.signal ?? "") +
        " " + String(execution.error ?? "")));
    }
    const report = execution.report;
    if (!report || !Array.isArray(report.results)) {
      issues.push(infra(spec.role, "Role report absent or malformed"));
      continue;
    }
    if (report.syntheticOnly !== true || report.productionDataUsed !== false ||
        report.injectedFailure !== false || report.total !== report.results.length ||
        report.passed !== report.results.filter(r => r.result === "PASS").length ||
        report.failed !== report.results.filter(r => r.result === "FAIL").length) {
      issues.push(infra(spec.role, "Role report integrity, synthetic scope or totals mismatch"));
    }
    for (const row of report.results) {
      const key = slot(row.role, row.viewport, row.page);
      if (row.role !== spec.role || !expected.has(key) || observed.has(key)) {
        issues.push(infra(spec.role, "Unexpected or duplicate route/viewport result: " + key));
        continue;
      }
      if (!["PASS", "FAIL"].includes(row.result) || !Array.isArray(row.findings) ||
          (row.result === "PASS" && row.findings.length !== 0) ||
          (row.result === "FAIL" && row.findings.length === 0)) {
        issues.push(infra(spec.role, "Invalid result or findings for: " + key));
        continue;
      }
      observed.set(key, row);
    }
  }

  const results = [];
  for (const spec of manifest.roles) {
    for (const viewport of VIEWPORTS) {
      for (const page of spec.pages) {
        const key = slot(spec.role, viewport, page);
        results.push(observed.get(key) ?? {
          role: spec.role, viewport, page, result: "FAIL", elapsedMs: 0,
          findings: [{ kind: "coverage", detail: "No completed browser observation for " + key }],
          screenshot: null, skippedControls: 0, skippedExamples: [],
        });
      }
    }
  }
  results.push(...issues);
  const passed = results.filter(r => r.result === "PASS").length;
  return {
    generatedAt: new Date().toISOString(), syntheticOnly: true,
    productionDataUsed: false, injectedFailure: false,
    expectedSlots: expected.size, total: results.length, passed,
    failed: results.length - passed, results,
  };
}

function writeReport(report) {
  writeFileSync(OUTPUT_DIR + "/report.json", JSON.stringify(report, null, 2));
  const lines = [
    "# PayrollPH navigation and runtime sweep", "",
    "Synthetic, disposable PostgreSQL only. Each role runs in an isolated Node/Chromium process.",
    "", "Expected route/viewport observations: " + report.expectedSlots,
    "Total: " + report.total + " | Pass: " + report.passed + " | Fail: " + report.failed,
    "", "| Role | Viewport | Page | Result | Findings | Screenshot |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.results.map(r => "| " + safe(r.role) + " | " + r.viewport + "px | " +
      safe(r.page) + " | " + r.result + " | " +
      safe(r.findings.map(f => f.kind + ": " + f.detail).join("; ")) + " | " +
      safe(r.screenshot || "—") + " |"),
  ];
  writeFileSync(OUTPUT_DIR + "/report.md", lines.join("\n") + "\n");
}

function main() {
  assert.equal(process.env.CI, "true", "CI only");
  assert.equal(process.env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(dbUrl.hostname, "127.0.0.1", "No external database access");
  assert.equal(dbUrl.pathname, "/app_db");
  const manifest = JSON.parse(readFileSync(OUTPUT_DIR + "/manifest.json", "utf8"));
  assert.ok(Array.isArray(manifest.roles) && manifest.roles.length, "Manifest required");
  const snapshots = OUTPUT_DIR + "/by-role";
  mkdirSync(snapshots, { recursive: true });
  const roleReports = [];
  const reportPath = OUTPUT_DIR + "/report.json";
  for (const spec of manifest.roles) {
    assert.match(spec.role, /^[a-z][a-z0-9_-]{0,63}$/);
    // Explicitly eliminate stale reports from the focused and negative tests.
    rmSync(reportPath, { force: true });
    console.log("NAV_SWEEP_ROLE_START " + spec.role);
    const child = spawnSync(process.execPath,
      ["--import", "tsx", "--test", "tests/e2e/nav-sweep.spec.mjs"], {
        stdio: "inherit", timeout: 12 * 60 * 1000,
        env: {
          ...process.env,
          NAV_SWEEP_FOCUS_ROLE: spec.role,
          NAV_SWEEP_FOCUS_PAGE: "",
          NAV_SWEEP_INJECT_BROKEN: "false",
          NAV_SWEEP_ONLY_OWNER: "false",
        },
      });
    let report = null;
    let error = child.error?.message ?? null;
    if (existsSync(reportPath)) {
      try {
        report = JSON.parse(readFileSync(reportPath, "utf8"));
        writeFileSync(snapshots + "/" + spec.role + ".json", JSON.stringify(report, null, 2));
      } catch (cause) { error = String(cause); }
    }
    roleReports.push({ role: spec.role, report, exitStatus: child.status,
      signal: child.signal, error });
    console.log("NAV_SWEEP_ROLE_END " + spec.role +
      " exit=" + child.status + " reported=" + (report?.results?.length ?? 0));
    // A failed role must fail the final coverage ledger; no fake retries.
    // Do not spend runner time on further roles if the app/browser is broken.
    if (child.status !== 0 || error) break;
  }
  const combined = aggregateNavSweep(manifest, roleReports);
  writeReport(combined);
  console.log("NAV_SWEEP_COMPLETE expected=" + combined.expectedSlots +
    " passed=" + combined.passed + " failed=" + combined.failed);
  if (combined.failed !== 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
