import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseFirstPayrollProgressRead } from "../src/lib/first-payroll-progress-read";
import { activeAsyncResult, createScopedRequestOwner } from "../src/lib/scoped-async-request";

const sample = {
  organizationId: 41,
  progress: {
    stepOwners: { company: "owner", time: "hr", approval: "checker" },
    completedSteps: {
      company: { byUserId: 11, at: "2026-10-19T09:00:00.000Z" },
      time: { byUserId: 12, at: "2026-10-19T09:10:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-15" },
    },
  },
};

test("saved first-payroll progress accepts only scoped, sourced completion evidence", () => {
  assert.equal(parseFirstPayrollProgressRead({ organizationId: 41, progress: null }, 41), null);
  assert.deepEqual(parseFirstPayrollProgressRead(sample, 41), sample.progress);
  assert.deepEqual(parseFirstPayrollProgressRead({
    organizationId: 41, progress: { stepOwners: {}, completedSteps: {} },
  }, 41), { stepOwners: {}, completedSteps: {} });
});

test("wrong employer, malformed successful reads and incomplete records fail closed", () => {
  const cases: unknown[] = [
    null,
    {},
    { progress: sample.progress },
    { organizationId: 42, progress: sample.progress },
    { organizationId: "41", progress: sample.progress },
    { organizationId: 41 },
    { organizationId: 41, progress: {} },
    { organizationId: 41, progress: { stepOwners: [], completedSteps: {} } },
    { organizationId: 41, progress: { stepOwners: {}, completedSteps: null } },
    { organizationId: 41, progress: { stepOwners: { unknown: "owner" }, completedSteps: {} } },
    { organizationId: 41, progress: { stepOwners: { time: "payroll" }, completedSteps: {} } },
    { organizationId: 41, progress: { stepOwners: {}, completedSteps: { time: { byUserId: 12, at: "2026-10-19T09:10:00.000Z" } } } },
    { organizationId: 41, progress: { stepOwners: {}, completedSteps: { time: { byUserId: 0, at: "2026-10-19T09:10:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-15" } } } },
    { organizationId: 41, progress: { stepOwners: {}, completedSteps: { time: { byUserId: 12, at: "invalid", periodStart: "2026-10-01", periodEnd: "2026-10-15" } } } },
    { organizationId: 41, progress: { stepOwners: {}, completedSteps: { time: { byUserId: 12, at: "2026-10-19T09:10:00.000Z", periodStart: "2026-02-30", periodEnd: "2026-10-15" } } } },
    { organizationId: 41, progress: { stepOwners: {}, completedSteps: { company: { byUserId: 11, at: "2026-10-19T09:00:00.000Z", periodStart: "2026-10-01", periodEnd: "2026-10-15" } } } },
  ];
  for (const value of cases) {
    assert.throws(() => parseFirstPayrollProgressRead(value, 41), /could not be verified/, JSON.stringify(value));
  }
});

test("a late employer A response cannot mark employer B's first-payroll steps complete", async () => {
  const owner = createScopedRequestOwner<object>();
  const aKey = { employer: 41 };
  const bKey = { employer: 42 };
  let finishA!: (value: unknown) => void;
  const oldResponse = new Promise<unknown>(resolve => { finishA = resolve; });
  const commits: Array<{
    key: object;
    data: ReturnType<typeof parseFirstPayrollProgressRead>;
    error: Error | null;
  }> = [];
  owner.activate(aKey);
  const requestA = owner.run(aKey,
    async () => parseFirstPayrollProgressRead(await oldResponse, 41),
    result => { commits.push({ key: aKey, ...result }); });
  owner.activate(bKey);
  assert.equal(activeAsyncResult(commits.at(-1) ?? null, bKey, true), null);
  const requestB = owner.run(bKey,
    async () => parseFirstPayrollProgressRead({ organizationId: 42, progress: null }, 42),
    result => { commits.push({ key: bKey, ...result }); });
  await requestB;
  finishA(sample);
  await requestA;
  assert.equal(commits.length, 1, "the obsolete employer must never commit");
  assert.equal(commits[0].key, bKey);
  assert.deepEqual(activeAsyncResult(commits[0], bKey, true)?.data, null);
});

test("first-payroll UI and endpoint use scoped reads, fail-closed status and explicit retry", () => {
  const card = readFileSync("src/components/workspace/first-payroll-readiness.tsx", "utf8");
  const panel = readFileSync("src/components/workspace/first-payroll-inline-panel.tsx", "utf8");
  const api = readFileSync("src/app/api/first-payroll/progress/route.ts", "utf8");
  assert.match(card, /useScopedAsyncResource\(scopeKey,loadProgress/);
  assert.match(card, /parseFirstPayrollProgressRead\(await response\.json\(\),organizationId\)/);
  assert.match(card, /data\?\.user\?\.id/);
  assert.match(card, /data\?\.access\?\.role/);
  assert.match(card, /Checking saved review/);
  assert.match(card, /Review not verified/);
  assert.match(card, /Assignment not verified/);
  assert.match(card, /Retry saved progress/);
  assert.doesNotMatch(card, /setProgress\(/);
  assert.match(panel, /parseFirstPayrollProgressRead\(x,organizationId\)/);
  assert.match(panel, /parseFirstPayrollProgressRead\(result,organizationId\)/);
  assert.match(api, /organizationId, progress: await readJourneyProgress\(organizationId\)/);
  assert.match(api, /"Cache-Control": "private, no-store"/);
});
