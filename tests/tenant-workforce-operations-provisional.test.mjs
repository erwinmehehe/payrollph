import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const defaultWrite = "scripts/qa/tenant-table-rows/write/workforce-operations.mjs";
const rosterRead = "scripts/qa/tenant-table-rows/read/workforce-rules.mjs";
const cases = [
  { key: "GET workforce/roster-rules", rowFile: rosterRead, rowLine: 5,
    run: "121324440304", suite: "scripts/qa/tenant-table-http.mjs", own: 251, foreign: 260, unchanged: 280 },
  { key: "POST workforce/roster-rules", rowFile: defaultWrite, rowLine: 103,
    run: "121324440304", suite: "scripts/qa/tenant-write-table-http.mjs", own: 112, foreign: 125, unchanged: 149 },
  { key: "POST workforce/schedule-guardrails", rowFile: defaultWrite, rowLine: 92,
    run: "121324440138", suite: "scripts/qa/tenant-write-table-http.mjs", own: 112, foreign: 125, unchanged: 149 },
];

const method = (key) => {
  const [verb, route] = key.split(" ");
  return manifest.allApiRouteFiles["src/app/api/" + route + "/route.ts"]?.methods.find(m => m.name === verb);
};

test("three provisional Workforce policy credits name executable, source-pinned positive/negative HTTP evidence", () => {
  for (const item of cases) {
    const entry = method(item.key);
    assert.equal(entry?.status, "COVERED", item.key);
    assert.match(entry.reason, /Provisional, narrow tenant isolation proof only \(no production certification\)/);
    assert.match(entry.reason, /independent security review/);
    const proof = entry.testedBy;
    assert.equal(proof?.file, item.suite, item.key);
    assert.equal(proof.rowFile, item.rowFile);
    assert.equal(proof.rowLine, item.rowLine);
    assert.equal(proof.ownPositiveLine, item.own);
    assert.equal(proof.foreignDenialLine, item.foreign);
    assert.equal(proof.unchangedDbLine, item.unchanged);
    assert.equal(proof.line, item.own);
    assert.equal(proof.reviewedHead, "f6d115cfa53b76ea8e7d0c57cb2d9cadc63dff62");
    assert.match(proof.passedJob, new RegExp(item.run + "$"));
    const line = readFileSync(item.rowFile, "utf8").split("\n")[item.rowLine - 1];
    assert.ok(line?.trimStart().startsWith("{ key: " + JSON.stringify(item.key) + ","),
      item.key + " has moved; re-pin the fixture");
  }
});

test("newly credited policy writes cannot imply activated enforcement or payroll decisions", () => {
  const write = readFileSync(defaultWrite, "utf8");
  const read = readFileSync(rosterRead, "utf8");
  assert.match(write, /key: "POST workforce\/schedule-guardrails"/);
  assert.match(write, /key: "POST workforce\/roster-rules"/);
  assert.match(write, /action: "update_policy"/);
  assert.match(write, /active: false/);
  assert.match(write, /enforcementMode: "advisory"/);
  assert.match(write, /auditBusinessSnapshot/);
  assert.match(write, /assert\.deepEqual\(audit\.metadata\.after, policy\)/);
  assert.match(read, /key: "GET workforce\/roster-rules"/);
  assert.match(read, /flags: \["WFM_ROSTER_SCALE_RULES_ENABLED"\]/);
  assert.match(read, /configured, true/);
  const env = readFileSync("scripts/qa/tenant-table-env.mjs", "utf8");
  assert.match(env, /"flagged-reads": \{[\s\S]*?WFM_ROSTER_SCALE_RULES_ENABLED: "true"/);
  assert.match(env, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
  assert.match(env, /XENDIT_PAYOUTS_ENABLED: "false"/);
  const docs = readFileSync("docs/qa/tenant-workforce-operations-family.md", "utf8");
  assert.match(docs, /Five Workforce mutation routes remain GAP/);
  assert.match(docs, /NOT ACCEPTED/);
});
