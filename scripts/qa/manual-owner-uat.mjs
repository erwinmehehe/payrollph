import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// OFFLINE owner UAT recording only: no HTTP, database, payroll, payout or agency operations.
const wfm = [
  "Tenant switch and stale response isolation",
  "Scoped manager and tenant-B access denial",
  "Seven-day multi-site 50-200 worker roster",
  "Concurrent overlapping shift conflicts",
  "Leave, qualifications and eligibility",
  "Punch, break and leave exceptions",
  "PH holiday, rest, OT and night premiums",
  "Corrections, stale timesheets and cutoff lock",
  "Maker/checker authorization",
  "Flags OFF, provider errors and retries",
  "Network, refresh and mobile navigation",
  "Paging/leases with more than 200 assignments",
  "Low-bandwidth employee mobile usability",
  "Actual physical biometric/offline device only",
];
const journey = [
  "Hire fictional worker; candidate conversion is a separate gate",
  "Onboard the same worker",
  "Schedule the same worker",
  "Clock in/out; distinguish live punches from seeded history",
  "Approve the attendance snapshot",
  "Calculate the matching payroll period",
  "Independent-role checker reviews payroll",
  "Release payroll RECORDS, never money",
  "Prepare only draft filing worksheets",
];
export const SCENARIOS = Object.freeze([
  ...wfm.map((description, index) => Object.freeze({
    id: "WFM-" + String(index + 1).padStart(2, "0"), family: "WFM",
    priority: index < 10 ? "P0" : "P1", description,
  })),
  ...journey.map((description, index) => Object.freeze({
    id: "JOURNEY-" + String(index + 1).padStart(2, "0"), family: "JOURNEY",
    priority: "P0", description,
  })),
]);
export const STATES = Object.freeze(["NOT_RUN", "PASS", "NEEDS_FIX", "BLOCKED"]);
const evidencePattern = /^UAT-[A-Z0-9][A-Z0-9-]{2,79}$/;
const defectPattern = /^BUG-[A-Z0-9][A-Z0-9-]{1,79}$/;
const blockers = new Set(["DEVICE", "ENVIRONMENT", "ROLE", "DATA", "REVIEWER", "OTHER"]);
const sessionFile = resolve("qa-artifacts/local-owner-uat/session.json");
const reportFile = resolve("qa-artifacts/local-owner-uat/summary.md");

export function createSession(sha, dirty = false, at = new Date().toISOString()) {
  assert.match(sha, /^[a-f0-9]{40}$/, "An exact source SHA is required");
  return {
    version: 1, sourceSha: sha, dirtyCheckoutAtStart: Boolean(dirty),
    createdAt: at, type: "fictional-local-owner-self-reported-uat",
    outcomes: Object.fromEntries(SCENARIOS.map(s => [s.id, {
      status: "NOT_RUN", evidenceRef: null, defectRef: null,
      blockerCode: null, physicalDeviceWitnessed: false, updatedAt: null,
    }])),
    independentHumanAccepted: false, realEmployerReconciled: false,
    hardwareCertified: false, agencyAccepted: false, moneyMoved: false,
    productionAuthorized: false,
  };
}

export function recordOutcome(session, id, status, evidence = "", detail = "", at = new Date().toISOString()) {
  assert.equal(session?.version, 1, "Invalid UAT session format");
  assert.ok(SCENARIOS.some(s => s.id === id), "Unknown canonical scenario");
  assert.ok(STATES.includes(status), "Unknown status");
  const result = {
    status, evidenceRef: null, defectRef: null, blockerCode: null,
    physicalDeviceWitnessed: false, updatedAt: at,
  };
  if (status === "PASS") {
    assert.match(evidence, evidencePattern, "PASS requires an opaque ID starting UAT-");
    if (id === "WFM-14") {
      assert.equal(detail, "REAL_DEVICE", "Physical WFM-14 cannot be passed through simulation");
      result.physicalDeviceWitnessed = true;
    } else assert.equal(detail, "", "Unexpected extra argument");
    result.evidenceRef = evidence;
  } else if (status === "NEEDS_FIX") {
    assert.match(evidence, evidencePattern, "Evidence ID required (UAT-...)");
    assert.match(detail, defectPattern, "Defect ID required (BUG-...)");
    result.evidenceRef = evidence;
    result.defectRef = detail;
  } else if (status === "BLOCKED") {
    assert.ok(blockers.has(evidence), "Use DEVICE, ENVIRONMENT, ROLE, DATA, REVIEWER or OTHER");
    assert.equal(detail, "", "Unexpected extra argument");
    result.blockerCode = evidence;
  } else assert.ok(evidence === "" && detail === "", "NOT_RUN must not contain fabricated proof");
  return {
    ...session, outcomes: { ...session.outcomes, [id]: result },
    independentHumanAccepted: false, realEmployerReconciled: false,
    hardwareCertified: false, agencyAccepted: false, moneyMoved: false,
    productionAuthorized: false,
  };
}

