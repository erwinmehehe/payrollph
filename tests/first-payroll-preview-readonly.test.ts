import assert from "node:assert/strict";
import test from "node:test";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
      query.groupBy = () => query;
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

test("simple fixed-salary source discovery never calculates an unapproved net",async()=>{
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
    chain.where=()=>chain;chain.groupBy=()=>chain;chain.limit=()=>chain;
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
  assert.equal(result.rows[0].gross,null);
  assert.equal(result.rows[0].net,null);
  assert.equal(result.previewReady,false,"only canonical input assembly may price payroll");
});

test("multi-employer preview refuses unscoped worker disclosure",async()=>{
 process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
 const {loadReadOnlyFirstPayrollPreview}=await import("../src/lib/first-payroll-preview");
 const tables:Record<string,unknown[]>={
  organizations:[{id:9}],
  legal_entities:[{id:1,primaryEntity:true,active:true},{id:2,primaryEntity:false,active:true}],
  employees:[{id:19,legalEntityId:2,firstName:"Protected",lastName:"Employee"}],
 };
 const reader={select(){let table="";const q:Record<string,unknown>={};
  q.from=(target:Parameters<typeof getTableName>[0])=>{table=getTableName(target);return q;};
  q.where=()=>q;q.groupBy=()=>q;q.limit=()=>q;
  q.then=(resolve:(items:unknown[])=>unknown)=>Promise.resolve(tables[table]??[]).then(resolve);
  return q;
 }} as unknown as Pick<typeof db,"select">;
 await assert.rejects(loadReadOnlyFirstPayrollPreview({
  organizationId:9,periodStart:"2026-10-01",periodEnd:"2026-10-15",payDate:"2026-10-15"
 },reader),/MULTI_ENTITY_PREVIEW_REQUIRES_SCOPED_AUTHORIZATION/);
});


