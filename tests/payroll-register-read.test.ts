import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVerifiedPayrollRegister, readVerifiedPayrollRegister } from "../src/lib/payroll-register-read";

const fixture = () => ({ organizationId: 31, legalEntityId: 7, runId: 9, entries: [{
  id: 17, payrollRunId: 9, employeeId: 77,
  grossPay: "1999.99", deductions: "123.45", netPay: "1876.54",
  status: "Ready", trace: {}, lineItems: [],
}]});
const fake = (r: Response): typeof fetch => (async () => r) as typeof fetch;

test("payroll register accepts a valid empty run, not a missing list", async () => {
  assert.equal(isVerifiedPayrollRegister(fixture(), 31, 9), true);
  assert.deepEqual(
    await readVerifiedPayrollRegister(31, 9, fake(Response.json({ organizationId: 31, legalEntityId: 7, runId: 9, entries: [] }))),
    [],
  );
});
test("non-OK, invalid JSON, missing/foreign employer, wrong run, malformed money and missing rows fail", async () => {
  for (const response of [
    new Response("denied", {status:403}),
    new Response("not-json", {status:200}),
    Response.json({organizationId:31,runId:9}),
    Response.json({runId:9,entries:[]}),
    Response.json({organizationId:32,runId:9,entries:[]}),
    Response.json({organizationId:31,runId:10,entries:[]}),
    Response.json({...fixture(), entries:[{...fixture().entries[0], payrollRunId: 10}]}),
    Response.json({...fixture(), entries:[{...fixture().entries[0], netPay: undefined}]}),
    Response.json({...fixture(), entries:[{...fixture().entries[0], netPay: "NaN"}]}),
    Response.json({...fixture(), entries:[{...fixture().entries[0], lineItems: null}]}),
  ]) await assert.rejects(() => readVerifiedPayrollRegister(31, 9, fake(response)));
});
test("Retry restores a verified empty run only after a successful read", async () => {
  let calls=0;
  const fetcher=(async ()=>{
    calls++;
    return calls===1?new Response("down",{status:502}):
      Response.json({organizationId:31,legalEntityId:7,runId:9,entries:[]});
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedPayrollRegister(31, 9, fetcher));
  assert.deepEqual(await readVerifiedPayrollRegister(31, 9, fetcher), []);
  assert.equal(calls,2);
});
test("only the selected legal employer's register can pass", async () => {
  assert.equal(isVerifiedPayrollRegister(fixture(),31,9,7),true);
  assert.equal(isVerifiedPayrollRegister(fixture(),31,9,8),false);
  assert.equal(isVerifiedPayrollRegister({...fixture(),legalEntityId:undefined},31,9),false);
  await assert.rejects(() => readVerifiedPayrollRegister(31,9,fake(Response.json(fixture())),undefined,8));
});
test("register abort signal is wired to a no-store request", async () => {
  const controller = new AbortController();
  let seen: RequestInit | undefined;
  const fetcher = (async (_url: string, options?: RequestInit) => {
    seen = options;
    return Response.json({organizationId:31,legalEntityId:7,runId:9,entries:[]});
  }) as typeof fetch;
  assert.deepEqual(await readVerifiedPayrollRegister(31,9,fetcher,controller.signal),[]);
  assert.equal(seen?.cache, "no-store");
  assert.equal(seen?.signal, controller.signal);
});
test("invalid employer/run ids refuse network fetch", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json(fixture()); }) as typeof fetch;
  await assert.rejects(() => readVerifiedPayrollRegister(0,9,fetcher));
  await assert.rejects(() => readVerifiedPayrollRegister(31,-1,fetcher));
  assert.equal(calls,0);
});
test("API echoes tenant and register view requires verification and explicit Retry", () => {
  const api=readFileSync("src/app/api/payroll-runs/route.ts","utf8");
  const ui=readFileSync("src/components/workspace/payroll-run.tsx","utf8");
  assert.match(api,/return Response\.json\(\{ organizationId: target\.organizationId, legalEntityId: target\.legalEntityId, runId, entries \}\)/);
  assert.match(ui,/readVerifiedPayrollRegister\(data\.selectedOrganization\.id, runId, fetch, controller\.signal, expectedLegalEntityId\)/);
  assert.match(ui,/fetched\.scopeKey === registerScopeKey/);
  assert.match(ui,/fetched\.scope === checklistScope/);
  assert.match(ui,/failedObservation\?\.scope === checklistScope/);
  assert.match(ui,/setFetched\(\{ scope: checklistScope, scopeKey: requestScopeKey, entries \}\)/);
  assert.match(ui,/selectedEmployerMatches && fetched/);
  assert.match(ui,/registerRevision,/);
  assert.match(ui,/return \(\) => controller\.abort\(\)/);
  assert.match(ui,/canOpenExports=\{entriesVerified && availablePages\.includes\("Exports"\)\}/);
  assert.match(ui,/Retry register/);
  assert.match(ui,/const entriesFailed = !selectedEmployerMatches \|\|/);
  assert.match(ui,/if \(!runId \|\| !selectedEmployerMatches\) return;/);
  assert.match(ui,/\{entriesVerified \? \(\s*<PayrollPhaseTwoOverview/,
    "do not show a green lifecycle or stored money while the register is unverified");
  assert.match(ui,/\{!ownerMode && entriesVerified && <div className="run-stats">/,
    "gross, deductions and net stay hidden until verification");
  assert.match(ui,/\{entriesVerified && visibleReleaseReceipt\?\.runId === run\.id/,
    "release success must not be shown as an unverified register state");
  assert.match(ui,/const entriesVerified =/);
  assert.match(ui,/!entriesVerified \|\| hardChecklistBlocked/);
});
