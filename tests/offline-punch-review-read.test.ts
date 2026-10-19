import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isVerifiedOfflinePunchQueue, isVerifiedOfflinePunchReviewReceipt,
  readVerifiedOfflinePunchClaims,
} from "../src/lib/offline-punch-review-read";

const claim = {
  id: 42, organizationId: 11, employeeId: 7, employeeName: "Fictional Worker",
  actionType: "clock_in", status: "pending_review",
  claimedAt: "2026-10-18T03:10:00.000Z", createdAt: "2026-10-18T03:12:00.000Z",
  reviewNote: null,
} as const;
const queue = { organizationId: 11, claims: [claim] };
const mock = (value: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

test("verified scoped, complete rows and a genuine empty queue are accepted", () => {
  assert.equal(isVerifiedOfflinePunchQueue(queue, 11), true);
  assert.equal(isVerifiedOfflinePunchQueue({ organizationId: 11, claims: [] }, 11), true);
  assert.equal(isVerifiedOfflinePunchQueue({ organizationId: 11, claims: [] }, 12), false);
});

test("malformed 200, foreign claims, missing fields and duplicate IDs never mean clear", () => {
  for (const invalid of [
    {}, [], { organizationId: 11 }, { organizationId: 11, claims: null },
    { organizationId: 10, claims: [claim] }, { ...queue, claims: [{}] },
    { ...queue, claims: [{ ...claim, organizationId: 12 }] },
    { ...queue, claims: [{ ...claim, employeeId: 0 }] },
    { ...queue, claims: [{ ...claim, employeeName: "" }] },
    { ...queue, claims: [{ ...claim, actionType: "break_start" }] },
    { ...queue, claims: [{ ...claim, status: "approved" }] },
    { ...queue, claims: [{ ...claim, claimedAt: "2026-02-30T03:10:00.000Z" }] },
    { ...queue, claims: [{ ...claim, createdAt: "not-a-date" }] },
    { ...queue, claims: [{ ...claim, reviewNote: {} }] },
    { ...queue, claims: [claim, claim] },
    { ...queue, claims: Array(101).fill(claim) },
  ]) {
    assert.equal(isVerifiedOfflinePunchQueue(invalid, 11), false, JSON.stringify(invalid).slice(0, 160));
  }
});

test("read helper requires authorized 2xx JSON, matching employer and complete fields", async () => {
  const actual: Array<{ path: string; init?: RequestInit }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    actual.push({ path: String(input), init });
    return Response.json(queue);
  }) as typeof fetch;
  const controller = new AbortController();
  assert.deepEqual(await readVerifiedOfflinePunchClaims(11, fetcher, controller.signal), queue);
  assert.equal(actual[0].path, "/api/attendance/offline-claims?organizationId=11");
  assert.equal(actual[0].init?.cache, "no-store");
  assert.equal(actual[0].init?.signal, controller.signal);
  await assert.rejects(() => readVerifiedOfflinePunchClaims(0, fetcher), /valid employer/);
  assert.equal(actual.length, 1, "Invalid scope may not issue a GET");
  await assert.rejects(() => readVerifiedOfflinePunchClaims(11, mock({}, 200)), /incomplete/);
  await assert.rejects(() => readVerifiedOfflinePunchClaims(11, mock(queue, 403)), /unavailable/);
  await assert.rejects(() => readVerifiedOfflinePunchClaims(11, mock({ organizationId: 99, claims: [] })), /another employer/);
  const html = (async () => new Response("<html>Login</html>", { status: 200 })) as typeof fetch;
  await assert.rejects(() => readVerifiedOfflinePunchClaims(11, html), /unreadable/);
  assert.deepEqual(await readVerifiedOfflinePunchClaims(11, mock({ organizationId: 11, claims: [] })),
    { organizationId: 11, claims: [] });
});

test("review PATCH requires a matching claim, employee, employer and final status receipt", () => {
  const good = {
    verified: false,
    claim: { id: 42, organizationId: 11, employeeId: 7, status: "flagged" },
  };
  assert.equal(isVerifiedOfflinePunchReviewReceipt(good, 11, claim, "flag"), true);
  assert.equal(isVerifiedOfflinePunchReviewReceipt({
    ...good, claim: { ...good.claim, status: "dismissed" },
  }, 11, claim, "dismiss"), true);
  for (const invalid of [
    {}, { ...good, verified: true },
    { ...good, claim: { ...good.claim, id: 41 } },
    { ...good, claim: { ...good.claim, organizationId: 12 } },
    { ...good, claim: { ...good.claim, employeeId: 8 } },
    { ...good, claim: { ...good.claim, status: "pending_review" } },
  ]) assert.equal(isVerifiedOfflinePunchReviewReceipt(invalid, 11, claim, "flag"), false);
});

test("GET route and HR view retain source and tenant isolation guards", () => {
  const route = readFileSync("src/app/api/attendance/offline-claims/route.ts", "utf8");
  const ui = readFileSync("src/components/workspace/offline-punch-review.tsx", "utf8");
  assert.equal((route.match(/organizationId: offlinePunchClaims.organizationId/g) ?? []).length, 2);
  assert.equal((route.match(/Response.json\(\{ organizationId, claims:/g) ?? []).length, 2);
  assert.match(ui, /ScopedOfflinePunchReviewQueue key=\{organizationId\}/);
  assert.match(ui, /controller\.abort\(\)/);
  assert.match(ui, /snapshot\?\.reload === reload/);
  assert.match(ui, /readVerifiedOfflinePunchClaims\(organizationId, fetch, controller\.signal\)/);
  assert.match(ui, /isVerifiedOfflinePunchReviewReceipt\(receipt, organizationId, claim, action\)/);
  assert.match(ui, /!loading && !error && !actionError && visible\.length === 0/);
  assert.match(ui, /const selectedRow = !loading && !error && !actionError/);
  assert.doesNotMatch(ui, /payload\.claims\s*\?\?\s*\[\]/);
});
