import assert from "node:assert/strict";
import test from "node:test";
import {
  isVerifiedDole13thRead, readVerifiedDole13th, type VerifiedDole13thRead,
} from "@/lib/dole-thirteenth-month-read";

const org = 101, year = 2026;
const report: VerifiedDole13thRead = {
  organizationId: org, taxYear: year, profile: null,
  report: {
    reportType: "13th_month_pay", taxYear: year, dueDate: "2027-01-15",
    establishmentName: "FICTIONAL EXAMPLE", establishmentAddress: "",
    principalBusiness: "", totalEmployment: 0, workersBenefited: 0,
    totalBenefitsGranted: 0, contactName: "", contactPosition: "", contactPhone: "",
    employees: [],
  },
  reportHash: "a".repeat(64), profileComplete: false, readyToSubmit: false,
  reviewRows: [], incompleteBasicRows: [],
  sourceNote: "Fictional source worksheet only; no government submission.",
  submissionCurrent: false, currentSubmission: null, latestSubmission: null,
  submissionHistory: [],
  officialSource: {
    label: "DOLE Online Compliance Portal", url: "https://reports.dole.gov.ph/",
    deadline: "2027-01-15",
  },
};
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("DOLE 13th: verified empty remains visible but not ready to submit", async () => {
  assert.equal(isVerifiedDole13thRead(report, org, year), true);
  assert.deepEqual(await readVerifiedDole13th(org, year, json(report)), report);
});

test("DOLE 13th: HTTP failure and malformed response cannot appear as zero grants", async () => {
  await assert.rejects(readVerifiedDole13th(org, year, json(report, 403)), /unavailable/);
  const malformed = (async () => new Response("{not json")) as typeof fetch;
  await assert.rejects(readVerifiedDole13th(org, year, malformed), /malformed JSON/);
});

test("DOLE 13th: wrong employer/year, absent history/totals, dishonest readiness all rejected", async () => {
  for (const invalid of [
    {}, { ...report, organizationId: 109 }, { ...report, taxYear: 2025 },
    { ...report, report: undefined }, { ...report, submissionHistory: undefined },
    { ...report, reviewRows: undefined }, { ...report, reportHash: "" },
    { ...report, readyToSubmit: true }, { ...report, submissionCurrent: true },
    { ...report, report: { ...report.report, totalEmployment: 1 } },
    { ...report, report: { ...report.report, totalBenefitsGranted: undefined } },
    { ...report, report: { ...report.report, employees: undefined } },
    { ...report, officialSource: { ...report.officialSource, deadline: "2026-01-15" } },
  ]) {
    assert.equal(isVerifiedDole13thRead(invalid, org, year), false);
    await assert.rejects(readVerifiedDole13th(org, year, json(invalid)), /incomplete or for another/);
  }
});

test("DOLE 13th: Retry requests a fresh report and only verified evidence can succeed", async () => {
  let attempts = 0;
  const fetcher = (async () => new Response(
    JSON.stringify(++attempts === 1 ? { ...report, submissionHistory: null } : report),
  )) as typeof fetch;
  await assert.rejects(readVerifiedDole13th(org, year, fetcher));
  assert.deepEqual(await readVerifiedDole13th(org, year, fetcher), report);
  assert.equal(attempts, 2);
});
