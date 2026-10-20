import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedFirstPayrollPreview, readVerifiedFirstPayrollPreview } from "../src/lib/first-payroll-preview-read";

const scope = {organizationId:41,periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-20"};
const empty = { ...scope, dryRun:true, persisted:false, previewReady:false, rows:[], blockers:["No active employees."], warnings:[] };
test("first-payroll preview rejects missing, partial, foreign and false ready, accepts verified empty", () => {
  assert.equal(isVerifiedFirstPayrollPreview(empty,scope),true);
  for (const body of [null, {}, {...empty,organizationId:42}, {...empty,organizationId:undefined},
      {...empty,rows:undefined}, {...empty,blockers:undefined}, {...empty,periodStart:"2026-09-01"},
      {...empty,previewReady:true}, {...empty,dryRun:false}, {...empty,persisted:undefined}]) {
    assert.equal(isVerifiedFirstPayrollPreview(body,scope),false,JSON.stringify(body));
  }
});
test("first-payroll preview handles HTTP failure, invalid JSON and explicit retry", async () => {
  let status = 502, badJson = false, body:unknown = empty, calls = 0;
  const fetcher = (async () => ({
    ok: (++calls > 0) && status === 200,
    json: async () => { if(badJson)throw new SyntaxError("fictional malformed JSON");return body; },
  } as Response)) as typeof fetch;
  await assert.rejects(() => readVerifiedFirstPayrollPreview(scope,fetcher), /not verified/);
  status = 200; badJson = true;
  await assert.rejects(() => readVerifiedFirstPayrollPreview(scope,fetcher), /not verified/);
  badJson = false; body = {...empty,organizationId:42};
  await assert.rejects(() => readVerifiedFirstPayrollPreview(scope,fetcher), /not verified/);
  body = empty;
  assert.deepEqual(await readVerifiedFirstPayrollPreview(scope,fetcher),empty);
  assert.equal(calls,4);
});
