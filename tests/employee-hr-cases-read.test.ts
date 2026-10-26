import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isVerifiedEmployeeHrCases,
  readEmployeeHrCases,
} from "../src/lib/employee-hr-cases-read";

const row = () => ({
  id: 11,
  organizationId: 33,
  employeeId: 17,
  caseType: "coe",
  subject: "Fictional employment certificate request",
  description: "A synthetic employee request; no real document is generated.",
  status: "open",
  sla: { hoursRemaining: 12, overdue: false },
  coeDocumentId: null,
  messages: [{
    id: 21, visibility: "employee",
    body: "Fictional employee submission.",
    createdAt: "2026-10-25T00:00:00.000Z",
  }],
});
const fixture = () => ({ organizationId: 33, cases: [row()] });
const fake = (response: Response): typeof fetch =>
  (async () => response) as typeof fetch;

test("only a verified success is an empty employee HR request list", async () => {
  assert.equal(isVerifiedEmployeeHrCases({ organizationId: 33, cases: [] }), true);
  assert.deepEqual(await readEmployeeHrCases(fake(Response.json({
    organizationId: 33, cases: [],
  }))), { status: "ready", cases: [] });
  assert.deepEqual(await readEmployeeHrCases(fake(Response.json(fixture()))), {
    status: "ready", cases: fixture().cases,
  });
});

test("feature-off requires the explicit 404 sentinel; other failures stay visible", async () => {
  const disabled = Response.json({
    error: "HR cases are not enabled for this release.",
  }, { status: 404 });
  assert.deepEqual(await readEmployeeHrCases(fake(disabled)), {
    status: "disabled", cases: null,
  });

  for (const response of [
    Response.json({ error: "Case not found." }, { status: 404 }),
    Response.json({ error: "Authentication required." }, { status: 401 }),
    Response.json({ error: "Employee access denied." }, { status: 403 }),
    Response.json({ error: "Source unavailable." }, { status: 503 }),
    new Response("not json", { status: 200 }),
  ]) {
    await assert.rejects(readEmployeeHrCases(fake(response)));
  }
});

test("missing, malformed, cross-tenant or internal-message results never pass as verified", async () => {
  const good = fixture();
  const invalid: unknown[] = [
    undefined, null, [], {}, { organizationId: 33 },
    { cases: [] }, { organizationId: 33, cases: null },
    { organizationId: 33, cases: [row(), row()] }, // duplicate case
    { organizationId: 33, cases: [{ ...row(), organizationId: 34 }] },
    { organizationId: 33, cases: [{ ...row(), employeeId: 0 }] },
    { organizationId: 33, cases: [{ ...row(), status: "unknown" }] },
    { organizationId: 33, cases: [{ ...row(), sla: null }] },
    { organizationId: 33, cases: [{ ...row(), messages: [{ ...row().messages[0], visibility: "internal" }] }] },
    { organizationId: 33, cases: [{ ...row(), messages: [{ ...row().messages[0], createdAt: "invalid" }] }] },
    { organizationId: 33, cases: Array.from({ length: 101 }, (_, id) => ({ ...row(), id: id + 1 })) },
  ];
  assert.equal(isVerifiedEmployeeHrCases(good), true);
  for (const value of invalid) {
    assert.equal(isVerifiedEmployeeHrCases(value), false, JSON.stringify(value)?.slice(0, 120));
    await assert.rejects(readEmployeeHrCases(fake(Response.json(value ?? null))));
  }
});

test("a failed read can recover on retry, without turning the first failure into empty", async () => {
  let attempts = 0;
  const fetcher = (async () => {
    attempts++;
    return attempts === 1
      ? Response.json({ error: "unavailable" }, { status: 503 })
      : Response.json(fixture());
  }) as typeof fetch;
  await assert.rejects(readEmployeeHrCases(fetcher));
  assert.deepEqual(await readEmployeeHrCases(fetcher), {
    status: "ready", cases: fixture().cases,
  });
  assert.equal(attempts, 2);
});

test("the employee panel gates submit and reply behind a fresh verified GET", () => {
  const source = readFileSync("src/components/employee-hr-cases-panel.tsx", "utf8");
  assert.match(source, /readEmployeeHrCases\(fetch, controller\.signal\)/);
  assert.match(source, /controllerRef\.current\?\.abort\(\)/);
  assert.match(source, /setCases\(null\)/);
  assert.match(source, /const canAct = cases !== null && !loading && !error && !busy/);
  assert.match(source, /if \(!canAct\) return false/);
  assert.match(source, /cases !== null && !loading && !error && \(/);
  assert.match(source, /disabled=\{!canAct \|\| subject\.trim\(\)\.length < 4/);
  assert.match(source, /disabled=\{!canAct \|\| \(reply\[item\.id\]/);
  assert.match(source, /Retry HR requests/);
  assert.match(source, /do not submit the request again/);
});
