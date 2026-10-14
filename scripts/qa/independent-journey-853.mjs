import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Offline completeness checking, not authentication, UAT execution or pilot certification.
// Do not pass real names, worker IDs, salaries, credentials, or file paths to this tool.
export const STAGES = Object.freeze([
  ["JOURNEY-01", "HR", "Create the fictional HRIS worker; label governed candidate conversion separately"],
  ["JOURNEY-02", "HR", "Finish onboarding for that same worker"],
  ["JOURNEY-03", "MANAGER", "Publish an authorized schedule for that worker"],
  ["JOURNEY-04", "EMPLOYEE", "Clock in and out for the tested pay cutoff"],
  ["JOURNEY-05", "MANAGER", "Approve the same attendance version and cutoff"],
  ["JOURNEY-06", "PAYROLL", "Calculate and inspect the matching no-money payroll"],
  ["JOURNEY-07", "CHECKER", "Independently review amounts and exceptions"],
  ["JOURNEY-08", "OWNER", "Release payroll records only; verify no payout"],
  ["JOURNEY-09", "PAYROLL", "Download and hash draft worksheets, without filing"],
].map(([id, role, expected]) => Object.freeze({ id, role, expected })));
export const CHECKS = Object.freeze([
  ["OWNER_PHYSICAL_MOBILE", "Owner independently completes the journey on a physical phone"],
  ["PAYROLL_PHYSICAL_MOBILE", "Payroll Officer independently completes assigned steps on a physical phone"],
  ["OWNER_EMPLOYER_SWITCH", "Owner switches fictional employer A to B to A without stale data"],
  ["PAYROLL_EMPLOYER_SWITCH", "Payroll Officer switches fictional employer A to B to A without leaks"],
  ["ONE_WORKER_ID", "HR, WFM and payroll records refer to the same worker"],
  ["ONE_PAY_PERIOD", "Actual clock punches and reviewed payroll use the same tested pay cutoff"],
  ["NO_DEVELOPER_ASSISTANCE", "Human operators complete the flow without a developer driving"],
  ["CUT_OFF_REAPPROVAL", "Corrections invalidate stale approvals; locked cutoff is enforced"],
  ["RECORDS_NOT_FUNDS", "Only payroll records are released; no funds or payout instructions"],
  ["DRAFT_FILE_HASHES", "Worksheet downloaded bytes and hashes retained; no agency acceptance claimed"],
].map(([id, expected]) => Object.freeze({ id, expected })));
const statuses = new Set(["NOT_RUN", "PASS", "NEEDS_FIX", "BLOCKED"]);
const blockers = new Set(["DEVICE", "ENVIRONMENT", "ROLE", "DATA", "REVIEWER", "OTHER"]);
const shaPattern = /^[a-f0-9]{40}$/;
const observedAtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const personPattern = /^PERSON-[A-Z0-9][A-Z0-9-]{2,39}$/;
const evidencePattern = /^UAT-[A-Z0-9][A-Z0-9-]{2,79}$/;
const defectPattern = /^BUG-[A-Z0-9][A-Z0-9-]{1,79}$/;
const inputPath = resolve("qa-artifacts/independent-journey-853/manifest.json");
const reportPath = resolve("qa-artifacts/independent-journey-853/summary.md");
const guardNames = ["moneyMoved", "agencySubmitted", "livePayoutEnabled", "realEmployerDataUsed", "productionAuthorized", "humanSignoffClaimed"];
const runtimeRefs = ["appBuildEvidence", "fixtureEvidence", "flagEvidence", "deviceEvidence", "databaseIsolationEvidence"];

