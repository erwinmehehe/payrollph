import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import type { db } from "../src/db";

test("first-payroll preview never exposes a write-capable database dependency", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { loadReadOnlyFirstPayrollPreview } = await import("../src/lib/first-payroll-preview");
  const tables: Record<string, unknown[]> = {
    organizations: [{ id: 9, name: "Test", legalName: "Test", payrollCalendarMode: "flexible" }],
  };
  let writes = 0;
  const reader = new Proxy({
    select() {
      let table = "";
      const query: Record<string, unknown> = {};
      query.from = (target: Parameters<typeof getTableName>[0]) => {
        table = getTableName(target);
        return query;
      };
      query.where = () => query;
      query.limit = () => query;
      query.then = (done: (rows: unknown[]) => unknown) => Promise.resolve(tables[table] ?? []).then(done);
      return query;
    },
  }, {
    get(target, name) {
      if (name === "select") return target.select;
      writes += 1;
      throw new Error("Unexpected DB mutation method");
    },
  }) as unknown as Pick<typeof db, "select">;
  const before = structuredClone(tables);
  const result = await loadReadOnlyFirstPayrollPreview({
    organizationId: 9, periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15",
  }, reader);
  assert.equal(result.dryRun, true);
  assert.equal(result.persisted, false);
  assert.equal(result.previewReady, false);
  assert.deepEqual(tables, before);
  assert.equal(writes, 0);
});

test("the first payroll preview route and calculator have no write operations", () => {
  const route = readFileSync("src/app/api/first-payroll/preview/route.ts", "utf8");
  const loader = readFileSync("src/lib/first-payroll-preview.ts", "utf8");
  assert.match(route, /loadReadOnlyFirstPayrollPreview/);
  assert.match(loader, /calculateEmployeePay/);
  for (const source of [route, loader]) {
    assert.doesNotMatch(source, /\.insert\(|\.update\(|\.delete\(|\.transaction\(|enqueuePayrollRun|drainPayrollQueue/);
  }
});

test("first-time fixed-salary tenant can reach preview-ready with only read operations",async()=>{
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const {loadReadOnlyFirstPayrollPreview}=await import("../src/lib/first-payroll-preview");
  const rows:Record<string,unknown[]>={
    organizations:[{id:33,name:"Synthetic Employer",legalName:"Synthetic Employer"}],
    legal_entities:[{id:101,organizationId:33,active:true,primaryEntity:true,payrollCalendarMode:"ph_semi_monthly",statutoryDeductionTiming:"split"}],
    first_payroll_journey_progress:[
      {organizationId:33,step:"company",ownerRole:"owner",data:{completedByUserId:1,completedAt:"2026-10-01T10:00:00Z"}},
      {organizationId:33,step:"time",ownerRole:"hr",data:{completedByUserId:2,completedAt:"2026-10-01T11:00:00Z",periodStart:"2026-10-01",periodEnd:"2026-10-15"}},
    ],
    user_organizations:[{role:"payroll"},{role:"checker"},{role:"hr"},{role:"owner"}],
    employees:[{id:5,organizationId:33,legalEntityId:101,employeeNo:"EMP-0001",firstName:"Juan",lastName:"Santos",status:"Active",startDate:"2026-01-01",
      tin:"123456789",bankAccount:"enc:v1:fake",bankCode:"BPI",basicRate:"30000.00",mwe:false,region:"NCR",restDay:"Sunday",pagIbigVoluntaryMonthly:"0"}],
    employee_pay_profiles:[{id:6,organizationId:33,employeeId:5,payBasis:"monthly",rateAmount:"30000.00",standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00"}],
  };
  let writes=0;
  const reader=new Proxy({select(){
    let table="";const chain:Record<string,unknown>={};
    chain.from=(t:Parameters<typeof getTableName>[0])=>{table=getTableName(t);return chain;};
    chain.where=()=>chain;chain.limit=()=>chain;
    chain.then=(resolve:(value:unknown[])=>unknown)=>Promise.resolve(rows[table]??[]).then(resolve);
    return chain;
  }},{get(target,field){if(field==="select")return target.select;writes++;throw Error("Write attempted");}}) as unknown as Pick<typeof db,"select">;
  const before=structuredClone(rows);
  const result=await loadReadOnlyFirstPayrollPreview({
    organizationId:33,periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15",
  },reader);
  assert.deepEqual(rows,before);
  assert.equal(writes,0);
  assert.equal(result.rows.length,1);
  assert.ok((result.rows[0].gross??0)>0);
  assert.equal(result.previewReady,true,JSON.stringify(result.blockers));
});
