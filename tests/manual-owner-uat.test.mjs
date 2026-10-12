import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SCENARIOS, STATES, createSession, recordOutcome, summarize, renderSummary,
  requireCleanSource, archiveLocalSession,
} from "../scripts/qa/manual-owner-uat.mjs";

const sha = "a".repeat(40);
const evidence = "UAT-FICTIONAL001";

test("canonical WFM 14 plus connected employer journey 9 start all NOT_RUN", () => {
  const session = createSession(sha, true, "2026-10-12T00:00:00Z");
  assert.equal(SCENARIOS.length, 23);
  assert.equal(SCENARIOS.filter(s => s.family === "WFM").length, 14);
  assert.equal(SCENARIOS.filter(s => s.family === "JOURNEY").length, 9);
  assert.deepEqual(STATES, ["NOT_RUN", "PASS", "NEEDS_FIX", "BLOCKED"]);
  assert.deepEqual(summarize(session).counts, {
    NOT_RUN: 23, PASS: 0, NEEDS_FIX: 0, BLOCKED: 0,
  });
  assert.equal(session.realEmployerReconciled, false);
  assert.equal(session.independentHumanAccepted, false);
  assert.equal(session.productionAuthorized, false);
});

test("explicit sanitized evidence is needed for each self-reported PASS", () => {
  const session = createSession(sha);
  assert.throws(() => recordOutcome(session, "WFM-01", "PASS"), /opaque/);
  assert.throws(() => recordOutcome(session, "WFM-01", "PASS", "employee@example.com"));
  assert.throws(() => recordOutcome(session, "WFM-17", "PASS", evidence));
  assert.throws(() => recordOutcome(session, "WFM-01", "AUTO_PASS", evidence));
  const updated = recordOutcome(session, "WFM-01", "PASS", evidence);
  assert.equal(updated.outcomes["WFM-01"].status, "PASS");
  assert.equal(updated.independentHumanAccepted, false);
  assert.equal(session.outcomes["WFM-01"].status, "NOT_RUN");
});

test("WFM-14 physical device cannot pass without explicit local witness declaration", () => {
  const session = createSession(sha);
  assert.throws(() => recordOutcome(session, "WFM-14", "PASS", evidence), /Physical/);
  const simulated = recordOutcome(session, "WFM-14", "BLOCKED", "DEVICE");
  assert.equal(simulated.outcomes["WFM-14"].status, "BLOCKED");
  const witnessed = recordOutcome(session, "WFM-14", "PASS", evidence, "REAL_DEVICE");
  assert.equal(witnessed.outcomes["WFM-14"].physicalDeviceWitnessed, true);
  assert.equal(witnessed.hardwareCertified, false);
});

test("NEEDS_FIX requires defect reference, BLOCKED requires coded reason", () => {
  const session = createSession(sha);
  assert.throws(() => recordOutcome(session, "WFM-05", "NEEDS_FIX", evidence));
  assert.throws(() => recordOutcome(session, "WFM-05", "BLOCKED", "UNSAFE_PII"));
  const bad = recordOutcome(session, "WFM-05", "NEEDS_FIX", evidence, "BUG-SYNTHETIC12");
  const blocked = recordOutcome(bad, "WFM-06", "BLOCKED", "ROLE");
  assert.equal(blocked.outcomes["WFM-05"].defectRef, "BUG-SYNTHETIC12");
  assert.equal(blocked.outcomes["WFM-06"].blockerCode, "ROLE");
});

test("public summary preserves counts and all external gates remain NOT established", () => {
  const base = createSession(sha);
  const updated = recordOutcome(base, "JOURNEY-01", "PASS", evidence);
  const summary = renderSummary(updated);
  assert.match(summary, /PASS=1, NEEDS_FIX=0, BLOCKED=0, NOT_RUN=22/);
  assert.match(summary, /Actual employer one-period centavo reconciliation: NOT RUN/);
  assert.match(summary, /Independent human audit\/QA\/payroll\/DBA acceptance: NOT ESTABLISHED/);
  assert.doesNotMatch(summary, /accepted government submission|certified by reviewer/i);
  assert.equal(updated.moneyMoved, false);
  assert.equal(updated.agencyAccepted, false);
  assert.equal(updated.productionAuthorized, false);
});

