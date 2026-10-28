import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ENDPOINT, METHODS, requireDisposableAvailability, assertNoPrivateMarkers,
  projectOwnRules, assertOwnAvailability, assertCreated,
  assertRemovedFuture, assertPrivateDenial, assertUnchanged,
} from "../scripts/qa/tenant-self-availability-contract.mjs";

const today = "2026-10-28";
const safe = Object.freeze({
  GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
  DEMO_MODE: "false", TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  TENANT_AVAILABILITY_MODE: "fictional-only",
  WFM_EMPLOYEE_AVAILABILITY_ENABLED: "true",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  SECURITY_SMOKE_URL: "http://127.0.0.1:3000",
  WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_BILLING_ENABLED: "false", HCM_OVERPAYMENT_PREVIEW_ENABLED: "false",
  PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "false",
  WORKER_TOKEN: "ci-worker-token-disposable-availability",
});
const actor = {
  marker: "TTBL-ATTA-FICTIONAL", org: { id: 11 },
  worker: { id: 21, employeeNo: "OWN-21" },
  self: { userId: 31, name: "Fictional owner employee", cookie: "fake-A" },
};
const other = {
  marker: "TTBL-VICTIM-FICTIONAL", org: { id: 14 },
  worker: { id: 24, employeeNo: "VICTIM-24" },
  self: { userId: 34, name: "Fictional victim employee", cookie: "fake-victim" },
};
const ownRule = {
  id: 101, organizationId: 11, employeeId: 21,
  weekday: 1, startTime: "09:00", endTime: "11:00",
  availabilityType: "unavailable", effectiveFrom: "2026-11-09",
  effectiveUntil: "2026-12-17",
  notes: actor.marker + " private weekly rule",
  createdBy: actor.self.name, createdByUserId: actor.self.userId,
};
const peerRule = {
  id: 102, organizationId: 11, employeeId: 22,
  weekday: 4, startTime: "16:00", endTime: "18:00",
  availabilityType: "preferred", effectiveFrom: "2026-11-09",
  effectiveUntil: "2026-12-17",
  notes: actor.marker + " PEER PRIVATE",
  createdBy: "Fictional peer", createdByUserId: 35,
};
const draft = {
  action: "create", weekday: 5,
  startTime: "09:00", endTime: "12:00",
  availabilityType: "preferred",
  effectiveFrom: "2026-11-04", effectiveUntil: null,
  notes: actor.marker + " owned new availability",
};
const createdRule = {
  id: 103, organizationId: 11, employeeId: 21,
  weekday: draft.weekday, startTime: draft.startTime,
  endTime: draft.endTime, availabilityType: draft.availabilityType,
  effectiveFrom: draft.effectiveFrom, effectiveUntil: draft.effectiveUntil,
  notes: draft.notes, createdBy: actor.self.name,
  createdByUserId: actor.self.userId,
};
const createdAudit = {
  id: 201, organizationId: 11, actor: actor.self.name,
  action: "Employee WFM availability preference created",
  resource: "OWN-21 · rule #103",
  metadata: {
    employeeId: 21, ruleId: 103, weekday: draft.weekday,
    availabilityType: draft.availabilityType,
    effectiveFrom: draft.effectiveFrom, effectiveUntil: draft.effectiveUntil,
    timeWindow: [draft.startTime, draft.endTime],
    source: "self-service", publishedRosterChanged: false,
    payrollMutationPerformed: false,
  },
};
const removedAudit = {
  id: 202, organizationId: 11, actor: actor.self.name,
  action: "Employee WFM availability preference withdrawn",
  resource: "OWN-21 · rule #103",
  metadata: {
    employeeId: 21, ruleId: 103, disposition: "delete_future_rule",
    weekday: draft.weekday, availabilityType: draft.availabilityType,
    effectiveFrom: draft.effectiveFrom, priorEffectiveUntil: null,
    publishedRosterChanged: false, payrollMutationPerformed: false,
  },
};
function before() {
  return {
    rules: structuredClone([ownRule, peerRule]),
    employees: [{ id: 21 }, { id: 22 }],
    memberships: [{ id: 40, userId: 31 }, { id: 41, userId: 35 }],
    payroll: [{ id: 51, amount: "100.00" }],
    assignments: [{ id: 61 }],
    punches: [{ id: 71 }],
    leaves: [{ id: 81 }],
    audit: [],
  };
}
const clone = value => structuredClone(value);
const headers = () => new Headers({
  "cache-control": "private, no-store", vary: "Cookie",
});
function response(status, json, h = headers()) {
  return { status, json, text: JSON.stringify(json), headers: h };
}
function ownRead(rows = before().rules) {
  return response(200, {
    rules: projectOwnRules(rows, actor, today),
    partial: false, source: "employee_availability_rules",
    note: "Preferences are not published shifts or approved leave; the schedule and payroll remain unchanged.",
  });
}
const createReply = () => response(201, {
  id: 103, saved: true,
  publishedRosterChanged: false, payrollMutationPerformed: false,
});
const removeReply = () => response(200, {
  removed: true, disposition: "delete_future_rule",
  publishedRosterChanged: false, payrollMutationPerformed: false,
});
function created() {
  const value = before();
  value.rules.push(clone(createdRule));
  value.audit.push(clone(createdAudit));
  return value;
}
function removed() {
  const value = created();
  value.rules = value.rules.filter(r => r.id !== 103);
  value.audit.push(clone(removedAudit));
  return value;
}

