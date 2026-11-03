import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {requireFictionalJourney,reconcileFirstPayroll} from './first-payroll-full-contract.mjs';

const {base}=requireFictionalJourney();
const {db,pool}=await import('../../src/db/index.ts');
const s=await import('../../src/db/schema.ts');
const {eq}=await import('drizzle-orm');
const {seedEmployer,standaloneMakeSession}=await import('./tenant-table-http.mjs');
const {chromium}=await import('playwright');
const identity=(await pool.query("select current_setting('server_version_num')::int as version,current_setting('data_directory') as directory")).rows[0];
assert.equal(Math.floor(identity.version/10000),16);
assert.ok((process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&new URL(process.env.DATABASE_URL).port==='5432')||identity.directory.replaceAll('\\','/').endsWith('payrollph-first-payroll-complete-20261031/outputs/pg16'));
const nonce=randomUUID().slice(0,8),errors=[],steps=[];
mkdirSync('outputs',{recursive:true});
let browser;
try{
 const employer=await seedEmployer('ATTA',nonce,standaloneMakeSession);
 await db.update(s.organizations).set({accountType:'enterprise'}).where(eq(s.organizations.id,employer.org.id));
 await db.update(s.employees).set({status:'Inactive'}).where(eq(s.employees.id,employer.worker.id));
 async function actor(role){
  const [user]=await db.insert(s.users).values({name:`Fictional browser ${role} ${nonce}`,email:`browser-${role}-${nonce}@example.invalid`,passwordHash:'fictional-session-only',role,totpEnabled:true}).returning();
  await db.insert(s.userOrganizations).values({userId:user.id,organizationId:employer.org.id,role,active:true});
  const session=await standaloneMakeSession(user.id);await db.update(s.sessions).set({mfaVerifiedAt:new Date()}).where(eq(s.sessions.id,session.id));
  return{...user,cookie:session.cookie};
 }
 const payroll=await actor('payroll'),checker=await actor('checker');
 assert.notEqual(payroll.id,checker.id);assert.notEqual(payroll.cookie,checker.cookie);
 const [worker]=await db.insert(s.employees).values({organizationId:employer.org.id,legalEntityId:employer.entity.id,orgUnitId:employer.unit.id,employeeNo:`BROWSER-${nonce}`,firstName:'Fictional',lastName:'Browser payroll',title:'QA only',avatarInitials:'FB',basicRate:'30000.00',startDate:'2026-01-05',status:'Active'}).returning();
 const {encryptBankAccount}=await import('../../src/lib/bank-account-crypto.ts');
 await db.update(s.employees).set({bankCode:'BDO',bankAccount:encryptBankAccount('123456789012')}).where(eq(s.employees.id,worker.id));
 await db.insert(s.employeePayProfiles).values({organizationId:employer.org.id,employeeId:worker.id,payBasis:'monthly',rateAmount:'30000.00',standardWorkDaysPerMonth:'22',standardHoursPerDay:'8'});
 for(let day=1;day<=15;day++){
  const date=`2026-10-${String(day).padStart(2,'0')}`;if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))continue;
  await db.insert(s.timePunches).values({organizationId:employer.org.id,employeeId:worker.id,workDate:date,timeIn:new Date(date+'T01:00:00Z'),breakStart:new Date(date+'T04:00:00Z'),breakEnd:new Date(date+'T05:00:00Z'),timeOut:new Date(date+'T10:00:00Z'),source:'fictional-browser-journey'});
 }
 const template=`Fictional Browser CSV ${nonce}`;
 await db.insert(s.bankTemplates).values({name:template,version:'fictional-v1',format:'CSV',mappings:{columns:['employee_no','account_number','amount'],includeHeader:true},adapterStage:'draft',specSource:'unknown'});
 browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
 async function pageFor(user){
  const context=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{cookie:user.cookie}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===base.origin?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  return page;
 }
 const maker=await pageFor(payroll);
 await maker.goto(new URL('/app',base).href,{waitUntil:'networkidle'});
 await maker.getByRole('button',{name:/Create payroll|New payroll/}).first().click();
 const dialog=maker.getByRole('dialog',{name:'Create payroll draft'});
 await dialog.getByLabel('Period start',{exact:true}).fill('2026-10-01');
 await dialog.getByLabel('Period end',{exact:true}).fill('2026-10-15');
 await dialog.getByLabel('Pay date',{exact:true}).fill('2026-10-15');
 await dialog.getByRole('button',{name:'Create & process'}).click();
 await maker.getByRole('button',{name:'Submit to checker',exact:true}).waitFor({timeout:30000});
 assert.equal(await maker.getByRole('button',{name:'Release payroll',exact:true}).count(),0);
 steps.push('Payroll Officer created and calculated cutoff through browser');
 await maker.getByRole('button',{name:'Submit to checker',exact:true}).click();
 await maker.locator('article').filter({has:maker.getByRole('heading',{name:'Choose the checker for this payroll',exact:true})}).getByRole('combobox').selectOption(String(checker.id));
 await maker.getByRole('button',{name:'Submit for review',exact:true}).last().click();
 steps.push('Payroll Officer submitted to distinct Checker through browser');
 await maker.screenshot({path:'outputs/first-payroll-browser-maker.png',fullPage:true});
 const review=await pageFor(checker);
 await review.goto(new URL('/app?workspacePage=Approvals',base).href,{waitUntil:'networkidle'});
 await review.getByRole('button',{name:'Review payroll',exact:true}).click();
 await review.getByRole('region',{name:'Payroll approval evidence'}).waitFor();
 assert.equal(await review.getByRole('button',{name:'Release payroll',exact:true}).count(),0);
 await review.getByRole('button',{name:'Approve payroll',exact:true}).click();
 await review.getByRole('dialog',{name:'Confirm approval',exact:true}).getByRole('button',{name:'Confirm approval',exact:true}).click();
 await review.getByText('Ready for release',{exact:true}).first().waitFor();
 steps.push('Distinct Checker reviewed and approved through browser confirmation');
 await review.screenshot({path:'outputs/first-payroll-browser-checker.png',fullPage:true});
 const owner=await pageFor(employer);
 await owner.goto(new URL('/app',base).href,{waitUntil:'networkidle'});
 await owner.getByRole('button',{name:'View payroll details',exact:true}).click();
 await owner.getByRole('button',{name:'Release payroll',exact:true}).first().click();
 await owner.getByRole('dialog',{name:'Confirm payroll release'}).getByRole('button',{name:'Release payroll',exact:true}).click();
 await owner.getByText('Released and locked',{exact:true}).waitFor();
 steps.push('Owner released through browser confirmation');
 await owner.locator('button.register-row').filter({hasText:'Fictional Browser payroll'}).click();
 const pdfDownload=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Payslip browser download not observed')),15000);
  const done=download=>{clearTimeout(timer);resolve(download);};
  owner.once('download',done);owner.context().once('page',page=>page.once('download',done));
 });
 await owner.getByRole('button',{name:'Payslip PDF',exact:true}).click();
 const pdf=await pdfDownload;const pdfPath=await pdf.path();assert.ok(pdfPath);
 assert.ok(readFileSync(pdfPath).subarray(0,8).toString().startsWith('%PDF-1.4'));
 assert.ok(readFileSync(pdfPath).includes(Buffer.from('13271.30')),'PDF preserves exact net centavos');
 steps.push('Owner opened generated payslip PDF through browser');
 await owner.getByRole('button',{name:'Open exports',exact:true}).first().click();
 await owner.getByRole('combobox').filter({has:owner.getByRole('option',{name:`${template} · fictional-v1`,exact:true})}).selectOption(template);
 await owner.getByRole('button',{name:'Generate file',exact:true}).click();
 const bankDownload=owner.waitForEvent('download');
 await owner.getByRole('button',{name:`Generate ${template}`,exact:true}).click();
 const download=await bankDownload;const file=await download.path();assert.ok(file);
 const runs=await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId,employer.org.id));
 assert.equal(runs.length,1);const entries=await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId,runs[0].id));reconcileFirstPayroll(runs[0],entries);
 assert.equal(runs[0].status,'Released');assert.equal(runs[0].grossPay,'15000.00');assert.equal(runs[0].netPay,'13271.30');
 assert.equal(readFileSync(file,'utf8'),`"employee_no","account_number","amount"\n"BROWSER-${nonce}","123456789012","13271.30"`);
 steps.push('Owner downloaded exact fictional bank CSV through browser');
 assert.deepEqual(errors,[]);
 for(const width of [1280,390]){await owner.setViewportSize({width,height:900});await owner.screenshot({path:`outputs/first-payroll-browser-owner-${width}.png`,fullPage:true});}
 writeFileSync('outputs/first-payroll-browser-progress.json',JSON.stringify({steps,errors},null,2));
 writeFileSync('outputs/first-payroll-browser-journey.json',JSON.stringify({result:'PASS',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),steps,gross:runs[0].grossPay,net:runs[0].netPay,providerCalls:0,coverageCredits:0,authentication:'distinct seeded fictional MFA-verified sessions; password/email/MFA enrollment not exercised',setup:'SQL-only fictional employee/pay profile/punch/template fixtures; payroll lifecycle driven by browser controls, no intercepted API responses'},null,2));
 console.log('PASS full local browser payroll create, submit, checker approve, owner release, PDF and exact CSV');
}catch(error){if(browser){for(const context of browser.contexts())for(const page of context.pages())console.error('BROWSER_STATE '+(await page.locator('body').innerText()).slice(-18000));}throw error;}
finally{if(browser)await browser.close();await pool.end();}
