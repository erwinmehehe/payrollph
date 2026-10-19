import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVerifiedPeopleSummary, isVerifiedReportPayload, readVerifiedReportPayload } from "../src/lib/report-read-payload";
const query = new URLSearchParams({ organizationId: "16", key: "cost" });
const fixture = () => ({
  organizationId: 16, legalEntityId: null, key: "cost", columns: ["Period", "Gross", "Net"],
  rows: [["Fictional period", "100.00", "85.00"]], generatedAt: "2026-10-18T00:00:00.000Z",
});
const fake = (r: Response): typeof fetch => (async () => r) as typeof fetch;
test("valid empty reports do not become errors", async () => {
  assert.equal(isVerifiedReportPayload(fixture(), 16, "cost"), true);
  assert.deepEqual((await readVerifiedReportPayload(16, "cost", query,
    fake(Response.json({...fixture(), rows: []})))).rows, []);
});
test("non-OK, malformed JSON, missing result, foreign employer, wrong report, wrong cells fail", async () => {
  const invalid = [
    new Response("error", {status:403}),
    new Response("{oops", {status:200}),
    Response.json({organizationId:16,key:"cost",columns:["Gross"],generatedAt:fixture().generatedAt}),
    Response.json({...fixture(), organizationId:17}),
    Response.json({...fixture(), legalEntityId:19}),
    Response.json({...fixture(), key:"compliance"}),
    Response.json({...fixture(), rows:[["bad width"]]}),
    Response.json({...fixture(), rows:[[null, "10.00", "9.00"]]}),
    Response.json({...fixture(), generatedAt:"not a date"}),
  ];
  for (const item of invalid) await assert.rejects(() => readVerifiedReportPayload(16, "cost", query, fake(item)));
});
test("failed report has a retry path that accepts only a validated response", async () => {
  let calls=0;
  const fetcher=(async ()=>{
    calls++;
    return calls===1?new Response("no", {status:500}):Response.json({...fixture(),rows:[]});
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedReportPayload(16, "cost", query, fetcher));
  assert.equal((await readVerifiedReportPayload(16, "cost", query, fetcher)).rows.length, 0);
  assert.equal(calls,2);
});
test("scope metadata is mandatory; only matching legal-employer records pass", async () => {
  const scoped = {...fixture(), legalEntityId: 31};
  assert.equal(isVerifiedReportPayload(scoped, 16, "cost", 31), true);
  assert.equal(isVerifiedReportPayload(scoped, 16, "cost"), false);
  assert.equal(isVerifiedReportPayload({...fixture(), legalEntityId: 0}, 16, "cost", 0), false);
  await assert.rejects(() => readVerifiedReportPayload(16, "cost", query,
    fake(Response.json(scoped)), 32));
  assert.equal((await readVerifiedReportPayload(16, "cost", query,
    fake(Response.json(scoped)), 31)).legalEntityId, 31);
  const wrongQuery = new URLSearchParams({organizationId:"17",key:"cost"});
  let calls = 0;
  const unusedFetcher = (async () => { calls++; return Response.json(scoped); }) as typeof fetch;
  await assert.rejects(() => readVerifiedReportPayload(16, "cost", wrongQuery, unusedFetcher, 31));
  assert.equal(calls, 0, "a mismatched request must never be fetched");
});

const peopleSummary = () => ({
  asOf:"2026-10-18", windowStart:"2026-07-21", windowDays:90, historical:false,
  coverage:{eligible:2,verified:2,unverified:0,percent:100},
  headcount:2,hires:1,completedExits:0,turnoverRate:null,assignedFte:2,
  vacantPositions:0,activeRequisitions:0,recordedAnnualVacancyBudget:null,
  medianHireDays:null,approvedCompensationDeltaAnnual:null,activeCycleBudget:null,
  releasedPayrollGross:null,releasedPayrollNet:null,releasedRunCount:0,
  trends:[],units:null,warnings:[],
});
test("people reporting never accepts a missing or truncated verification summary", () => {
  const valid = {...fixture(), key:"people",peopleIntelligence:peopleSummary()};
  assert.equal(isVerifiedPeopleSummary(peopleSummary()), true);
  assert.equal(isVerifiedReportPayload(valid, 16, "people"), true);
  assert.equal(isVerifiedReportPayload({...valid,peopleIntelligence:{}},16,"people"),false);
  assert.equal(isVerifiedReportPayload({...valid,peopleIntelligence:{...peopleSummary(),coverage:null}},16,"people"),false);
  assert.equal(isVerifiedReportPayload({...valid,peopleIntelligence:{...peopleSummary(),warnings:[null]}},16,"people"),false);
  assert.equal(isVerifiedReportPayload({...valid,peopleIntelligence:{...peopleSummary(),trends:[{date:"bad",headcount:1,verified:1,eligible:2}]}},16,"people"),false);
  assert.equal(isVerifiedReportPayload({...valid,peopleIntelligence:{...peopleSummary(),releasedPayrollNet:"0"}},16,"people"),false);
});
test("API echoes employer identity and report UI refuses unchecked bodies", () => {
  const api=readFileSync("src/app/api/reports/route.ts","utf8");
  const ui=readFileSync("src/components/workspace/analytics.tsx","utf8");
  assert.match(api,/return Response\.json\(\{\s*organizationId,\s*\.\.\.report,/);
  assert.match(api,/legalEntityId: scope\.context\.enabled \? scope\.context\.legalEntityId : null/);
  assert.match(ui,/readVerifiedReportPayload\(\s*organizationId, safeActive, query, fetch,/);
  assert.match(ui,/onRetry=\{reload\}/);
  assert.match(ui,/report=\{visibleResult\}/);
  assert.match(ui,/data\.multiEntity\?\.enabled \? data\.multiEntity\.legalEntityId : null/);
});