test("disposable guard refuses non-Actions, provider keys, workers and hosted targets", () => {
  assert.doesNotThrow(() => requireDisposableAvailability(safe));
  for (const overrides of [
    { GITHUB_ACTIONS: "false" }, { CI: "false" },
    { NODE_ENV: "development" }, { DEMO_MODE: "true" },
    { TENANT_AVAILABILITY_MODE: "" }, { TENANT_SECOND_PASS_MODE: "off" },
    { WFM_EMPLOYEE_AVAILABILITY_ENABLED: "false" },
    { DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/payroll" },
    { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db?sslmode=require" },
    { DATABASE_URL: "postgresql://postgres:wrong@127.0.0.1:5432/app_db" },
    { SECURITY_SMOKE_URL: "https://example.com" },
    { SECURITY_SMOKE_URL: "http://localhost:3000" },
    { SECURITY_SMOKE_URL: "http://127.0.0.1:3000/other" },
    { WORKER_ENABLED: "true" }, { CENTRAL_SCHEDULER_ENABLED: "true" },
    { PAYMONGO_DISBURSEMENTS_ENABLED: "true" },
    { XENDIT_PAYOUTS_ENABLED: "true" }, { XENDIT_BILLING_ENABLED: "true" },
    { HCM_OVERPAYMENT_PREVIEW_ENABLED: "true" },
    { PAYROLL_OVERPAYMENT_REVIEW_ENABLED: "true" },
    { WORKER_TOKEN: "prod-token" }, { PAYMONGO_SECRET_KEY: "secret" },
    { XENDIT_SECRET_KEY: "secret" }, { XENDIT_PAYOUT_SECRET_KEY: "secret" },
    { RESEND_API_KEY: "secret" }, { POSTMARK_SERVER_TOKEN: "secret" },
    { SMTP_URL: "smtp://live" }, { STRIPE_SECRET_KEY: "secret" },
    { NEON_API_KEY: "secret" },
  ]) assert.throws(
    () => requireDisposableAvailability({ ...safe, ...overrides }),
    /AVAILABILITY_TENANT_REFUSED/, JSON.stringify(overrides));
});

test("supplemental proof awards no new credit and preserves previously promoted exact-source evidence", () => {
  assert.deepEqual(METHODS, ["GET self/availability", "POST self/availability"]);
  assert.equal(ENDPOINT, "/api/self/availability");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const route = manifest.allApiRouteFiles["src/app/api/self/availability/route.ts"];
  assert.equal(route.route, "self/availability");
  const canonical = "scripts/qa/tenant-self-availability-http.mjs";
  for (const method of ["GET", "POST"]) {
    const row = route.methods.find(m => m.name === method);
    assert.ok(row && ["GAP", "COVERED"].includes(row.status),
      "must not change the method classification or invent a third state");
    if (row.status === "GAP") {
      assert.equal(row.testedBy, null, "uncredited historical branches stay GAP");
      continue;
    }
    // Newer main independently promoted these methods from PR #1455.
    // Their coverage MUST remain linked to the untouched, digest-pinned
    // original proof, never to this new supplemental test.
    assert.equal(row.testedBy?.file, canonical);
    assert.equal(row.testedBy?.prNumber, 1455);
    assert.equal(row.testedBy?.workflowRunId, 40444843870);
    for (const pin of ["ownPositiveLine", "foreignDenialLine", "unchangedDbLine", "forgedSelectorLine"]) {
      assert.ok(Number.isSafeInteger(row.testedBy?.[pin]) && row.testedBy[pin] > 0,
        method + " requires all four source evidence pins");
    }
    const pins = JSON.parse(readFileSync("scripts/qa/tenant-gap-promotion-pins.json", "utf8"));
    const digest = createHash("sha256").update(readFileSync(canonical)).digest("hex");
    assert.equal(digest, pins.hashes[canonical],
      "canonical #1455 evidence must be byte-for-byte unchanged");
  }
});

test("real own availability GET must be nonempty, complete, private and worker-scoped", () => {
  const initial = before().rules;
  assert.deepEqual(assertOwnAvailability(ownRead(initial), actor, initial, today,
    [other.marker, actor.marker + " PEER PRIVATE"]),
    [projectOwnRules(initial, actor, today)[0]]);
  assert.equal(projectOwnRules(initial, actor, today)[0].id, ownRule.id);
  assert.throws(() => assertOwnAvailability(ownRead([]), actor, [], today),
    /persisted own SQL rules/);
  const forged = response(200, {
    ...ownRead(initial).json,
    rules: [projectOwnRules([{
      ...ownRule, id: 999, organizationId: other.org.id,
      employeeId: other.worker.id, notes: other.marker + " PRIVATE",
    }], other, today)[0]],
  });
  assert.throws(() => assertOwnAvailability(forged, actor, initial, today));
  for (const mutate of [
    r => { r.json.rules.push(projectOwnRules(initial, actor, today)[0]); },
    r => { r.json.rules[0].id = 777; },
    r => { r.json.rules[0].notes = "different worker"; },
    r => { r.json.rules[0].weekday = 6; },
    r => { r.json.rules[0].startTime = "00:00"; },
    r => { r.json.partial = true; },
    r => { r.json.source = "generated-roster"; },
    r => { r.json.payroll = "leaked"; },
    r => { r.headers = new Headers({ "cache-control": "public,max-age=600" }); },
  ]) {
    const r = ownRead(initial);
    mutate(r);
    r.text = JSON.stringify(r.json);
    assert.throws(() => assertOwnAvailability(r, actor, initial, today));
  }
  assert.throws(() => assertNoPrivateMarkers({
    text: "leak " + other.marker,
  }, [other.marker]));
});

test("own create accepts only exact INSERT row and one matching actor-bound audit", () => {
  assert.doesNotThrow(() => assertCreated(before(), created(), actor, createReply(), draft));
  const prior = before(), after = created();
  for (const mutate of [
    a => { a.rules.pop(); },
    a => { a.rules.push({ id: 104 }); },
    a => { a.rules.at(-1).organizationId = other.org.id; },
    a => { a.rules.at(-1).employeeId = 22; },
    a => { a.rules.at(-1).createdByUserId = 99; },
    a => { a.rules.at(-1).weekday = 0; },
    a => { a.rules[0].notes = "mutated old availability"; },
    a => { a.payroll.push({ id: 52 }); },
    a => { a.assignments.pop(); },
    a => { a.punches.push({ id: 72 }); },
    a => { a.leaves.pop(); },
    a => { a.memberships.push({ id: 42 }); },
    a => { a.audit.pop(); },
    a => { a.audit.push(clone(createdAudit)); },
    a => { a.audit.at(-1).actor = other.self.name; },
    a => { a.audit.at(-1).metadata.employeeId = other.worker.id; },
    a => { a.audit.at(-1).metadata.payrollMutationPerformed = true; },
  ]) {
    const changed = clone(after); mutate(changed);
    assert.throws(() => assertCreated(prior, changed, actor, createReply(), draft));
  }
  for (const mutate of [
    r => { r.json.id = other.worker.id; },
    r => { r.json.saved = false; },
    r => { r.json.payrollMutationPerformed = true; },
    r => { r.status = 200; },
    r => { r.json.private = true; },
  ]) {
    const r = createReply(); mutate(r); r.text = JSON.stringify(r.json);
    assert.throws(() => assertCreated(prior, after, actor, r, draft));
  }
});

test("own future removal must delete only the owned rule and append exactly one audit", () => {
  assert.doesNotThrow(() =>
    assertRemovedFuture(created(), removed(), actor, removeReply(), createdRule));
  for (const mutate of [
    x => { x.rules.push(clone(createdRule)); },
    x => { x.rules.pop(); },
    x => { x.rules[0].employeeId = 222; },
    x => { x.audit.pop(); },
    x => { x.audit.at(-1).metadata.ruleId = 123; },
    x => { x.payroll.push({ id: 999 }); },
    x => { x.leaves = []; },
  ]) {
    const changed = removed(); mutate(changed);
    assert.throws(() => assertRemovedFuture(
      created(), changed, actor, removeReply(), createdRule));
  }
  const r = removeReply();
  r.json.disposition = "close_current_rule";
  assert.throws(() => assertRemovedFuture(
    created(), removed(), actor, r, createdRule));
});

test("all private 400, 401, 403 and 409 denials must contain no source content", () => {
  for (const status of [400, 401, 403, 409]) {
    const r = response(status, { error: "Resource is unavailable." });
    assert.doesNotThrow(() => assertPrivateDenial(r, status, [other.marker]));
    assert.throws(() => assertPrivateDenial(r, 201, [other.marker]));
    const leaked = response(status, { error: "Not found",
      rules: [{ notes: other.marker }] });
    assert.throws(() => assertPrivateDenial(leaked, status, [other.marker]));
    assert.throws(() => assertPrivateDenial({
      ...r, text: other.marker + " PRIVATE",
    }, status, [other.marker]));
  }
  const b = before();
  assert.doesNotThrow(() => assertUnchanged(b, clone(b), "victim"));
  assert.throws(() => assertUnchanged(b, created(), "victim"));
});

test("real HTTP proof extends existing worker/peer test without changing shared runner", () => {
  const src = readFileSync("scripts/qa/tenant-self-availability-recovery-http.mjs", "utf8");
  const originalGuard = src.indexOf("requireDisposableSelfAvailability();");
  const extraGuard = src.indexOf("requireDisposableAvailability();");
  const dbImport = src.indexOf('import("../../src/db/index.ts")');
  const peerSeed = src.indexOf("peers.push({ employee: peer, rule: peerRule");
  const victimSeed = src.indexOf('const victim = await seedEmployeeEmployer("VICTIM")');
  assert.ok(peerSeed >= 0 && victimSeed > peerSeed,
    "real higher-ID victim must be inserted after BOTH attacker peers");
  assert.match(src, /victim\.worker\.id > peers\[index\]\.employee\.id/);
  assert.match(src, /victim\.rule\.id > peers\[index\]\.rule\.id/);
  assert.ok(originalGuard >= 0 && extraGuard > originalGuard && dbImport > extraGuard,
    "strict disposable guard must run before application imports");
  for (const code of [
    "seedEmployeeEmployer(\"ATTA\"", "seedEmployeeEmployer(\"ATTB\"",
    "seedEmployeeEmployer(\"VICTIM\"", "sourceSnapshot",
    "assertOwnAvailability(", "assertCreated(", "assertRemovedFuture(",
    "deniedSource(", "forgedCookies", "peer.cookie",
    "assertPrivateDenial(", "assertUnchanged(",
    "publishedRosterChanged", "payrollMutationPerformed",
  ]) assert.ok(src.includes(code), "missing source-grounded HTTP evidence: " + code);
  const workflow = readFileSync(".github/workflows/tenant-self-availability-http.yml", "utf8");
  for (const code of [
    "image: postgres:16", "npm run db:push", "apply-isolated-baseline.mjs",
    "npm run build", "TENANT_AVAILABILITY_MODE=fictional-only",
    "WORKER_ENABLED=false", "XENDIT_BILLING_ENABLED=false",
    "tests/tenant-self-availability-contract.test.mjs",
    "node --import tsx scripts/qa/tenant-self-availability-recovery-http.mjs",
  ]) assert.ok(workflow.includes(code), "missing CI proof: " + code);
});