export function summarize(session) {
  assert.equal(session?.version, 1, "Unknown UAT session");
  const counts = Object.fromEntries(STATES.map(s => [s, 0]));
  for (const scenario of SCENARIOS) {
    const status = session.outcomes?.[scenario.id]?.status;
    assert.ok(STATES.includes(status), "Incomplete or corrupted UAT record");
    counts[status] += 1;
  }
  return { total: SCENARIOS.length, counts,
    p0SelfTested: SCENARIOS.filter(s => s.priority === "P0").every(s =>
      ["PASS", "NEEDS_FIX"].includes(session.outcomes[s.id].status)),
    independentHumanAccepted: false, realEmployerReconciled: false,
  };
}

export function renderSummary(session) {
  const s = summarize(session);
  const lines = [
    "# PayrollPH local owner UAT - SELF-REPORTED, NOT CERTIFIED",
    "",
    "Source commit: " + session.sourceSha,
    "Dirty checkout at session start: " + Boolean(session.dirtyCheckoutAtStart),
    "Session created: " + session.createdAt,
    "Counts: PASS=" + s.counts.PASS + ", NEEDS_FIX=" + s.counts.NEEDS_FIX +
      ", BLOCKED=" + s.counts.BLOCKED + ", NOT_RUN=" + s.counts.NOT_RUN,
    "P0 self-tested by operator: " + (s.p0SelfTested ? "YES" : "NO"),
    "Independent human audit/QA/payroll/DBA acceptance: NOT ESTABLISHED",
    "Actual employer one-period centavo reconciliation: NOT RUN",
    "Real bank or official agency acceptance: NOT RUN",
    "Payments/production authorization: NONE",
    "",
    "| Scenario | Self-reported result | Opaque evidence | Defect or blocker |",
    "| --- | --- | --- | --- |",
  ];
  for (const scenario of SCENARIOS) {
    const o = session.outcomes[scenario.id];
    lines.push("| " + scenario.id + " | " + o.status + " | " + (o.evidenceRef || "-") +
      " | " + (o.defectRef || o.blockerCode || "-") + " |");
  }
  lines.push("", "No user names, employee data, salaries or screenshot content are collected. Keep real evidence privately. The program records operator input only and DOES NOT execute UAT scenarios or independently validate the evidence.", "");
  return lines.join("\n");
}

function sha() { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
function dirty() { return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0; }
function writePrivate(path, data, json = true) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json ? JSON.stringify(data, null, 2) + "\n" : data,
    { mode: 0o600, flag: "w" });
}
const usage = [
  "Offline owner UAT evidence logger (does NOT perform actual app tests)",
  "  node scripts/qa/manual-owner-uat.mjs init",
  "  node scripts/qa/manual-owner-uat.mjs list",
  "  node scripts/qa/manual-owner-uat.mjs record WFM-01 PASS UAT-TEST001",
  "  node scripts/qa/manual-owner-uat.mjs record WFM-02 NEEDS_FIX UAT-TEST002 BUG-123",
  "  node scripts/qa/manual-owner-uat.mjs record WFM-14 BLOCKED DEVICE",
  "  node scripts/qa/manual-owner-uat.mjs report",
].join("\n");
async function main() {
  const [command, id, status, evidence = "", detail = ""] = process.argv.slice(2);
  if (command === "list") {
    for (const s of SCENARIOS) console.log(s.id + " (" + s.priority + "): " + s.description);
    return;
  }
  if (command === "init") {
    assert.ok(!existsSync(sessionFile), "Session exists; do not overwrite private evidence");
    writePrivate(sessionFile, createSession(sha(), dirty()));
    console.log("Created local UAT session at " + sessionFile);
    return;
  }
  if (!["record", "report"].includes(command)) {
    console.log(usage); process.exitCode = 2; return;
  }
  const session = JSON.parse(readFileSync(sessionFile, "utf8"));
  assert.equal(session.sourceSha, sha(), "Checkout changed: start a new session for the new SHA");
  if (command === "record") {
    const updated = recordOutcome(session, id, status, evidence, detail);
    writePrivate(sessionFile, updated);
    console.log(id + ": " + status + " recorded as SELF-reported only.");
  } else {
    writePrivate(reportFile, renderSummary(session), false);
    console.log("Saved sanitized owner self-test summary at " + reportFile);
    console.log(JSON.stringify(summarize(session)));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error?.message || "Local UAT capture failed"); process.exitCode = 1; });
}
