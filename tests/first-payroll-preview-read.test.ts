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

test("verified source-linked preview requires exact gross to statutory to other to net cents", () => {
  const row = {
    employeeId: 701, employeeNo: "FICTIONAL-701", name: "Fictional Employee",
    gross: 15000, sss: 400, philHealth: 220, pagIbig: 100, withholding: 280,
    statutoryDeductions: 1000, otherDeductions: 750, net: 13250,
    sources: [
      { page: "People", recordId: 101, label: "Pay profile" },
      { page: "Time & attendance", recordId: 202, label: "Time punch 2026-10-07" },
      { page: "Loans", recordId: 303, label: "Active loan" },
    ],
    blockers: [] as string[],
  };
  const valid = {...empty, previewReady: true, blockers: [], rows: [row]};
  assert.equal(isVerifiedFirstPayrollPreview(valid, scope), true);
  assert.equal(isVerifiedFirstPayrollPreview({...valid, rows:[{...row, net:13250.01}]}, scope), false);
  assert.equal(isVerifiedFirstPayrollPreview({...valid, rows:[{...row, otherDeductions:null}]}, scope), false);
  assert.equal(isVerifiedFirstPayrollPreview({...valid, rows:[{...row, sources:[]}]}, scope), false);
  assert.equal(isVerifiedFirstPayrollPreview({...valid, rows:[{...row, sources:[{page:"Approval",recordId:99,label:"Unsafe"}]}]}, scope), false);
  assert.equal(isVerifiedFirstPayrollPreview({...valid, rows:[{...row, sources:[{page:"Loans",recordId:-1,label:"Invalid"}]}]}, scope), false);
  const blocked = {...valid, previewReady:false, blockers:["Resolve worker source evidence."],
    rows:[{...row, gross:null, sss:null, philHealth:null, pagIbig:null,
      withholding:null, statutoryDeductions:null, otherDeductions:null, net:null,
      sources:[],blockers:["Approved timesheet required for this pay period."]}]};
  assert.equal(isVerifiedFirstPayrollPreview(blocked, scope), true, "explicit blockers may suppress all figures");
  assert.equal(isVerifiedFirstPayrollPreview({...blocked, rows:[{...blocked.rows[0], net:123}]}, scope), false,
    "partial figures must not leak when source data is incomplete");
});
