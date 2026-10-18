import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVerifiedPayrollRegister, readVerifiedPayrollRegister } from "../src/lib/payroll-register-read";

const fixture = () => ({ organizationId: 31, runId: 9, entries: [{
  id: 17, payrollRunId: 9, employeeId: 77,
  grossPay: "1999.99", deductions: "123.45", netPay: "1876.54",
  status: "Ready", trace: {}, lineItems: [],
}]});
const fake = (r: Response): typeof fetch => (async () => r) as typeof fetch;

test("payroll register accepts a valid empty run, not a missing list", async () => {
  assert.equal(isVerifiedPayrollRegister(fixture(), 31, 9), true);
  assert.deepEqual(
    await readVerifiedPayrollRegister(31, 9, fake(Response.json({ organizationId: 31, runId: 9, entries: [] }))),
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
      Response.json({organizationId:31,runId:9,entries:[]});
  }) as typeof fetch;
  await assert.rejects(() => readVerifiedPayrollRegister(31, 9, fetcher));
  assert.deepEqual(await readVerifiedPayrollRegister(31, 9, fetcher), []);
  assert.equal(calls,2);
});
test("API echoes tenant and register view requires verification and explicit Retry", () => {
  const api=readFileSync("src/app/api/payroll-runs/route.ts","utf8");
  const ui=readFileSync("src/components/workspace/payroll-run.tsx","utf8");
  assert.match(api,/return Response\.json\(\{ organizationId: target\.organizationId, runId, entries \}\)/);
  assert.match(ui,/readVerifiedPayrollRegister\(data\.selectedOrganization\.id, runId\)/);
  assert.match(ui,/Retry register/);
  assert.match(ui,/const entriesVerified =/);
  assert.match(ui,/!entriesVerified \|\| hardChecklistBlocked/);
});
