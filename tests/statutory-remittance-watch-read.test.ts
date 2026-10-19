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
  filingCheck: { status: "unverified" as const, filingRecordId: null,
    filingEmployeeCount: null, remittanceEmployeeCount: 1,
    filingTotal: null, remittanceTotal: 220,
    employeeCountDifference: null, totalDifference: null },
});
const openMember = () => ({
  id: 8, organizationId: 51, legalEntityId: 71,
  batchId: 4, employeeId: 19, employeeNo: "FIC-001",
  employeeShare: "100.00", employerShare: "120.00", totalContribution: "220.00",
  postingStatus: "pending", postingReference: null, postedAmount: null,
  postingEvidenceArtifactId: null, postingEvidenceSource: null,
  postingEvidenceHashSha256: null, postingEvidenceFileName: null,
  postingEvidenceByteSize: null, exceptionNote: null,
});
const fetchOnce = (response: Response): typeof fetch =>
  (async () => response) as typeof fetch;

test("verified nonempty and genuinely empty full watch snapshots are distinct", async () => {
  assert.equal(isStatutoryRemittanceWatchPayload(valid(), 51), true);
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json(valid()))), valid().alerts);
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json(empty()))), []);
});

test("multi-entity watch reads and verifies exactly the selected legal employer", async () => {
  const selectedLegalEntityId = 71;
  const foreign = { ...empty(), legalEntity: { ...empty().legalEntity, id: 72 } };
  assert.equal(isStatutoryRemittanceWatchPayload(empty(), 51, selectedLegalEntityId), true);
  assert.equal(isStatutoryRemittanceWatchPayload(foreign, 51, selectedLegalEntityId), false);
  await assert.rejects(() =>
    readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json(foreign)), undefined, selectedLegalEntityId),
  );
  let requestedUrl = "";
  let requestOptions: RequestInit | undefined;
  const fetcher = (async (url: string, options?: RequestInit) => {
    requestedUrl = url;
    requestOptions = options;
    return Response.json(empty());
  }) as typeof fetch;
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetcher, undefined, selectedLegalEntityId), []);
  assert.equal(requestedUrl, "/api/compliance/statutory-remittances?organizationId=51&legalEntityId=71");
  assert.equal(requestOptions?.cache, "no-store");
  let calls = 0;
  const neverFetch = (async () => { calls++; return Response.json(empty()); }) as typeof fetch;
  await assert.rejects(() => readVerifiedStatutoryRemittanceAlerts(51, neverFetch, undefined, 0));
  assert.equal(calls, 0);
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
    ...missing, members: [openMember()],
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
  const complete = {...empty(), batches, members: [openMember()],
    alerts: buildStatutoryRemittanceAlerts({today, batches, coverageGaps:[]})};
  assert.equal(isStatutoryRemittanceWatchPayload(complete,51), true);
  assert.equal(isStatutoryRemittanceWatchPayload({...complete,
    batches:[{...openBatch(), filingCheck:undefined}]},51), false);
  assert.equal(isStatutoryRemittanceWatchPayload({...complete,
    batches:[{...openBatch(), paymentShortfall:undefined}]},51), false);
  assert.equal(isStatutoryRemittanceWatchPayload({...complete,
    batches:[{...openBatch(), dueDate:"2026-02-31"}]},51), false);
});

test("a forged reconciled batch cannot hide pending or unproven employee postings", () => {
  const today = "2026-10-19";
  const reconciled = {
    ...openBatch(), status: "reconciled", displayStatus: "reconciled",
    amountPaid: "220.00", paymentShortfall: 0,
    hasActivePaymentProof: true,
  };
  const actual = {
    ...empty(), batches: [reconciled], members: [openMember()],
    alerts: buildStatutoryRemittanceAlerts({ today, batches: [reconciled], coverageGaps: [] }),
  };
  assert.equal(actual.alerts.length, 0, "fixture demonstrates the old false-green case");
  assert.equal(isStatutoryRemittanceWatchPayload(actual, 51, 71), false);
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
  assert.match(component, /readVerifiedStatutoryRemittanceAlerts\(organizationId, fetch, controller\.signal, legalEntityId \?\? null\)/);
  assert.match(component, /Retry status read/);
  assert.match(component, /alerts === null/);
  assert.match(component, /alerts\.length === 0/);
  assert.match(route, /return Response\.json\(\{\s*organizationId,\s*today:/);
});
