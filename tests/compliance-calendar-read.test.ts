import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVerifiedComplianceCalendar, readVerifiedComplianceCalendar } from "../src/lib/compliance-calendar-read";
const item = { id: "bir-oct", agency: "BIR", obligation: "Withholding", applicableMonth: "2026-10", dueDate: "2026-11-10",
  status: "complete", detail: "Evidence confirmed", sourceLabel: "Source", sourceUrl: "/api/x", exactness: "nominal" };
const watch = { family: "BIR", label: "Tax tables", status: "current", currentVersion: "2026",
  sourceDocument: null, lastVerifiedOn: null, detail: "Verified" };
const ruleWatch = [
  { ...watch, family: "sss", label: "SSS rules" },
  { ...watch, family: "philhealth", label: "PhilHealth rules" },
  { ...watch, family: "pagibig", label: "Pag-IBIG rules" },
  { ...watch, family: "bir-withholding", label: "BIR withholding rules" },
  { ...watch, family: "wage-orders", label: "Regional wage orders" },
];
const valid = { organizationId: 41, today: "2026-10-20", applicableMonths: ["2026-10"], items: [item], ruleWatch, note: "Nominal dates" };
test("calendar only shows verified scoped obligations and complete rule-watch evidence", () => {
  assert.deepEqual(parseVerifiedComplianceCalendar(valid, 41), valid);
  const scheduledRule = { ...watch, label: "Regional wage update", sourceDocument: "WO-ROVII-27", status: "change-upcoming" };
  assert.deepEqual(parseVerifiedComplianceCalendar({ ...valid, ruleWatch: [...ruleWatch, scheduledRule] }, 41)?.ruleWatch,
    [...ruleWatch, scheduledRule], "separate statutory notices may share one rule family");
  assert.deepEqual(parseVerifiedComplianceCalendar({ ...valid, items: [], applicableMonths: [] }, 41),
    { ...valid, items: [], applicableMonths: [] }, "verified empty is explicit");
  for (const v of [null, {}, { ...valid, organizationId: 99 }, { ...valid, items: undefined },
    { ...valid, ruleWatch: undefined }, { ...valid, items: [{ ...item, status: undefined }] },
    { ...valid, ruleWatch: [{ ...watch, status: undefined }] },
    { ...valid, ruleWatch: ruleWatch.map(w => ({ ...w, family: "bir-withholding" })) },
    { ...valid, items: [{ ...item, id: "" }] },
    { ...valid, items: [item, item] },
    // Missing obligation families and missing rule-watch families must NOT
    // render the green "no items need attention" card.
    { ...valid, items: [] },
    { ...valid, ruleWatch: [] },
    { ...valid, ruleWatch: ruleWatch.slice(0, 4) },
    { ...valid, applicableMonths: ["2026-10", "2026-09"] },
    { ...valid, applicableMonths: ["2026-10", "2026-10"] },
    { ...valid, items: [{ ...item, id: "ANNUAL-BIR-2026" }] },
    { ...valid, items: [
      { ...item, id: "SSS-2026-10", agency: "SSS" },
      { ...item, id: "PhilHealth-2026-10", agency: "PhilHealth" },
    ] },
    { ...valid, today: "2026-02-30" },
    { ...valid, applicableMonths: ["2026-13"] },
    { ...valid, items: [{ ...item, dueDate: "2026-02-30" }] },
    { ...valid, ruleWatch: [...ruleWatch, ruleWatch[0]] }])
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
  payload = { ...valid, items: [], applicableMonths: [] };
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
