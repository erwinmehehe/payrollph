import {db,S,eq,prove,exact,denial,http} from "./tenant-records-mwe-migration-shared.mjs";
export const KINDS=["employees","payroll_history","leave_balances","loans"];
function csv(kind,e){
  const no=e.worker.employeeNo;
  if(kind==="employees")return [
    "Employee ID,First Name,Last Name,Job Title,Employment Type,Employment Status,Monthly Basic,MWE,Region,Hire Date",
    no+",Fictional,"+e.label+",Payroll QA,Regular,Active,21000,no,NCR,2026-01-05"
  ].join("\n")+"\n";
  if(kind==="payroll_history")return [
    "Employee ID,Pay Date,Payroll Period,Reference,Gross Pay,Basic Salary Earned,Net Pay,Withholding Tax,SSS Contribution,PhilHealth Contribution,Pag-IBIG Contribution,13th Month Pay",
    no+",2026-02-15,Feb 2026,QA-"+e.label+"-HIST,21000,21000,19000,500,300,300,100,1500"
  ].join("\n")+"\n";
  if(kind==="leave_balances")return [
    "Employee ID,Leave Type,Year,Opening Balance,Accrued,Used,Pending",
    no+",Vacation,2026,12,0,1,0"
  ].join("\n")+"\n";
  if(kind==="loans")return [
    "Employee ID,Loan Type,Loan Number,Original Amount,Monthly Amortization,Per Cutoff,Outstanding Balance,Total Paid,Status,Start Date,End Date",
    no+",Company Emergency Loan,QA-"+e.label+"-LOAN,1000,100,50,800,200,active,2026-01-05,2026-12-31"
  ].join("\n")+"\n";
  throw Error("Unknown kind");
}
export const request=(e,kind,csvContent,override={})=>http("/api/migrations","POST",e.cookie,{
  organizationId:e.org.id,source:"generic",kind,csv:csvContent,
  fileName:"fictional-"+kind+".csv",dryRun:false,
  evidenceReference:"TEST-EVIDENCE-MIGRATION-ONLY",...override,
});
export async function proveMigrations(attackers,victim){
  const ownSources=new Map();
  for(const e of [...attackers,victim]){
    const items={};
    for(const kind of KINDS){
      const content=csv(kind,e);
      const forged={
        employeeId:victim.worker.id,runId:victim.worker.id,
        legalEntityId:victim.entity.id,
      };
      const preview=exact(await request(e,kind,content,{...forged,dryRun:true}),
        200,e.label+" "+kind+" genuine dry-run");
      prove(preview.json?.dryRun===true&&preview.json?.readyCount>=1,
        kind+" dry run has eligible real owned records");
      const result=exact(await request(e,kind,content,forged),
        200,e.label+" "+kind+" real committed HTTP import");
      prove(result.json?.batchId>0&&result.json.dryRun===false&&
        result.json.kind===kind&&result.json.readyCount>=1,
        kind+" committed response exposes persisted own batch and real affected rows");
      const [stored]=await db.select().from(S.importBatches).where(eq(S.importBatches.id,result.json.batchId));
      prove(stored?.organizationId===e.org.id&&stored.importKind===kind&&
        stored.createdCount+stored.updatedCount>=1,
        kind+" saved in authenticated employer despite forged body selectors");
      const table=({employees:S.employees,payroll_history:S.historicalPayrollEntries,
        leave_balances:S.leaveBalances,loans:S.employeeLoans})[kind];
      prove((await db.select().from(table).where(eq(table.organizationId,e.org.id))).length>=1,
        kind+" real own PostgreSQL source rows created/updated");
      prove((await db.select().from(S.auditEvents).where(eq(S.auditEvents.organizationId,e.org.id)))
        .some(x=>kind==="employees"?
          x.action==="Initial employee-master migration completed":
          x.action==="Migration import completed"),
        kind+" scoped audit saved with own mutation");
      items[kind]={csv:content,batchId:stored.id};
    }
    ownSources.set(e,items);
  }
  const victimBatches=await db.select().from(S.importBatches)
    .where(eq(S.importBatches.organizationId,victim.org.id));
  prove(victimBatches.length===4&&victimBatches.every(x=>x.id>6)&&
    victimBatches.every(x=>x.id>ownSources.get(attackers[1]).loans.batchId),
    "four actual victim import batch IDs >6 and higher than both attackers");
  for(const actor of attackers){
    for(const kind of KINDS){
      await denial(await request(actor,kind,ownSources.get(victim)[kind].csv,{
        organizationId:victim.org.id,employeeId:victim.worker.id,
        legalEntityId:victim.entity.id,runId:ownSources.get(victim)[kind].batchId,
      }),403,victim,kind+" forged actual foreign employer denied pre-import");
    }
    // A victim employee number is not a global pointer; a missing employee
    // in the caller's company must not resolve to foreign payroll/loan/leave data.
    for(const kind of ["payroll_history","leave_balances","loans"]){
      await denial(await request(actor,kind,ownSources.get(victim)[kind].csv,{
        organizationId:actor.org.id,employeeId:victim.worker.id,
        legalEntityId:victim.entity.id,
      }),422,victim,kind+" foreign-only worker source rejected");
    }
  }
  return ownSources;
}