test("first-payroll simple preview scopes punch guard to selected tenant and inclusive pay period", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { loadReadOnlyFirstPayrollPreview } = await import("../src/lib/first-payroll-preview");
  const dialect = new PgDialect();
  const periodStart = "2026-10-01", periodEnd = "2026-10-15", organizationId = 33;
  const data: Record<string, unknown[]> = {
    organizations: [{ id: organizationId, name: "Fictional Employer A", legalName: "Fictional Employer A" }],
    legal_entities: [{ id: 101, organizationId, active: true, primaryEntity: true,
      payrollCalendarMode: "ph_semi_monthly", statutoryDeductionTiming: "split" }],
    first_payroll_journey_progress: [
      { organizationId, step: "company", data: { completedAt: "2026-10-01T10:00:00Z" } },
      { organizationId, step: "time", data: { completedAt: "2026-10-01T11:00:00Z",
        periodStart, periodEnd } },
    ],
    user_organizations: [{ role: "payroll" }, { role: "checker" }],
    employees: [{ id: 5, organizationId, legalEntityId: 101, employeeNo: "A-001",
      firstName: "Fictional", lastName: "Worker", status: "Active", startDate: "2026-01-01",
      tin: "123456789", bankAccount: "synthetic-only", bankCode: "TEST",
      basicRate: "30000.00", mwe: false, region: "NCR", restDay: "Sunday",
      pagIbigVoluntaryMonthly: "0" }],
    employee_pay_profiles: [{ id: 6, organizationId, employeeId: 5, payBasis: "monthly",
      rateAmount: "30000.00", standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00" }],
  };
  const scenarios = [
    { name: "prior/future and other-tenant punches ignored",
      punches: [
        { id: 1, organizationId, employeeId: 5, workDate: "2026-09-30" },
        { id: 2, organizationId, employeeId: 5, workDate: "2026-10-16" },
        { id: 3, organizationId: 44, employeeId: 5, workDate: "2026-10-08" },
      ], expectedReady: true },
    { name: "first cutoff day must block",
      punches: [{ id: 4, organizationId, employeeId: 5, workDate: periodStart }], expectedReady: false },
    { name: "last cutoff day must block",
      punches: [{ id: 5, organizationId, employeeId: 5, workDate: periodEnd }], expectedReady: false },
  ];
  for (const scenario of scenarios) {
    let punchWhereChecked = false, writes = 0;
    const reader = new Proxy({ select() {
      let table = "", condition: SQL | undefined;
      const chain: Record<string, unknown> = {};
      chain.from = (target: Parameters<typeof getTableName>[0]) => {
        table = getTableName(target);
        return chain;
      };
      chain.where = (clause: SQL) => {
        condition = clause;
        return chain;
      };
      chain.groupBy = () => chain;
      chain.limit = () => chain;
      chain.then = (resolve: (rows: unknown[]) => unknown) => {
        if (table !== "time_punches") return Promise.resolve(data[table] ?? []).then(resolve);
        assert.ok(condition, "Time punch query needs explicit employer and period predicates");
        const parsed = dialect.sqlToQuery(condition);
        assert.match(parsed.sql, /organization_id/);
        assert.match(parsed.sql, /work_date/);
        assert.match(parsed.sql, />=/);
        assert.match(parsed.sql, /<=/);
        assert.match(parsed.sql, /employee_id/);
        assert.deepEqual(parsed.params, [organizationId, 5, periodStart, periodEnd]);
        punchWhereChecked = true;
        // Test adapter applies the exact SQL query's organization and inclusive date predicates.
        const [org, employeeId, start, end] = parsed.params as [number, number, string, string];
        const scoped = scenario.punches.filter(p =>
          p.organizationId === org && p.employeeId === employeeId &&
          p.workDate >= start && p.workDate <= end);
        return Promise.resolve(scoped.slice(0, 1)).then(resolve);
      };
      return chain;
    } }, { get(target, field) {
      if (field === "select") return target.select;
      writes += 1;
      throw Error("Read-only preview attempted a database mutation");
    } }) as unknown as Pick<typeof db, "select">;
    const preview = await loadReadOnlyFirstPayrollPreview({
      organizationId, periodStart, periodEnd, payDate: periodEnd,
    }, reader);
    assert.equal(punchWhereChecked, true, scenario.name);
    assert.equal(writes, 0, scenario.name);
    assert.equal(preview.previewReady, false, "source discovery cannot calculate any wages");
    assert.equal(preview.persisted, false, scenario.name);
    if (scenario.expectedReady) {
      assert.equal(preview.rows[0].gross, null, scenario.name);
      assert.equal(preview.rows[0].net, null, scenario.name);
      assert.ok(!preview.blockers.some(b => b.includes("time punches")), scenario.name);
    } else {
      assert.equal(preview.rows[0].gross, null, scenario.name);
      assert.equal(preview.rows[0].net, null, scenario.name);
      assert.ok(preview.rows[0].blockers.some(b => b.includes("time punches")), scenario.name);
    }
  }
});


test("future-only optional payroll records cannot block an earlier cutoff, while prior and boundary records remain fail-closed", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const { loadReadOnlyFirstPayrollPreview } = await import("../src/lib/first-payroll-preview");
  const dialect = new PgDialect();
  const organizationId = 33, periodEnd = "2026-10-15";
  const base: Record<string, unknown[]> = {
    organizations: [{ id: organizationId }],
    legal_entities: [{ id: 101, organizationId, active: true, primaryEntity: true,
      payrollCalendarMode: "ph_semi_monthly", statutoryDeductionTiming: "split" }],
    first_payroll_journey_progress: [
      { step: "company", data: { completedAt: "2026-10-01T10:00:00Z" } },
      { step: "time", data: { completedAt: "2026-10-01T11:00:00Z",
        periodStart: "2026-10-01", periodEnd } },
    ],
    user_organizations: [{ role: "payroll" }, { role: "checker" }],
    employees: [{ id: 5, organizationId, legalEntityId: 101, employeeNo: "A-001",
      firstName: "Fictional", lastName: "Worker", status: "Active", startDate: "2026-01-01",
      tin: "123456789", bankAccount: "synthetic-only", bankCode: "TEST",
      basicRate: "30000.00", mwe: false, region: "NCR", restDay: "Sunday",
      pagIbigVoluntaryMonthly: "0" }],
    employee_pay_profiles: [{ id: 6, organizationId, employeeId: 5, payBasis: "monthly",
      rateAmount: "30000.00", standardWorkDaysPerMonth: "22.00",
      standardHoursPerDay: "8.00" }],
  };
  for (const [table, dateColumn, rowDateField] of [
    ["leave_requests", "start_date", "startDate"],
    ["supplementary_earnings", "effective_date", "effectiveDate"],
    ["holidays", "holiday_date", "holidayDate"],
  ] as const) {
    for (const date of ["2026-10-16", "2026-10-15", "2026-10-01", "2026-09-30"]) {
      let checked = false, writes = 0;
      const reader = new Proxy({ select() {
        let selected = "", condition: SQL | undefined;
        const chain: Record<string, unknown> = {};
        chain.from = (target: Parameters<typeof getTableName>[0]) => {
          selected = getTableName(target); return chain;
        };
        chain.where = (clause: SQL) => { condition = clause; return chain; };
        chain.groupBy = () => chain;
      chain.limit = () => chain;
        chain.then = (done: (rows: unknown[]) => unknown) => {
          if (selected !== table) return Promise.resolve(base[selected] ?? []).then(done);
          assert.ok(condition, table + " must have an explicit SQL scope");
          const parsed = dialect.sqlToQuery(condition);
          assert.match(parsed.sql, /organization_id/);
          assert.match(parsed.sql, new RegExp(dateColumn));
          assert.match(parsed.sql, /<=/);
          if (table === "holidays") {
            assert.deepEqual(parsed.params, [organizationId, periodEnd]);
          } else {
            assert.match(parsed.sql, /employee_id/);
            assert.deepEqual(parsed.params, [organizationId, 5, periodEnd]);
          }
          checked = true;
          const record = { id: 77, organizationId, employeeId: 5, [rowDateField]: date };
          return Promise.resolve(date <= periodEnd ? [record] : []).then(done);
        };
        return chain;
      } }, { get(target, field) {
        if (field === "select") return target.select;
        writes++; throw Error("Read-only payroll preview attempted a write");
      } }) as unknown as Pick<typeof db, "select">;
      const result = await loadReadOnlyFirstPayrollPreview({
        organizationId, periodStart: "2026-10-01", periodEnd, payDate: periodEnd,
      }, reader);
      const shouldBlock = date <= periodEnd;
      assert.equal(checked, true, table + " on " + date);
      assert.equal(writes, 0);
      assert.equal(result.persisted, false);
      assert.equal(result.previewReady, false, "source discovery never marks monetary output ready");
      assert.equal(result.rows[0].gross, null, table + " on " + date);
      const messages = table === "holidays" ? result.blockers : result.rows[0].blockers;
      assert.equal(messages.some(b => b.includes({
        leave_requests: "leave requests",
        supplementary_earnings: "supplementary earnings",
        holidays: "employer-specific holidays",
      }[table])), shouldBlock, table + " on " + date);
    }
  }
});


