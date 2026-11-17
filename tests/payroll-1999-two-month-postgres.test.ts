/** Actual engine/settlement/payslip/GL comparison; fictional isolated Actions PG only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {MONTHS,WORKERS,cents,pesos,extra,expectedCutoff} from './fixtures/payroll-1999-reference';
const enabled=process.env.PAYROLL_1999_DISPOSABLE==='github-actions-only';
const OFF=['FINAL_PAY_SIGNED_REVIEW_ENABLED','EXACT_THIRTEENTH_CENTAVOS_ENABLED','PAYROLL_CALCULATION_HISTORY_ENABLED','NEXT_CSP_ENABLED','PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED','XENDIT_PAYOUTS_LIVE_APPROVED','WORKER_ENABLED','CENTRAL_SCHEDULER_ENABLED'];
function guard(){
 assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.DEMO_MODE,'false');
 assert.equal(process.env.DATABASE_URL,'postgresql://postgres:postgres@127.0.0.1:5432/app_db');
 for(const key of OFF)assert.equal(process.env[key],'false',key+' must remain OFF');
}
type Row={month:string;cutoff:number;worker:string;component:string;expectedCentavos:number;actualCentavos:number;deltaCentavos:number;status:string;source:string};
test('1999: two completed months / four actual engine cutoffs / eight workers / released records and exports',{
 skip:enabled?false:'NOT RUN: requires dedicated fictional PG16/PG18 Actions job, never a development or production database',
},async()=>{
 guard();
 const {and,eq}=await import('drizzle-orm');
 const {db,pool}=await import('../src/db');
 const {organizations,legalEntities,employees,employeePayProfiles,payrollRuns,payrollEntries,payslips,supplementaryEarnings,timePunches}=await import('../src/db/schema');
 const {enqueuePayrollRun,drainPayrollQueue}=await import('../src/lib/payroll-engine');
 const {settlePayrollRun}=await import('../src/lib/payroll-settlement');
 const {buildReleasedPayrollJournal,payrollJournalToCsv}=await import('../src/lib/payroll-journal-export');
 const {sql}=await import('drizzle-orm');
 const ledger:Row[]=[],structural:string[]=[],runIds:number[]=[],journals:unknown[]=[];
 let failure:unknown;
 const sourceHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const check=(month:string,cutoff:number,worker:string,component:string,actual:number,expected:number,source='SSS-2024-006 / HDMF-460 / BIR Annex E; collection policy separately identified')=>{
  assert.ok(Number.isSafeInteger(actual)&&Number.isSafeInteger(expected),'Only exact integer-centavo observations');
  ledger.push({month,cutoff,worker,component,expectedCentavos:expected,actualCentavos:actual,deltaCentavos:actual-expected,
   status:actual!==expected?'DISAGREES':component.startsWith('ph')?'SOURCE NOT VERIFIED':'AGREES',
   source:component.startsWith('ph')?'2020-0005 employed split + 2025 schedule; original 2026 advisory/odd-cent assignment NOT VERIFIED':source});
 };
 try{
  const version=await db.execute(sql`select current_setting('server_version_num')::integer as version, current_database() as database`);
  const major=Math.floor(Number(version.rows[0].version)/10000);assert.ok([16,18].includes(major));assert.equal(version.rows[0].database,'app_db');
  assert.equal((await db.select().from(organizations)).length,0,'Fresh isolated employer database required');
  const [org]=await db.insert(organizations).values({name:'Fictional #1999 two-month employer',legalName:'Fictional Private Employer',plan:'Core',statutoryDeductionTiming:'split'}).returning();
  const [entity]=await db.insert(legalEntities).values({organizationId:org.id,code:'FICTIONAL1999',legalName:'Fictional single-site employer',displayName:'Fictional #1999',primaryEntity:true}).returning();
  const ids=new Map<string,number>();
  for(const w of WORKERS){
   const [employee]=await db.insert(employees).values({organizationId:org.id,legalEntityId:entity.id,employeeNo:'F1999-'+w.key,firstName:'Fictional',lastName:w.key,title:'Test only',avatarInitials:'FQ',basicRate:pesos(w.rate),startDate:'2026-01-01',restDay:null,region:'NCR'}).returning();
   ids.set(w.key,employee.id);
   await db.insert(employeePayProfiles).values({organizationId:org.id,employeeId:employee.id,payBasis:w.basis,rateAmount:pesos(w.rate),standardWorkDaysPerMonth:String(w.divisor)+'.00',standardHoursPerDay:'8.00'});
  }
  const days:Record<string,number[][]>={
   '2026-09':[[1,2,3,4,7,8,9,10,11,14],[16,17,18,21,22,23,24,25,28,29]],
   '2026-10':[[1,2,5,6,7,8,9,12,13,14],[16,19,20,21,22,23,26,27,28,29]],
  };
  const immutableReleased=new Map<number,unknown>();
  for(const month of MONTHS)for(const cutoff of [1,2]){
   const periodStart=month+(cutoff===1?'-01':'-16'),periodEnd=month+(cutoff===1?'-15':month==='2026-09'?'-30':'-31');
   for(const w of WORKERS){
    const employeeId=ids.get(w.key)!;
    if(w.basis!=='monthly')for(const day of days[month][cutoff-1]){
     const date=month+'-'+String(day).padStart(2,'0');
     await db.insert(timePunches).values({organizationId:org.id,employeeId,workDate:date,timeIn:new Date(date+'T09:00:00+08:00'),timeOut:new Date(date+'T18:00:00+08:00'),shiftStart:'09:00',shiftEnd:'18:00',status:'Complete'});
    }
    const earning=extra(w,month,cutoff);
    if(earning.amount)await db.insert(supplementaryEarnings).values({organizationId:org.id,employeeId,earningType:earning.kind,label:'Fictional source-derived '+earning.kind,amount:pesos(earning.amount),taxable:true,includeInSssBase:earning.sssBase,includeInPagIbigBase:earning.sssBase,effectiveDate:periodEnd,status:'approved',createdBy:'Fictional test fixture'});
   }
   const [run]=await db.insert(payrollRuns).values({organizationId:org.id,legalEntityId:entity.id,periodLabel:'Fictional '+month+' cutoff '+cutoff,scopeLabel:'All locations',status:'Draft',periodStart,periodEnd,payDate:periodEnd}).returning();runIds.push(run.id);
   await enqueuePayrollRun(run.id,25);await drainPayrollQueue(10,run.id);
   const entries=await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,run.id));assert.equal(entries.length,WORKERS.length);
   const slipRows=await db.select().from(payslips).where(and(eq(payslips.organizationId,org.id),eq(payslips.periodLabel,run.periodLabel)));assert.equal(slipRows.length,WORKERS.length);
   let expectedGross=0,expectedDeductions=0,expectedNet=0;
   for(const w of WORKERS){
    const entry=entries.find(e=>e.employeeId===ids.get(w.key));assert.ok(entry);
    const expected=expectedCutoff(w,month,cutoff);expectedGross+=expected.gross;expectedDeductions+=expected.deductions;expectedNet+=expected.net;
    const lines=entry.lineItems as Array<{code:string;amount:string}>;
    const amount=(code:string)=>Math.abs(lines.filter(x=>x.code===code).reduce((n,x)=>n+cents(x.amount),0));
    const inputs=(entry.trace as {inputs?:unknown[]}).inputs||[];
    const trace=(key:string)=>{const item=inputs.find(x=>typeof x==='string'&&x.startsWith(key+'='));assert.equal(typeof item,'string',key+' trace missing');return cents(String(item).slice(key.length+1));};
    const actual={gross:cents(entry.grossPay),deductions:cents(entry.deductions),net:cents(entry.netPay),sss:amount('SSS'),ph:amount('PHIC'),pag:amount('HDMF'),wht:amount('WHT'),sssEr:trace('sssEmployerCutoff'),ec:trace('sssEmployerEcCutoff'),phEr:trace('philHealthEmployerCutoff'),pagEr:trace('pagIbigEmployerCutoff'),msc:trace('sssMonthlySalaryCredit'),regularMsc:trace('sssRegularMsc'),mpfMsc:trace('sssMpfMsc'),taxable:trace('taxableCompensation')};
    for(const key of Object.keys(actual) as Array<keyof typeof actual>)check(month,cutoff,w.key,key,actual[key],expected[key]);
    const slip=slipRows.find(s=>s.payrollEntryId===entry.id);assert.ok(slip);
    for(const [label,key]of [['Gross','gross'],['Deductions','deductions'],['Net pay','net']] as const)assert.ok(slip.content.includes(label+': PHP '+pesos(actual[key])),'Persisted payslip differs from actual register');
    assert.equal(lines.reduce((n,x)=>n+cents(x.amount),0),actual.net,'Signed actual line items must reconcile');
   }
   const [calculated]=await db.select().from(payrollRuns).where(eq(payrollRuns.id,run.id));assert.ok(calculated);
   check(month,cutoff,'EMPLOYER','registerGross',cents(calculated.grossPay),expectedGross);
   check(month,cutoff,'EMPLOYER','registerNet',cents(calculated.netPay),expectedNet);
   // Synthetic state setup ONLY: this tests settlement/ledger math, not human approvals or HTTP release authorization.
   await db.update(payrollRuns).set({status:'Releasing'}).where(and(eq(payrollRuns.id,run.id),eq(payrollRuns.status,'Needs review')));
   const result=await settlePayrollRun(run.id,{actor:'Fictional #1999 fixture',resource:run.periodLabel,metadata:{source:'disposable no-money records only'}});
   assert.equal(result.run.status,'Released');
   const journal=buildReleasedPayrollJournal([result.run]);journals.push({runId:run.id,csv:payrollJournalToCsv(journal)});
   check(month,cutoff,'EMPLOYER','GL6000',journal.filter(j=>j.accountCode==='6000').reduce((n,j)=>n+j.debitCentavos,0),expectedGross);
   check(month,cutoff,'EMPLOYER','GL2100',journal.filter(j=>j.accountCode==='2100').reduce((n,j)=>n+j.creditCentavos,0),expectedDeductions);
   check(month,cutoff,'EMPLOYER','GL2200',journal.filter(j=>j.accountCode==='2200').reduce((n,j)=>n+j.creditCentavos,0),expectedNet);
   for(const [id,snapshot]of immutableReleased)assert.deepEqual(await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,id)),snapshot,'Later cutoff changed an earlier released register');
   immutableReleased.set(run.id,await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId,run.id)));
  }
 }catch(error){failure=error;structural.push(error instanceof Error?error.message:'Unknown structural failure');}
 finally{
  const totals=MONTHS.flatMap(month=>WORKERS.flatMap(w=>['gross','sss','ph','pag','wht','net','sssEr','ec','phEr','pagEr'].map(component=>{
   const rows=ledger.filter(r=>r.month===month&&r.worker===w.key&&r.component===component);
   return {month,worker:w.key,component,cutoffs:rows.length,status:rows.length!==2?'NOT RUN':rows.some(r=>r.deltaCentavos!==0)?'DISAGREES':rows.some(r=>r.status==='SOURCE NOT VERIFIED')?'SOURCE NOT VERIFIED':'AGREES',expectedCentavos:rows.reduce((n,r)=>n+r.expectedCentavos,0),actualCentavos:rows.reduce((n,r)=>n+r.actualCentavos,0),deltaCentavos:rows.reduce((n,r)=>n+r.deltaCentavos,0)};
  })));
  const employerTotals=MONTHS.flatMap(month=>['gross','sss','ph','pag','wht','net','sssEr','ec','phEr','pagEr'].map(component=>{
   const rows=totals.filter(r=>r.month===month&&r.component===component);
   return {month,component,workerCount:rows.length,expectedCentavos:rows.reduce((n,r)=>n+r.expectedCentavos,0),actualCentavos:rows.reduce((n,r)=>n+r.actualCentavos,0),deltaCentavos:rows.reduce((n,r)=>n+r.deltaCentavos,0),status:rows.some(r=>r.status==='NOT RUN')?'NOT RUN':rows.some(r=>r.status==='DISAGREES')?'DISAGREES':component.startsWith('ph')?'SOURCE NOT VERIFIED':'AGREES'};
  }));
  const result={kind:'PAYROLL_1999_TWO_MONTH',label:'SOLO_VERIFIED_DEV_RECOVERY',sourceHead,months:MONTHS,workers:WORKERS.length,workerInputs:WORKERS,sourceMatrix:'docs/payroll-certification/two-month-2026-1999.md',collectionPolicy:'split; separate reference arithmetic; no agency timing certification',runIds,recordsReleasedOnly:true,humanApprovalTested:false,providerCalls:0,productionAccepted:false,agencyAcceptance:false,protectedFlags:'OFF',ledger,monthlyTotals:totals,employerTotals,journals,structuralFailures:structural,holds:['Original PhilHealth 2026 advisory and odd-cent EE/ER policy','MWE/source-class acceptance','Year-boundary and final-pay interactions','Statutory-liability GL account mapping NOT RUN; existing export has gross/deductions/net control accounts only','Qualified payroll review; real-employer evidence separate'],knownWorkExcluded:['#2006 SSS bracket and odd-cent basic correction vectors']};
  mkdirSync('outputs/payroll-1999',{recursive:true});writeFileSync('outputs/payroll-1999/result.json',JSON.stringify(result,null,2)+'\n');
  console.log('PAYROLL_1999_TWO_MONTH_RESULT '+JSON.stringify({sourceHead,months:MONTHS,workers:WORKERS.length,runs:runIds.length,comparisons:ledger.length,disagreements:ledger.filter(r=>r.deltaCentavos!==0),structuralFailures:structural,sourceUnverified:ledger.filter(r=>r.status==='SOURCE NOT VERIFIED').length}));
  await pool.end();
 }
 if(failure)throw failure;
 assert.equal(runIds.length,4);assert.equal(ledger.length,4*(WORKERS.length*15+5));
 assert.deepEqual(ledger.filter(r=>r.deltaCentavos!==0),[],'Preserve every difference; never rewrite expected values to match the engine');
});
