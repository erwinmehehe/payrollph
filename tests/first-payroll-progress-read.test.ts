import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFirstPayrollProgressRead } from "../src/lib/first-payroll-progress-read";
import { activeAsyncResult, createScopedRequestOwner, type ScopedAsyncResult } from "../src/lib/scoped-async-request";

const sample = {
  progress: {
    stepOwners: { company: "owner", time: "hr", approval: "checker" },
    completedSteps: {
      company: { byUserId: 11, at: "2026-10-19T09:00:00.000Z" },
      time: { byUserId: 12, at: "2026-10-19T09:10:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-15" },
    },
  },
};

test("saved first-payroll progress accepts empty and sourced completion evidence", () => {
  assert.equal(parseFirstPayrollProgressRead({ progress: null }), null);
  assert.deepEqual(parseFirstPayrollProgressRead(sample), sample.progress);
  assert.deepEqual(parseFirstPayrollProgressRead({
    progress: { stepOwners: {}, completedSteps: {} },
  }), { stepOwners: {}, completedSteps: {} });
});

test("malformed successful reads and incomplete completion records fail closed", () => {
  const cases: unknown[] = [
    null,
    {},
    { organizationId: 41 },
    { progress: undefined },
    { progress: {} },
    { progress: { stepOwners: [], completedSteps: {} } },
    { progress: { stepOwners: {}, completedSteps: null } },
    { progress: { stepOwners: { unknown: "owner" }, completedSteps: {} } },
    { progress: { stepOwners: { time: "payroll" }, completedSteps: {} } },
    { progress: { stepOwners: {}, completedSteps: { time: { byUserId: 12, at: "2026-10-19T09:10:00.000Z" } } } },
    { progress: { stepOwners: {}, completedSteps: { time: { byUserId: 0, at: "2026-10-19T09:10:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-15" } } } },
    { progress: { stepOwners: {}, completedSteps: { time: { byUserId: 12, at: "invalid", periodStart: "2026-10-01", periodEnd: "2026-10-15" } } } },
    { progress: { stepOwners: {}, completedSteps: { time: { byUserId: 12, at: "2026-10-19T09:10:00.000Z", periodStart: "2026-02-30", periodEnd: "2026-10-15" } } } },
    { progress: { stepOwners: {}, completedSteps: { company: { byUserId: 11, at: "2026-10-19T09:00:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-15" } } } },
  ];
  for (const value of cases) {
    assert.throws(() => parseFirstPayrollProgressRead(value), /could not be verified/, JSON.stringify(value));
  }
});

test("a late employer A response cannot mark employer B's first-payroll steps complete", async () => {
  const owner = createScopedRequestOwner<object>();
  const aKey = { employer: 41 };
  const bKey = { employer: 42 };
  let finishA!: (value: unknown) => void;
  const oldResponse = new Promise<unknown>(resolve => { finishA = resolve; });
  const commits: Array<ScopedAsyncResult<object, ReturnType<typeof parseFirstPayrollProgressRead>>> = [];
  owner.activate(aKey);
  const requestA = owner.run(aKey,
    async () => parseFirstPayrollProgressRead(await oldResponse),
    result => { commits.push({ key: aKey, ...result }); });
  owner.activate(bKey);
  assert.equal(activeAsyncResult(commits.at(-1) ?? null, bKey, true), null);
  const requestB = owner.run(bKey,
    async () => parseFirstPayrollProgressRead({ progress: null }),
    result => { commits.push({ key: bKey, ...result }); });
  await requestB;
  finishA(sample);
  await requestA;
  assert.equal(commits.length, 1, "the obsolete employer must never commit");
  assert.equal(commits[0].key, bKey);
  assert.deepEqual(activeAsyncResult(commits[0], bKey, true)?.data, null);
});

test("first-payroll UI scopes reads, fails closed and offers explicit retry without altering protected API", () => {
  const card = readFileSync("src/components/workspace/first-payroll-readiness.tsx", "utf8");
  const panel = readFileSync("src/components/workspace/first-payroll-inline-panel.tsx", "utf8");
  const api = readFileSync("src/app/api/first-payroll/progress/route.ts", "utf8");
  assert.match(card, /useScopedAsyncResource\(scopeKey,loadProgress/);
  assert.match(card, /parseFirstPayrollProgressRead\(await response\.json\(\)\)/);
  assert.match(card, /data\?\.user\?\.id/);
  assert.match(card, /data\?\.access\?\.role/);
  assert.match(card, /Checking saved review/);
  assert.match(card, /Review not verified/);
  assert.match(card, /Assignment not verified/);
  assert.match(card, /Retry saved progress/);
  assert.doesNotMatch(card, /setProgress\(/);
  assert.match(panel, /parseFirstPayrollProgressRead\(x\)/);
  assert.match(panel, /parseFirstPayrollProgressRead\(result\)/);
  assert.match(api, /assertMembership\(user\.id, organizationId\)/);
  assert.match(api, /return Response\.json\(\{progress:await readJourneyProgress\(organizationId\)\}\);/);
});
