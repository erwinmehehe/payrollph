import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVerifiedComplianceCalendar, readVerifiedComplianceCalendar } from "../src/lib/compliance-calendar-read";
const item = { id: "bir-oct", agency: "BIR", obligation: "Withholding", applicableMonth: "2026-10", dueDate: "2026-11-10",
  status: "complete", detail: "Evidence confirmed", sourceLabel: "Source", sourceUrl: "/api/x", exactness: "nominal" };
const watch = { family: "BIR", label: "Tax tables", status: "current", currentVersion: "2026",
  sourceDocument: null, lastVerifiedOn: null, detail: "Verified" };
const valid = { organizationId: 41, today: "2026-10-20", applicableMonths: ["2026-10"], items: [item], ruleWatch: [watch], note: "Nominal dates" };
test("calendar only shows verified scoped obligations and complete rule-watch evidence", () => {
  assert.deepEqual(parseVerifiedComplianceCalendar(valid, 41), valid);
  assert.deepEqual(parseVerifiedComplianceCalendar({ ...valid, items: [], applicableMonths: [], ruleWatch: [] }, 41),
    { ...valid, items: [], applicableMonths: [], ruleWatch: [] }, "verified empty is explicit");
  for (const v of [null, {}, { ...valid, organizationId: 99 }, { ...valid, items: undefined },
    { ...valid, ruleWatch: undefined }, { ...valid, items: [{ ...item, status: undefined }] },
    { ...valid, ruleWatch: [{ ...watch, status: undefined }] },
    { ...valid, items: [{ ...item, id: "" }] },
    { ...valid, items: [item, item] }])
    assert.equal(parseVerifiedComplianceCalendar(v, 41), null);
});
test("calendar read rejects non-OK, malformed, missing and wrong employer, then recovers on Retry", async () => {
  let status = 503, invalid = false, payload: unknown = valid, requests = 0;
  const fetcher = (async () => {requests++; return { ok: status === 200,
    json: async () => { if(invalid) throw SyntaxError("invalid"); return payload; } } as Response;}) as typeof fetch;
  await assert.rejects(() => readVerifiedComplianceCalendar(41, fetcher), /unavailable/);
  status = 200; invalid = true;
  await assert.rejects(() => readVerifiedComplianceCalendar(41, fetcher), /unreadable/);
  invalid = false; payload = { ...valid, organizationId: 99 };
  await assert.rejects(() => readVerifiedComplianceCalendar(41, fetcher), /different employer/);
  payload = { ...valid, ruleWatch: undefined };
  await assert.rejects(() => readVerifiedComplianceCalendar(41, fetcher), /incomplete/);
  payload = { ...valid, items: [], applicableMonths: [], ruleWatch: [] };
  assert.deepEqual((await readVerifiedComplianceCalendar(41, fetcher)).items, []);
  assert.equal(requests, 5);
});
test("calendar view uses strict parser and Retry rather than data cast", () => {
  const ui = readFileSync("src/components/workspace/compliance-calendar-panel.tsx", "utf8");
  const api = readFileSync("src/app/api/compliance/calendar/route.ts", "utf8");
  assert.match(ui, /readVerifiedComplianceCalendar/);
  assert.match(ui, /Retry calendar/);
  assert.match(api, /organizationId,/);
});