test("complex sources block only the affected worker within the authenticated employer and cutoff", async () => {
  process.env.DATABASE_URL ??= "postgresql://local:local@127.0.0.1:1/offline";
  const {loadReadOnlyFirstPayrollPreview}=await import("../src/lib/first-payroll-preview");
  const dialect=new PgDialect();
  const organizationId=33,periodStart="2026-10-01",periodEnd="2026-10-15";
  const fixture:Record<string,unknown[]>={
    organizations:[{id:33,name:"Fictional A"}],
    legal_entities:[{id:101,organizationId:33,active:true,primaryEntity:true,
      payrollCalendarMode:"ph_semi_monthly",statutoryDeductionTiming:"split"}],
    first_payroll_journey_progress:[
      {step:"company",data:{completedAt:"2026-10-01T10:00:00Z"}},
      {step:"time",data:{completedAt:"2026-10-01T11:00:00Z",periodStart,periodEnd}},
    ],
    user_organizations:[{role:"payroll"},{role:"checker"}],
    employees:[5,6].map(id=>({
      id,organizationId:33,legalEntityId:101,employeeNo:"OVERLAP-"+id,
      firstName:"Fictional",lastName:"Worker"+id,status:"Active",startDate:"2026-01-01",
      tin:"123456789",bankAccount:"synthetic-only",bankCode:"TEST",basicRate:"30000.00",
      mwe:false,region:"NCR",restDay:"Sunday",pagIbigVoluntaryMonthly:"0",
    })),
    employee_pay_profiles:[5,6].map(employeeId=>({
      id:employeeId+100,organizationId:33,employeeId,payBasis:"monthly",
      rateAmount:"30000.00",standardWorkDaysPerMonth:"22.00",standardHoursPerDay:"8.00",
    })),
  };
  // Include records for a different tenant and outside the active cohort;
  // an implementation without SQL organization+employee predicates would leak
  // evidence and improperly block the unrelated fictional employee.
  const sources:Record<string,Array<{
    organizationId:number;employeeId:number;workDate?:string;
  }>>={
    time_punches:[
      {organizationId:33,employeeId:6,workDate:"2026-10-07"},
      {organizationId:33,employeeId:5,workDate:"2026-09-30"},
      {organizationId:44,employeeId:5,workDate:"2026-10-07"},
      {organizationId:33,employeeId:999,workDate:"2026-10-07"},
    ],
    employee_loans:[
      {organizationId:33,employeeId:6},
      {organizationId:44,employeeId:5},
      {organizationId:33,employeeId:999},
    ],
  };
  let writes=0,scopedSources=0;
  const reader=new Proxy({select(){
    let table="",condition:SQL|undefined;
    const query:Record<string,unknown>={};
    query.from=(target:Parameters<typeof getTableName>[0])=>{
      table=getTableName(target);return query;
    };
    query.where=(clause:SQL)=>{condition=clause;return query;};
    query.groupBy=()=>query;
    query.limit=()=>query;
    query.then=(resolve:(value:unknown[])=>unknown)=>{
      if(!(table in sources))return Promise.resolve(fixture[table]??[]).then(resolve);
      assert.ok(condition,table+" must have SQL scope");
      const parsed=dialect.sqlToQuery(condition);
      assert.match(parsed.sql,/organization_id/);
      assert.match(parsed.sql,/employee_id/);
      assert.deepEqual(parsed.params.slice(0,3),[organizationId,5,6]);
      if(table==="time_punches"){
        assert.match(parsed.sql,/work_date/);
        assert.deepEqual(parsed.params.slice(3),[periodStart,periodEnd]);
      }
      scopedSources+=1;
      const included=sources[table].filter(row=>
        row.organizationId===organizationId&&[5,6].includes(row.employeeId)&&
        (table!=="time_punches"||(
          row.workDate!==undefined&&row.workDate>=periodStart&&row.workDate<=periodEnd
        )));
      return Promise.resolve([...new Set(included.map(row=>row.employeeId))]
        .map(employeeId=>({employeeId}))).then(resolve);
    };
    return query;
  }},{get(target,field){
    if(field==="select")return target.select;
    writes++;throw Error("Preview attempted mutation or unapproved database method");
  }}) as unknown as Pick<typeof db,"select">;
  const before=structuredClone(fixture);
  const preview=await loadReadOnlyFirstPayrollPreview({
    organizationId,periodStart,periodEnd,payDate:periodEnd,
  },reader);
  assert.equal(writes,0);
  assert.ok(scopedSources>=2);
  assert.deepEqual(fixture,before);
  assert.equal(preview.dryRun,true);
  assert.equal(preview.persisted,false);
  assert.equal(preview.previewReady,false,"one worker's unmodeled inputs must block cohort readiness");
  assert.equal(preview.rows.length,2);
  const simple=preview.rows.find(row=>row.employeeId===5);
  const complex=preview.rows.find(row=>row.employeeId===6);
  assert.ok(simple);
  assert.ok(complex);
  assert.equal(simple.gross,null,"readiness scan never guesses an unrelated worker\u0027s net");
  assert.equal(simple.net,null);
  assert.deepEqual(simple.blockers,[]);
  assert.equal(complex.gross,null);
  assert.equal(complex.net,null);
  assert.ok(complex.blockers.some(message=>message.includes("time punches")));
  assert.ok(complex.blockers.some(message=>message.includes("employee loans")));
});
