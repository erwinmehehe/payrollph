import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {requireFictionalJourney,reconcileFirstPayroll} from './first-payroll-full-contract.mjs';

// Explicit opt-in, loopback-only fictional fixture. Never a production runner.
const {database,base}=requireFictionalJourney();
const {db,pool}=await import('../../src/db/index.ts');
const s=await import('../../src/db/schema.ts');
const {eq,and}=await import('drizzle-orm');
const identity=(await pool.query("select current_setting('data_directory') as directory,current_setting('server_version_num')::int as version")).rows[0];
assert.equal(Math.floor(identity.version/10000),16);
if(!(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&database.port==='5432')){
 assert.ok(identity.directory.replaceAll('\\','/').endsWith('payrollph-first-payroll-complete-20261031/outputs/pg16'),'task-owned local cluster required');
}
const {seedEmployer,standaloneMakeSession,standaloneRequest,standaloneExpectStatus}=await import('./tenant-table-http.mjs');
const nonce=randomUUID().slice(0,8),period={periodStart:'2026-10-01',periodEnd:'2026-10-15',payDate:'2026-10-15'};
const steps=[];
async function call(actor,path,method='GET',body,expected=200){
 const r=standaloneExpectStatus(await standaloneRequest(path,{cookie:actor.cookie,method,body}),expected,path);
 steps.push({path,method,status:r.status});return r.json??r.text;
}
async function actor(e,role){
 const[u]=await db.insert(s.users).values({email:`journey-${role}-${nonce}@example.invalid`,name:`Fictional ${role} ${nonce}`,passwordHash:'fictional-session-only',role,totpEnabled:true}).returning();
 await db.insert(s.userOrganizations).values({organizationId:e.org.id,userId:u.id,role,active:true});
 const session=await standaloneMakeSession(u.id);await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));return {...u,cookie:session.cookie};
}
try{
 const e=await seedEmployer('ATTA',nonce,standaloneMakeSession);
 await db.update(s.organizations).set({accountType:'enterprise'}).where(eq(s.organizations.id,e.org.id));
 await db.update(s.employees).set({status:'Inactive'}).where(eq(s.employees.id,e.worker.id));
 const checker=await actor(e,'checker'),hr=await actor(e,'hr'),payroll=await actor(e,'payroll');
 const template=`Fictional QA CSV ${nonce}`;
 await db.insert(s.bankTemplates).values({name:template,version:'fictional-v1',format:'CSV',mappings:{columns:['employee_no','account_number','amount'],includeHeader:true},adapterStage:'draft',specSource:'unknown'});
 const worker=(await call(e,'/api/employees','POST',{organizationId:e.org.id,employeeNo:`JOURNEY-${nonce}`,firstName:'Fictional',lastName:'First payroll',title:'QA only',startDate:'2026-01-05',region:'NCR',payBasis:'monthly',rateAmount:30000,legalEntityId:e.entity.id},201)).employee;
 assert.ok(worker?.id);
 await call(e,'/api/employees','PATCH',{employeeId:worker.id,organizationId:e.org.id,bankCode:'BDO',bankAccount:'123456789012',payoutChangeReason:'Fictional initial setup, no payment'});
 // Historical punches are fictional source inputs; approval is performed over HTTP.
 for(let day=1;day<=15;day++){
  const date=`2026-10-${String(day).padStart(2,'0')}`;
  if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))continue;
  await db.insert(s.timePunches).values({organizationId:e.org.id,employeeId:worker.id,workDate:date,timeIn:new Date(date+'T01:00:00Z'),breakStart:new Date(date+'T04:00:00Z'),breakEnd:new Date(date+'T05:00:00Z'),timeOut:new Date(date+'T10:00:00Z'),source:'fictional-first-payroll'});
 }
 await call(e,'/api/workforce/timesheets','POST',{organizationId:e.org.id,action:'update_policy',enforcementMode:'block',active:true});
 const blocked=await call(payroll,'/api/payroll-runs','POST',{organizationId:e.org.id,legalEntityId:e.entity.id,...period,processNow:true},422);
 assert.equal(blocked.code,'TIMESHEET_APPROVAL_REQUIRED');
 assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,e.org.id))).length,0,'unapproved time must not create payroll');
 const sheet=(await call(e,'/api/workforce/timesheets','POST',{organizationId:e.org.id,employeeId:worker.id,action:'submit',...period},201)).timesheet;
 await call(e,'/api/workforce/timesheets','POST',{organizationId:e.org.id,action:'decide',timesheetId:sheet.id,decision:'approved'},409);
 await call(hr,'/api/workforce/timesheets','POST',{organizationId:e.org.id,action:'decide',timesheetId:sheet.id,decision:'approved'});
 const body={organizationId:e.org.id,legalEntityId:e.entity.id,...period,processNow:true};
 // Real idempotency header, not a fabricated saved run or approval status.
 const key=`first-payroll-${nonce}`;
 async function create(){const response=await fetch(new URL('/api/payroll-runs',base),{method:'POST',headers:{cookie:payroll.cookie,origin:base.origin,'sec-fetch-site':'same-origin','content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});const json=await response.json();assert.ok(response.ok,JSON.stringify(json));return json;}
 const created=await create(),runId=created.run?.id??created.id;assert.ok(runId,JSON.stringify(created));
 const replay=await create();assert.equal(replay.run?.id??replay.id,runId);
 const [run]=await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id,runId));
 const entries=await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,runId));
 assert.equal(entries.length,1);assert.equal(entries[0].employeeId,worker.id);
 reconcileFirstPayroll(run,entries);assert.equal(run.grossPay,'15000.00','fictional monthly BASIC cutoff');
 const task=(await call(payroll,`/api/payroll-runs/${runId}/submit-review`,'POST',{approverUserId:checker.id},201)).task;
 await call(payroll,`/api/approvals/${task.id}`,'PATCH',{status:'Approved'},403);
 await call(checker,`/api/approvals/${task.id}`,'PATCH',{status:'Approved'});
 await call(checker,`/api/payroll-runs/${runId}/release`,'POST',{},403);
 await call(e,`/api/payroll-runs/${runId}/release`,'POST',{});
 const slips=await call(e,`/api/payroll-runs/${runId}/exports?kind=payslip`);
 assert.equal(slips.payslips.length,1);
 const slip=slips.payslips[0];assert.equal(slip.employeeId,worker.id);assert.equal(slip.payrollEntryId,entries[0].id);
 const displayed=v=>Number(v).toFixed(2);
 for(const line of [`Gross: PHP ${displayed(run.grossPay)}`,`Deductions: PHP ${displayed(entries[0].deductions)}`,`Net pay: PHP ${displayed(run.netPay)}`])assert.ok(slip.content.includes(line),line);
 const pdf=await call(e,`/api/payroll-runs/${runId}/exports?kind=payslip&payslipId=${slip.id}`);assert.ok(pdf.startsWith('%PDF-1.4'));
 const bankPath=`/api/payroll-runs/${runId}/exports?kind=bank&template=${encodeURIComponent(template)}`;
 const bank=await call(e,bankPath+'&dryRun=true');
 assert.match(bank,new RegExp('totalNet='+run.netPay.replace('.','\\.')));
 const finalBank=await call(e,bankPath+'&dryRun=false');
 assert.equal(finalBank,`"employee_no","account_number","amount"\n"JOURNEY-${nonce}","123456789012","${run.netPay}"`);
 const duplicateFile=await call(e,bankPath+'&dryRun=false','GET',undefined,409);assert.equal(duplicateFile.code,'FINAL_BANK_FILE_ALREADY_ISSUED');
 await call(payroll,`/api/payroll-runs/${runId}/process`,'POST',{},409);
 const replayReleased=await create();assert.equal(replayReleased.run?.id??replayReleased.id,runId);
 const finalEntries=await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,runId));assert.deepEqual(finalEntries,entries);
 const finalRuns=await db.select().from(s.payrollRuns).where(and(eq(s.payrollRuns.organizationId,e.org.id),eq(s.payrollRuns.periodStart,period.periodStart)));assert.equal(finalRuns.length,1);
 const [released]=finalRuns;assert.equal(released.status,'Released');
 let browserTested=false;
 if(process.env.FIRST_PAYROLL_FULL_BROWSER==='true'){
  const{chromium}=await import('playwright');
  const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
  try{for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:900},extraHTTPHeaders:{cookie:e.cookie}}),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(new URL('/app',base).href,{waitUntil:'networkidle'});
   assert.equal(new URL(page.url()).pathname,'/app');await page.getByText(e.org.name,{exact:false}).first().waitFor();
   await page.locator('[data-production-pilot-signoff="required"]').getByText('₱'+Number(run.netPay).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),{exact:true}).waitFor();
   assert.deepEqual(errors,[]);mkdirSync('outputs',{recursive:true});await page.screenshot({path:`outputs/first-payroll-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'View payroll details',exact:true}).click();
   await page.getByText('₱'+Number(run.netPay).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),{exact:true}).first().waitFor();
   assert.deepEqual(errors,[]);await page.screenshot({path:`outputs/first-payroll-details-${width}.png`,fullPage:true});await page.close();
  }browserTested=true;}finally{await browser.close();}
 }
 mkdirSync('outputs',{recursive:true});writeFileSync('outputs/first-payroll-full.json',JSON.stringify({result:'PASS',kind:'fictional-first-payroll-http',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),steps,gross:run.grossPay,net:run.netPay,providerCalls:0,browserTested,browserScope:'real owner dashboard and payroll-details navigation desktop/mobile after HTTP-driven journey; not click-through payroll entry or real sign-in',bankScope:'fictional mapping only; no bank portal/UAT or settlement',coverageCredits:0},null,2));
 console.log('PASS fictional first-payroll HTTP journey');
}finally{await pool.end();}