test("a false complete P0 claim cannot be derived from missing or blocked scenarios", () => {
  let s = createSession(sha);
  for (const row of SCENARIOS.filter(x => x.priority === "P0")) {
    if (row.id !== "WFM-10") s = recordOutcome(s, row.id, "PASS", evidence);
  }
  assert.equal(summarize(s).p0SelfTested, false);
  assert.equal(s.outcomes["WFM-10"].status, "NOT_RUN");
  assert.equal(s.independentHumanAccepted, false);
});

test("source-bound UAT rejects dirty, stale, and initially dirty checkouts", () => {
 const clean = createSession(sha, false);
 assert.doesNotThrow(() => requireCleanSource(clean, sha, false));
 assert.throws(() => requireCleanSource(clean, "b".repeat(40), false), /Checkout changed/);
 assert.throws(() => requireCleanSource(clean, sha, true), /Uncommitted checkout/);
 assert.throws(() => requireCleanSource(createSession(sha, true), sha, false), /dirty checkout/);
});

test("archive preserves old SHA-bound outcomes and allows a new clean session", () => {
 const root = mkdtempSync(join(tmpdir(), "payrollph-uat-archive-"));
 const active = join(root, "session.json");
 const summary = join(root, "summary.md");
 const archivedId = "00000000-0000-4000-8000-000000000001";
 try {
   const prior = recordOutcome(createSession(sha), "WFM-01", "PASS", evidence);
   writeFileSync(active, JSON.stringify(prior));
   writeFileSync(summary, renderSummary(prior));
   const archive = archiveLocalSession(active, summary, archivedId);
   assert.ok(!existsSync(summary));
   const stored = JSON.parse(readFileSync(join(archive, "session.json"), "utf8"));
   assert.equal(stored.sourceSha, sha);
   assert.equal(stored.outcomes["WFM-01"].status, "PASS");
   assert.match(readFileSync(join(archive, "summary.md"), "utf8"), /SELF-REPORTED/);
   assert.throws(() => archiveLocalSession(active, summary, archivedId));
   const next = createSession("b".repeat(40), false);
   writeFileSync(active, JSON.stringify(next), { flag: "wx", mode: 0o600 });
   assert.equal(JSON.parse(readFileSync(active, "utf8")).outcomes["WFM-01"].status, "NOT_RUN");
   assert.equal(stored.outcomes["WFM-01"].status, "PASS");
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test("archive refuses corrupt evidence without moving or deleting the active file", () => {
 const root = mkdtempSync(join(tmpdir(), "payrollph-uat-invalid-"));
 const active = join(root, "session.json");
 const summary = join(root, "summary.md");
 try {
   writeFileSync(active, JSON.stringify({version:1,sourceSha:sha,outcomes:{"WFM-01":{status:"PASS"}}}));
   assert.throws(() => archiveLocalSession(active, summary), /Incomplete or corrupted/);
   assert.equal(existsSync(active), true);
 } finally { rmSync(root, { recursive: true, force: true }); }
});

test("tampered local UAT source SHA cannot enter reports or archive paths", () => {
  const s = createSession(sha);
  for (const bad of ["../../other", "a".repeat(39), "b".repeat(41), "A".repeat(40), ""]) {
    assert.throws(() => summarize({ ...s, sourceSha: bad }), /Invalid stored source SHA/);
    assert.throws(() => renderSummary({ ...s, sourceSha: bad }), /Invalid stored source SHA/);
  }
});

test("self-reported evidence cannot assert any independent release or certification gate", () => {
  const s = createSession(sha);
  for (const key of ["independentHumanAccepted", "realEmployerReconciled", "hardwareCertified",
    "agencyAccepted", "moneyMoved", "productionAuthorized"]) {
    assert.throws(() => summarize({ ...s, [key]: true }), /Local UAT cannot assert external acceptance/);
  }
});