function keys(value, fields, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid " + label);
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), "Unexpected or missing fields in " + label);
}
function emptyObservation() {
  return { status: "NOT_RUN", operatorRef: null, witnessRef: null,
    evidenceRef: null, defectRef: null, blockerCode: null, observedAt: null };
}
export function createTemplate(sourceSha) {
  assert.match(sourceSha, shaPattern, "Exact source commit required");
  return {
    version: 2, type: "fictional-independent-journey-observations-unverified",
    sourceSha, runtime: { deployedSha: null, ...Object.fromEntries(runtimeRefs.map(k => [k, null])) },
    stages: Object.fromEntries(STAGES.map(x => [x.id, emptyObservation()])),
    checks: Object.fromEntries(CHECKS.map(x => [x.id, emptyObservation()])),
    safety: Object.fromEntries(guardNames.map(k => [k, false])),
  };
}
function validateObservation(row, id, reasons) {
  keys(row, Object.keys(emptyObservation()), id);
  assert.ok(statuses.has(row.status), "Invalid status for " + id);
  if (row.status === "NOT_RUN") {
    assert.deepEqual(row, emptyObservation(), "NOT_RUN cannot contain invented proof for " + id);
  } else if (row.status === "BLOCKED") {
    assert.ok(blockers.has(row.blockerCode), "Invalid blocker for " + id);
    assert.equal(row.evidenceRef, null, "Blocked rows cannot claim observation evidence: " + id);
    assert.equal(row.defectRef, null, "Blocked rows cannot claim a test defect: " + id);
    assert.equal(row.operatorRef, null, "Blocked rows cannot claim a test operator: " + id);
    assert.equal(row.witnessRef, null, "Blocked rows cannot claim a test witness: " + id);
    assert.equal(row.observedAt, null, "Blocked rows cannot claim an observation time: " + id);
  } else {
    assert.match(row.operatorRef || "", personPattern, "Opaque operator reference required for " + id);
    assert.match(row.witnessRef || "", personPattern, "Opaque witness reference required for " + id);
    assert.notEqual(row.operatorRef, row.witnessRef, "Operator cannot witness their own outcome: " + id);
    assert.match(row.evidenceRef || "", evidencePattern, "Private UAT evidence reference required for " + id);
    assert.match(row.observedAt || "", observedAtPattern,
      "Exact UTC observation timestamp required for " + id);
    assert.ok(Number.isFinite(Date.parse(row.observedAt)), "Invalid observation date for " + id);
    // Impossible future timestamps do not constitute completed past observations.
    assert.ok(Date.parse(row.observedAt) <= Date.now() + 5 * 60_000,
      "Future observation timestamps are not valid for " + id);
    assert.equal(row.blockerCode, null, "Observed row cannot be marked blocked: " + id);
    if (row.status === "NEEDS_FIX") assert.match(row.defectRef || "", defectPattern, "Defect reference required for " + id);
    else assert.equal(row.defectRef, null, "PASS cannot contain unresolved defect: " + id);
  }
  if (row.status !== "PASS") reasons.push(id + " is " + row.status);
}
export function assess(manifest) {
  keys(manifest, ["version", "type", "sourceSha", "runtime", "stages", "checks", "safety"], "manifest");
  assert.equal(manifest.version, 2, "Unsupported manifest version; archive v1 privately and create a new NOT_RUN v2 session");
  assert.equal(manifest.type, "fictional-independent-journey-observations-unverified");
  assert.match(manifest.sourceSha, shaPattern, "Invalid source SHA");
  keys(manifest.runtime, ["deployedSha", ...runtimeRefs], "runtime");
  keys(manifest.stages, STAGES.map(s => s.id), "stages");
  keys(manifest.checks, CHECKS.map(c => c.id), "checks");
  keys(manifest.safety, guardNames, "safety");
  for (const k of guardNames) assert.equal(manifest.safety[k], false, "Unsafe external claim: " + k);
  const reasons = [];
  if (manifest.runtime.deployedSha === null) reasons.push("Deployed application SHA not independently verified");
  else {
    assert.match(manifest.runtime.deployedSha, shaPattern, "Invalid deployed SHA");
    if (manifest.runtime.deployedSha !== manifest.sourceSha) reasons.push("Deployed SHA differs from source SHA");
  }
  for (const k of runtimeRefs) {
    const val = manifest.runtime[k];
    if (val === null) reasons.push("Missing privately retained runtime evidence: " + k);
    else assert.match(val, evidencePattern, "Invalid private runtime evidence reference: " + k);
  }
  for (const { id } of STAGES) validateObservation(manifest.stages[id], id, reasons);
  for (const { id } of CHECKS) validateObservation(manifest.checks[id], id, reasons);
  const passingStages = STAGES.filter(x => manifest.stages[x.id].status === "PASS");
  if (passingStages.length === STAGES.length) {
    const actors = new Set(passingStages.map(x => manifest.stages[x.id].operatorRef));
    const witnesses = new Set(passingStages.map(x => manifest.stages[x.id].witnessRef));
    for (const person of witnesses) if (actors.has(person)) reasons.push("Witness also operated a journey stage");
    for (const role of new Set(STAGES.map(x => x.role))) {
      const sameRole = STAGES.filter(x => x.role === role).map(x => manifest.stages[x.id].operatorRef);
      if (new Set(sameRole).size !== 1) reasons.push("Different operators claimed the same " + role + " persona");
    }
    const actor = role => manifest.stages[STAGES.find(x => x.role === role).id].operatorRef;
    // Six real operator personas must remain distinct even when test accounts differ.
    // Opaque aliases alone are not proof: the external witness must confirm identity.
    const roles = [...new Set(STAGES.map(x => x.role))];
    for (let i = 0; i < roles.length; i += 1) {
      for (let j = i + 1; j < roles.length; j += 1) {
        const a = roles[i], b = roles[j];
        if (actor(a) === actor(b)) reasons.push(a + " and " + b + " must be different people");
      }
    }
    for (const c of CHECKS) {
      const row = manifest.checks[c.id];
      if (row.status === "PASS" && actors.has(row.witnessRef)) reasons.push(c.id + " witness also operated the journey");
      if (row.status === "PASS" && !actors.has(row.operatorRef)) reasons.push(c.id + " operator is not a recorded journey operator");
    }
    for (const [id, role] of [["OWNER_PHYSICAL_MOBILE", "OWNER"], ["OWNER_EMPLOYER_SWITCH", "OWNER"],
      ["PAYROLL_PHYSICAL_MOBILE", "PAYROLL"], ["PAYROLL_EMPLOYER_SWITCH", "PAYROLL"]]) {
      const row = manifest.checks[id];
      if (row.status === "PASS" && row.operatorRef !== actor(role)) reasons.push(id + " operator is not the recorded " + role);
    }
  }
  const all = [...STAGES.map(x => manifest.stages[x.id]), ...CHECKS.map(x => manifest.checks[x.id])];
  const proofRefs = [...runtimeRefs.map(k => manifest.runtime[k]), ...all.map(x => x.evidenceRef)].filter(Boolean);
  if (new Set(proofRefs).size !== proofRefs.length)
    reasons.push("Repeated private evidence reference: each observation and runtime checkpoint needs distinct proof");
  const counts = Object.fromEntries([...statuses].map(s => [s, all.filter(x => x.status === s).length]));
  // Even a complete, human-populated local record is only ready for external evidence examination.
  return { completeForPrivateReview: reasons.length === 0, reasons, counts,
    independentHumanAccepted: false, realEmployerReconciled: false,
    productionAuthorized: false, certifiedDevice: false, agencyAccepted: false };
}
export function renderSummary(manifest) {
  const result = assess(manifest);
  const rows = [
    "# PayrollPH #853 — offline independent-witness RECEIPT CHECK (UNVERIFIED)", "",
    "Source SHA: " + manifest.sourceSha,
    "Deployed SHA: " + (manifest.runtime.deployedSha || "NOT_VERIFIED"),
    "Evidence completeness for external private review: " + (result.completeForPrivateReview ? "COMPLETE (UNVERIFIED)" : "INCOMPLETE"),
    "Independent human acceptance: NOT ESTABLISHED",
    "#691 WFM-01..14 independent acceptance: NOT ESTABLISHED",
    "#579 employer payroll reconciliation: NOT ESTABLISHED",
    "Physical biometric/offline device certification: NOT ESTABLISHED",
    "Official agency/bank acceptance: NOT ESTABLISHED",
    "Production/payout authorization: NONE — PILOT NO-GO", "",
    "| Item | Operator-reported observation | Private proof reference | Defect / blocker |",
    "| --- | --- | --- | --- |",
  ];
  for (const [id, row] of [...STAGES.map(s => [s.id, manifest.stages[s.id]]),
    ...CHECKS.map(c => [c.id, manifest.checks[c.id]])]) {
    rows.push(`| ${id} | ${row.status} | ${row.evidenceRef || "-"} | ${row.defectRef || row.blockerCode || "-"} |`);
  }
  rows.push("", "Incomplete checks: " + result.reasons.length,
    "This utility checks locally entered references and role consistency, NOT whether people, devices, or evidence are genuine. Keep actual names, expected/observed details, signatures, raw payroll/PII and proof privately. Never treat its results as UAT certification.", "");
  return rows.join("\n");
}
function repoSha() { return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
function clean() { return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === ""; }
function privateWrite(file, content, exclusive = false) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode: 0o600, flag: exclusive ? "wx" : "w" });
}
async function main() {
  const [cmd, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0, "No free-text arguments; store observations privately");
  if (cmd === "init") {
    assert.ok(clean(), "Initialize from a clean committed checkout only");
    privateWrite(inputPath, JSON.stringify(createTemplate(repoSha()), null, 2) + "\n", true);
    console.log("Created NOT_RUN-only private template: " + inputPath);
  } else if (cmd === "check" || cmd === "report") {
    assert.ok(clean(), "Do not evaluate a dirty source checkout");
    const data = JSON.parse(readFileSync(inputPath, "utf8"));
    assert.equal(data.sourceSha, repoSha(), "Source SHA changed; archive prior evidence and re-test");
    const evaluated = assess(data);
    if (cmd === "report") privateWrite(reportPath, renderSummary(data));
    console.log(`Private receipt completeness: ${evaluated.completeForPrivateReview ? "COMPLETE (UNVERIFIED)" : "INCOMPLETE"}`);
    console.log("Counts: " + JSON.stringify(evaluated.counts));
    console.log("Missing/invalid observation count: " + evaluated.reasons.length);
    console.log("Independent signoff / real employer reconciliation / pilot authorization: NOT ESTABLISHED");
    if (!evaluated.completeForPrivateReview) process.exitCode = 2;
  } else {
    console.log("Usage: node scripts/qa/independent-journey-853.mjs init|check|report");
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e => { console.error(e?.message || "Private record invalid"); process.exitCode = 1; });
