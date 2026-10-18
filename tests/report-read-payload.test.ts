import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVerifiedReportPayload, readVerifiedReportPayload } from "../src/lib/report-read-payload";
const query = new URLSearchParams({ organizationId: "16", key: "cost" });
const fixture = () => ({
  organizationId: 16, key: "cost", columns: ["Period", "Gross", "Net"],
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
test("API echoes employer identity and report UI refuses unchecked bodies", () => {
  const api=readFileSync("src/app/api/reports/route.ts","utf8");
  const ui=readFileSync("src/components/workspace/analytics.tsx","utf8");
  assert.match(api,/return Response\.json\(\{\s*organizationId,\s*\.\.\.report,/);
  assert.match(ui,/readVerifiedReportPayload\(organizationId, safeActive, query\)/);
  assert.match(ui,/onRetry=\{reload\}/);
  assert.match(ui,/report=\{visibleResult\}/);
});
