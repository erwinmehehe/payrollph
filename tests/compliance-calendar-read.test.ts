import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVerifiedComplianceCalendar, readVerifiedComplianceCalendar } from "../src/lib/compliance-calendar-read";
// The source-issued monthly BIR identifier is required by the fail-closed parser.
const item = { id: "BIR-1601C-2026-10", agency: "BIR", obligation: "Withholding", applicableMonth: "2026-10", dueDate: "2026-11-10",
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
const contributions = (month: string) => (["SSS", "PhilHealth", "Pag-IBIG"] as const).map(agency => ({
  ...item, id: agency + "-" + month, agency, applicableMonth: month,
}));
const valid = { organizationId: 41, today: "2026-10-20", applicableMonths: ["2026-10"],
  contributionMonths: ["2026-10"], birPayMonths: ["2026-10"],
  items: [item, ...contributions("2026-10")], ruleWatch, note: "Nominal dates" };
const empty = { ...valid, applicableMonths: [], contributionMonths: [], birPayMonths: [], items: [] };
test("calendar only shows verified scoped obligations and complete rule-watch evidence", () => {
  assert.deepEqual(parseVerifiedComplianceCalendar(valid, 41), valid);
  const scheduledRule = { ...watch, label: "Regional wage update", sourceDocument: "WO-ROVII-27", status: "change-upcoming" };
  assert.deepEqual(parseVerifiedComplianceCalendar({ ...valid, ruleWatch: [...ruleWatch, scheduledRule] }, 41)?.ruleWatch,
    [...ruleWatch, scheduledRule], "separate statutory notices may share one rule family");
  assert.deepEqual(parseVerifiedComplianceCalendar(empty, 41),
    empty, "verified empty is explicit");
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
    { ...valid, contributionMonths: undefined },
    { ...valid, birPayMonths: undefined },
    { ...valid, contributionMonths: [] },
    { ...valid, birPayMonths: [] },
    { ...valid, items: [item] },
    { ...valid, items: [item, ...contributions("2026-10").slice(0, 2)] },
    { ...valid, items: [item, ...contributions("2026-10").slice(1)] },
    { ...valid, items: [item, ...contributions("2026-09")] },
    { ...valid, contributionMonths: ["2026-09"] },
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
test("calendar distinguishes BIR-only pay dates from contribution payroll months", () => {
  const disjoint = { ...valid, applicableMonths: ["2026-09", "2026-10"],
    contributionMonths: ["2026-09"], birPayMonths: ["2026-10"],
    items: [...contributions("2026-09"), item] };
  assert.deepEqual(parseVerifiedComplianceCalendar(disjoint, 41), disjoint);
  const birOnly = { ...valid, contributionMonths: [], items: [item] };
  assert.deepEqual(parseVerifiedComplianceCalendar(birOnly, 41), birOnly);
  const contributionOnly = { ...valid, birPayMonths: [], items: contributions("2026-10") };
  assert.deepEqual(parseVerifiedComplianceCalendar(contributionOnly, 41), contributionOnly);
  assert.equal(parseVerifiedComplianceCalendar({ ...disjoint, items: [item] }, 41), null,
    "BIR-only item cannot hide missing SSS/PhilHealth/Pag-IBIG for a payroll-period month");
  assert.equal(parseVerifiedComplianceCalendar({ ...disjoint, items: contributions("2026-09") }, 41), null,
    "Missing BIR pay-date obligation must be rejected");
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
  payload = empty;
  assert.deepEqual((await readVerifiedComplianceCalendar(41, fetcher)).items, []);
  assert.equal(requests, 5);
});
test("calendar view uses strict parser and Retry rather than data cast", () => {
  const ui = readFileSync("src/components/workspace/compliance-calendar-panel.tsx", "utf8");
  const api = readFileSync("src/app/api/compliance/calendar/route.ts", "utf8");
  assert.match(ui, /readVerifiedComplianceCalendar/);
  assert.match(ui, /Retry calendar/);
  assert.match(api, /organizationId,/);
  assert.match(api, /contributionMonths: calendar.contributionMonths/);
  assert.match(api, /birPayMonths: calendar.birPayMonths/);
});
