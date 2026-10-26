import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { evaluateWfmTapResult } from "./lib/wfm-tap-summary.mjs";

const suites = [
  ["WFM-01", ["workforce-live-floor-client.test.ts", "workforce-team-roster-client.test.ts"],
    "Delayed responses and tenant/window/view ownership; does not replace live role testing."],
  ["WFM-02", ["workforce-team-roster-api.test.ts", "workforce-coverage-api.test.ts"],
    "Static/API scoped access controls; live two-tenant negative-access UAT outstanding."],
  ["WFM-03", ["workforce-team-roster.test.ts", "workforce-rotation-template.test.ts"],
    "Paginated roster/source semantics; manager 50–200 worker usability outstanding."],
  ["WFM-04", ["workforce-roster-cross-endpoint-lock.test.ts", "workforce-governed-bulk-publish.test.ts"],
    "Stale concurrent publication and advisory lock tests; two-manager app run outstanding."],
  ["WFM-05", ["wfm-role-demand.test.ts", "hcm-capability-wfm-integration.test.ts"],
    "Role and eligibility evidence; manager/HR authorization review outstanding."],
  ["WFM-06", ["wfm-attendance-capture-depth.test.ts", "workforce-absence-intervals.test.ts", "web-bundy-overnight-anchor.test.ts"],
    "Punch, partial-leave and overnight work-date anchoring regression; physical-device and bookkeeper acceptance outstanding."],
  ["WFM-07", ["wfm-premium-boundary-release.test.ts", "workforce-payroll.test.ts"],
    "Synthetic PH premium/pay rules; independent bookkeeper centavo reconciliation outstanding."],
  ["WFM-08", ["wfm-payroll-handoff-e2e.test.ts", "wfm-web-bundy-clockout-timesheet-stale.test.ts"],
    "Isolated DB correction/timecard/payroll handoff; actual-employer shadow payroll outstanding."],
  ["WFM-09", ["workforce-governed-bulk-publish.test.ts", "workforce-timesheet-api.test.ts"],
    "Source maker/checker restrictions; human cross-role UAT outstanding."],
  ["WFM-10", ["wfm-clock-in-watch.test.ts", "scheduler-activation.test.ts"],
    "Default-off/clock-watch source logic; live provider failure/retry and rollback not demonstrated."],
  ["WFM-11", ["workforce-live-floor-client.test.ts", "workforce-team-roster-client.test.ts"],
    "Scope/switch regressions; real browser, focus and network tests remain distinct."],
  ["WFM-12", [
    "wfm-clock-in-watch.test.ts",
    "wfm-clock-in-watch-paging.test.ts",
    "wfm-clock-watch-lease.test.ts",
    "wfm-clock-watch-lease-postgres.test.ts",
    "workforce-roster-scale-rules.test.ts",
    "wfm-roster-scale-postgres.test.ts",
    "workforce-team-roster-api.test.ts",
    "workforce-team-roster-client.test.ts",
  ], "1,000 isolated PostgreSQL assignments across six keyset pages; 50 tenant-scoped 20-worker roster SQL pages; bounded worker schedule reads; real DB lease takeover at clock-watch page/batch/dispatch checkpoints in both lanes with stubbed advisory delivery; exact 13-hour/5-hour rule findings; static API guards and client scope tests. Full leased scheduler tick, provider delivery, authenticated HTTP/manager-browser tests and real-device UAT remain NOT_RUN."],
  ["WFM-13", ["workforce-employee-upcoming-week.test.ts", "workforce-self-service.test.ts"],
    "Mobile view/source tests; 375px receipt browser QA tracked separately in PR #819."],
  ["WFM-14", [], "Real biometric/offline replay and drift require physical integration; cannot be certified synthetically."],
];

await mkdir("qa-artifacts", { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  sourceSha: process.env.GITHUB_SHA ?? "local",
  environment: "isolated PostgreSQL / fictional tests only",
  customerPilotAccepted: false, liveDeviceCertified: false, independentHumanReviewed: false,
  meaning: "A PASS below means only that the mapped automated tests passed. The canonical WFM-01..14 UAT remains NOT RUN.",
  cases: [],
};
for (const [id, files, boundary] of suites) {
  const result = { id, automated: "NOT_RUN", independentUat: "NOT_RUN",
    files: files.map(file => "tests/" + file), boundary };
  if (files.length) {
    const command = spawnSync("npx", ["--no-install", "tsx", "--test",
      "--test-concurrency=1", ...result.files], {
      encoding: "utf8", env: { ...process.env, CI: "true", TZ: "Asia/Manila" },
      timeout: 180000, maxBuffer: 4 * 1024 * 1024,
    });
    // A zero-exit subprocess can still have zero, skipped or unreported tests.
    // Count real TAP tests before granting a synthetic coverage PASS.
    const tap = evaluateWfmTapResult({
      exitCode: command.status, output: command.stdout, processError: command.error,
    });
    result.automated = tap.passed ? "PASS" : "FAIL";
    result.executedTests = tap.tests;
    result.passedTests = tap.passedTests;
    result.skippedTests = tap.skippedTests;
    result.todoTests = tap.todoTests;
    if (!tap.passed) {
      result.failureKind = command.error?.code || tap.failureKind;
      console.error(id + " FAIL; see GitHub Actions job logs for exact test assertions.");
      console.error((command.stderr || command.stdout || "").slice(-1100));
    } else {
      console.log(id + " automated PASS; independent UAT NOT RUN.");
    }
  } else {
    result.automated = "NOT_RUN_EXTERNAL";
    console.log(id + " external hardware gate NOT RUN.");
  }
  report.cases.push(result);
}
report.automatedPassed = report.cases.filter(c => c.automated === "PASS").length;
report.automatedFailed = report.cases.filter(c => c.automated === "FAIL").length;
report.automatedNotRun = report.cases.filter(c => c.automated.startsWith("NOT_RUN")).length;
report.uATPassed = 0;
await writeFile("qa-artifacts/wfm-pilot-synthetic-scenario-matrix.json",
  JSON.stringify(report, null, 2) + "\n");
console.log("Automated checks passed " + report.automatedPassed +
  "/13 attempted; all 14 independent UAT scenarios are still NOT RUN.");
if (report.automatedFailed) process.exitCode = 1;
