import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isStatutoryRemittanceWatchPayload,
  readVerifiedStatutoryRemittanceAlerts,
} from "../src/lib/statutory-remittance-watch-payload";

const valid = () => ({
  organizationId: 51,
  alerts: [{ id: "fictional-1", tone: "warning", title: "Fictional remittance due", detail: "No receipt in test." }],
});
const fetchOnce = (response: Response): typeof fetch =>
  (async () => response) as typeof fetch;

test("verified nonempty and genuinely empty watch results are distinct", async () => {
  assert.equal(isStatutoryRemittanceWatchPayload(valid(), 51), true);
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json(valid()))), valid().alerts);
  assert.deepEqual(await readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(Response.json({organizationId: 51, alerts: []}))), []);
});

test("non-OK, malformed JSON, missing fields and foreign employer fail closed", async () => {
  const responses = [
    new Response('{"error":"Denied"}', { status: 403 }),
    new Response("bad json", { status: 200 }),
    Response.json({ organizationId: 51 }),
    Response.json({ alerts: [] }),
    Response.json({ organizationId: 52, alerts: [] }),
    Response.json({ ...valid(), alerts: [{ ...valid().alerts[0], tone: "compliant" }] }),
    Response.json({ ...valid(), alerts: [{ ...valid().alerts[0], detail: null }] }),
  ];
  for (const response of responses) {
    await assert.rejects(() => readVerifiedStatutoryRemittanceAlerts(51, fetchOnce(response)));
  }
  assert.equal(isStatutoryRemittanceWatchPayload(null, 51), false);
});

test("an explicit retry can turn a failed read into a verified empty state", async () => {
  let attempts = 0;
  const fetcher = (async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("service unavailable", { status: 503 })
      : Response.json({ organizationId: 51, alerts: [] });
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
