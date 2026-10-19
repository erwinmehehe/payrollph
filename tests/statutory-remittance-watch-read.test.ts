import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildStatutoryRemittanceAlerts } from "../src/lib/statutory-remittance-alerts";
import {
  isStatutoryRemittanceWatchPayload,
  readVerifiedStatutoryRemittanceAlerts,
} from "../src/lib/statutory-remittance-watch-payload";

const empty = () => ({
  organizationId: 51,
  today: "2026-10-19",
  legalEntity: { id: 71, code: "MAIN", displayName: "Fictional Test Employer" },
  batches: [],
  members: [],
  coverageGaps: [],
  alerts: [],
});
const valid = () => {
  const today = "2026-10-19";
  const coverageGaps = [{ agency: "SSS", applicableMonth: "2026-09", dueDate: "2026-10-20" }];
  return {
    ...empty(), today, coverageGaps,
    alerts: buildStatutoryRemittanceAlerts({ today, batches: [], coverageGaps }),
  };
};
const openBatch = () => ({
  id: 4, organizationId: 51, legalEntityId: 71, agency: "PhilHealth",
  applicableMonth: "2026-09", dueDate: "2026-10-19", status: "open",
  displayStatus: "open", employeeCount: 1,
  expectedEmployeeShare: "100.00", expectedEmployerShare: "120.00",
  expectedTotal: "220.00", amountPaid: null, paymentReference: null,
  agencyReceiptReference: null, paidAt: null, pendingPostingCount: 1,
  exceptionCount: 0, paymentShortfall: 220, hasActivePaymentProof: false,
  filingCheck: { status: "unverified", filingRecordId: null,
    filingEmployeeCount: null, remittanceEmployeeCount: 1,
    filingTotal: null, remittanceTotal: 220,
    employeeCountDifference: null, totalDifference: null },
});
const fetchOnce = (response: Response): typeof fetch =>
  (async () => response) as typeof fetch;

test("verified nonempty and genuinely empty full watch snapshots are distinct", async () => {
  assert.equal(isStatutoryRemittanceWatchPayload(valid(), 51), true);
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json(valid()))), valid().alerts);
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json(empty()))), []);
});

test("non-OK, malformed, missing, foreign and inconsistent employer snapshots fail closed", async () => {
  const responses = [
    new Response('{"error":"Denied"}', { status: 403 }),
    new Response("bad json", { status: 200 }),
    Response.json({ organizationId: 51, alerts: [] }), // never trust a bare 'all-clear'
    Response.json({ ...empty(), batches: undefined }),
    Response.json({ ...empty(), members: undefined }),
    Response.json({ ...empty(), coverageGaps: undefined }),
    Response.json({ ...empty(), legalEntity: undefined }),
    Response.json({ ...empty(), today: undefined }),
    Response.json({ ...empty(), organizationId: 52 }),
    Response.json({ ...valid(), alerts: [] }), // suppressed coverage gap
    Response.json({ ...valid(), alerts: [{ ...valid().alerts[0], tone: "compliant" }] }),
    Response.json({ ...valid(), alerts: [{ ...valid().alerts[0], detail: null }] }),
    Response.json({ ...valid(), alerts: [{ ...valid().alerts[0], dueDate: "2026-10-21" }] }),
    Response.json({ ...valid(), alerts: [valid().alerts[0], valid().alerts[0]] }),
  ];
  for (const response of responses) {
    await assert.rejects(() => readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(response)));
  }
  assert.equal(isStatutoryRemittanceWatchPayload(null, 51), false);
});

test("an omitted or forged empty alert list cannot hide an open batch due today", () => {
  const today = "2026-10-19";
  const batches = [openBatch()];
  const missing = { ...empty(), batches };
  assert.equal(isStatutoryRemittanceWatchPayload(missing, 51), false);
  const complete = {
    ...missing,
    alerts: buildStatutoryRemittanceAlerts({ today, batches, coverageGaps: [] }),
  };
  assert.equal(isStatutoryRemittanceWatchPayload(complete, 51), true);
  assert.equal(isStatutoryRemittanceWatchPayload({ ...complete, batches: [{
    ...openBatch(), hasActivePaymentProof: undefined,
  }] }, 51), false);
});

test("a missing filing comparison or proof flag cannot suppress the required warning", () => {
  const today = "2026-10-19";
  const batches = [openBatch()];
  const complete = {...empty(), batches,
    alerts: buildStatutoryRemittanceAlerts({today, batches, coverageGaps:[]})};
  assert.equal(isStatutoryRemittanceWatchPayload(complete,51), true);
  assert.equal(isStatutoryRemittanceWatchPayload({...complete,
    batches:[{...openBatch(), filingCheck:undefined}]},51), false);
  assert.equal(isStatutoryRemittanceWatchPayload({...complete,
    batches:[{...openBatch(), paymentShortfall:undefined}]},51), false);
  assert.equal(isStatutoryRemittanceWatchPayload({...complete,
    batches:[{...openBatch(), dueDate:"2026-02-31"}]},51), false);
});

test("an explicit retry can turn a failed read into a verified empty state", async () => {
  let attempts = 0;
  const fetcher = (async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("service unavailable", { status: 503 })
      : Response.json(empty());
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedStatutoryRemittanceAlerts(51, fetcher));
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetcher), []);
  assert.equal(attempts, 2);
});

test("watch renders all clear only for validated readiness and exposes Retry on unavailable", () => {
  const component = readFileSync("src/components/workspace/statutory-remittance-watch.tsx", "utf8");
  const route = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
  assert.match(component, /readVerifiedStatutoryRemittanceAlerts\(organizationId, fetch, controller\.signal\)/);
  assert.match(component, /Retry status read/);
  assert.match(component, /alerts === null/);
  assert.match(component, /alerts\.length === 0/);
  assert.match(route, /return Response\.json\(\{\s*organizationId,\s*today:/);
});
