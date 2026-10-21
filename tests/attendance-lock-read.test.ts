import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVerifiedAttendanceLocks, readVerifiedAttendanceLocks } from "../src/lib/attendance-lock-read";
const lock = { id: 8, periodStart: "2026-10-01", periodEnd: "2026-10-15",
  lockType: "payroll_cutoff", status: "locked", reason: "Approved", lockedBy: "Payroll", lockedAt: "2026-10-16T10:00:00Z" };
const data = { organizationId: 41, canManage: true, policy: { requirePayrollCutoffLock: true }, locks: [lock] };
test("attendance lock status requires verified employer, policy and every row", () => {
  assert.deepEqual(parseVerifiedAttendanceLocks(data, 41), data);
  assert.deepEqual(parseVerifiedAttendanceLocks({ ...data, locks: [] }, 41)?.locks, []);
  for (const v of [null, {}, { ...data, organizationId: 99 },
    { ...data, canManage: undefined }, { ...data, policy: {} }, { ...data, locks: undefined },
    { ...data, locks: [{ ...lock, periodStart: "2026-02-30" }] },
    { ...data, locks: [{ ...lock, lockType: "other" }] },
    { ...data, locks: [lock, lock] }])
    assert.equal(parseVerifiedAttendanceLocks(v, 41), null);
});
test("attendance locks non-OK, malformed, foreign, missing and retry", async () => {
  let status = 502, malformed = false, value: unknown = data, attempts = 0;
  const fetcher = (async () => {attempts++;return {ok: status === 200, json: async () => {
    if (malformed) throw SyntaxError("invalid");
    return value;
  }} as Response;}) as typeof fetch;
  await assert.rejects(() => readVerifiedAttendanceLocks(41, fetcher), /unavailable/);
  status = 200; malformed = true;
  await assert.rejects(() => readVerifiedAttendanceLocks(41, fetcher), /unreadable/);
  malformed = false; value = { ...data, organizationId: 99 };
  await assert.rejects(() => readVerifiedAttendanceLocks(41, fetcher), /different employer/);
  value = { ...data, locks: undefined };
  await assert.rejects(() => readVerifiedAttendanceLocks(41, fetcher), /incomplete/);
  value = { ...data, locks: [] };
  assert.deepEqual((await readVerifiedAttendanceLocks(41, fetcher)).locks, []);
  assert.equal(attempts, 5);
});
test("attendance lock UI denies success-looking Open when source is unverified", () => {
  const ui = readFileSync("src/components/workspace/attendance-lock-control.tsx", "utf8");
  const api = readFileSync("src/app/api/workforce/attendance-locks/route.ts", "utf8");
  assert.match(ui, /readVerifiedAttendanceLocks/);
  assert.match(ui, /!payload \|\| loadError \? "Lock status unavailable"/);
  assert.match(ui, /onRetry=\{\(\) => void load\(\)\}/);
  assert.match(api, /organizationId,\s+canManage/);
});
