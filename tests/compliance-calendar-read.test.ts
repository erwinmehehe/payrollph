import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedComplianceCalendar, readVerifiedComplianceCalendar,
  type VerifiedComplianceCalendar,
} from "@/lib/compliance-calendar-read";

const org = 101;
const empty: VerifiedComplianceCalendar = {
  organizationId: org, today: "2026-10-21", applicableMonths: [],
  items: [], ruleWatch: [], note: "No fictional payroll periods exist.",
};
const sample = {
  ...empty, applicableMonths: ["2026-10"],
  items: [{
    id: "FICTIONAL-ITEM", agency: "BIR", obligation: "Fictional withholding",
    applicableMonth: "2026-10", dueDate: "2026-11-10", status: "overdue",
    detail: "Fictional test evidence", sourceLabel: "Test registry",
    sourceUrl: "https://example.invalid/", exactness: "nominal",
  }],
};
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("calendar: verified-empty shows actual zero attention when employer identity and shape match", async () => {
  assert.equal(isVerifiedComplianceCalendar(empty, org), true);
  assert.deepEqual(await readVerifiedComplianceCalendar(org, json(empty)), empty);
  assert.equal(isVerifiedComplianceCalendar(sample, org), true);
});

test("calendar: HTTP failures and malformed JSON cannot show all reconciled", async () => {
  await assert.rejects(readVerifiedComplianceCalendar(org, json(empty, 500)), /unavailable/);
  const invalid = (async () => new Response("{malformed")) as typeof fetch;
  await assert.rejects(readVerifiedComplianceCalendar(org, invalid), /malformed JSON/);
});

test("calendar: reject wrong employer, missing evidence arrays and malformed counts input", async () => {
  for (const body of [
    {}, { ...empty, organizationId: 202 },
    { ...empty, applicableMonths: undefined },
    { ...empty, items: undefined }, { ...empty, ruleWatch: undefined },
    { ...empty, today: undefined },
    { ...sample, items: [{ ...sample.items[0], status: undefined }] },
    { ...sample, items: [{ ...sample.items[0], dueDate: "bogus" }] },
  ]) {
    assert.equal(isVerifiedComplianceCalendar(body, org), false);
    await assert.rejects(readVerifiedComplianceCalendar(org, json(body)), /incomplete or for another/);
  }
});

test("calendar: retry performs a second read, never caches unavailable as empty", async () => {
  let count = 0;
  const fetcher = (async () => new Response(JSON.stringify(
    ++count === 1 ? { ...empty, items: undefined } : empty,
  ))) as typeof fetch;
  await assert.rejects(readVerifiedComplianceCalendar(org, fetcher));
  assert.deepEqual(await readVerifiedComplianceCalendar(org, fetcher), empty);
  assert.equal(count, 2);
});
