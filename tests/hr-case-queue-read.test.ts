import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVerifiedHrCaseQueue, readVerifiedHrCaseQueue } from "../src/lib/hr-case-queue-read";

const fixture = () => ({
  organizationId: 33,
  cases: [{
    id: 8, organizationId: 33, employeeId: 17, caseType: "coe",
    assignedRole: "hr", subject: "Fictional COE request",
    description: "Fictional employment document request", status: "open",
    sla: { hoursRemaining: 2, overdue: false }, coeDocumentId: null, messages: [],
  }],
});
const fake = (response: Response): typeof fetch => (async () => response) as typeof fetch;

test("a verified HR inbox can legitimately have zero cases", async () => {
  assert.equal(isVerifiedHrCaseQueue(fixture(), 33), true);
  assert.deepEqual(await readVerifiedHrCaseQueue(33, fake(Response.json({ organizationId: 33, cases: [] }))), []);
});
test("non-OK, malformed JSON, missing or foreign cases block verified empty", async () => {
  for (const response of [
    new Response("denied", { status: 403 }),
    new Response("not-json", { status: 200 }),
    Response.json({ organizationId: 33 }),
    Response.json({ cases: [] }),
    Response.json({ organizationId: 34, cases: [] }),
    Response.json({ ...fixture(), cases: [{ ...fixture().cases[0], organizationId: 34 }] }),
    Response.json({ ...fixture(), cases: [{ ...fixture().cases[0], sla: null }] }),
    Response.json({ ...fixture(), cases: [{ ...fixture().cases[0], status: "unknown" }] }),
  ]) {
    await assert.rejects(() => readVerifiedHrCaseQueue(33, fake(response)));
  }
});
test("explicit retry restores only verified HR controls", async () => {
  let tries = 0;
  const fetcher = (async () => {
    tries += 1;
    return tries === 1 ? new Response("offline", { status: 503 }) : Response.json(fixture());
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedHrCaseQueue(33, fetcher));
  assert.equal((await readVerifiedHrCaseQueue(33, fetcher)).length, 1);
  assert.equal(tries, 2);
});
test("source ties HR GET to employer and UI gates case actions behind read", () => {
  const api = readFileSync("src/app/api/hr-cases/route.ts", "utf8");
  const ui = readFileSync("src/components/employee-hr-case-staff-queue.tsx", "utf8");
  assert.match(api, /return Response\.json\(\{\s*organizationId,\s*cases:/);
  assert.match(ui, /readVerifiedHrCaseQueue\(organizationId, fetch, signal\)/);
  assert.match(ui, /Retry HR requests/);
  assert.match(ui, /cases !== null && !loading && !error/);
});
