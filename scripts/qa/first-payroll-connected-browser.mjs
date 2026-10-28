import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE??'playwright');
const output='qa-artifacts/first-payroll-connected';await mkdir(output,{recursive:true});
await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {FirstPayrollReadinessCard} from './src/components/workspace/first-payroll-readiness';
import {PayrollRunView} from './src/components/workspace/payroll-run';
import {resolveFirstPayrollRunFocus} from './src/lib/first-payroll-run-navigation';
import {buildFirstPayrollReadiness} from './src/lib/first-payroll-readiness';
import {dashboardFixture,sampleRun} from './tests/fixtures/dashboard-ui';
import {StatutoryRemittanceActionQueue} from './src/components/workspace/statutory-remittance-action-queue';
const params=new URLSearchParams(location.search),enabled=params.get('mode')!=='off';
const readiness=buildFirstPayrollReadiness({workspaceName:'Fictional Employer',employees:[{status:'Active',bankCode:'TEST',bankAccount:'fictional'}],memberships:[{role:'payroll'},{role:'checker'}],payrollStatuses:['Draft']});
const data={...dashboardFixture,firstPayrollConnectedEnabled:enabled,user:{id:1,name:'Fictional payroll',role:'payroll'},payrollRuns:[{...sampleRun,id:43,legalEntityId:7,status:'Draft',employeeCount:1,grossPay:'0',netPay:'0',exceptions:0},{...sampleRun,id:42,legalEntityId:7,status:'Needs review',periodLabel:'Saved fictional payroll',employeeCount:1,grossPay:'15000',netPay:'13500',exceptions:0}],firstPayrollReadiness:readiness,access:{role:'payroll',companyWide:true}};
function JourneyFixture({kind}){const [destination,setDestination]=useState(null);const role=params.get('viewerRole')??(kind==='time'?'hr':'owner');
const state=buildFirstPayrollReadiness({workspaceName:'Fictional Employer',employees:[{status:'Active',bankCode:kind==='people'?'':'TEST',bankAccount:kind==='people'?'':'fictional'}],memberships:[{role:'payroll'},{role:'checker'}],payrollStatuses:[]});
const current={...data,payrollRuns:[],firstPayrollReadiness:state,user:{id:1,name:'Fictional reviewer',role},access:{role,companyWide:true}};
return destination?<h1>{destination} destination</h1>:<FirstPayrollReadinessCard readiness={state} guided inlineEnabled data={current} onRefresh={async()=>{if(kind==='reviewers')throw Error('Fictional workspace refresh failure');}}
allowedPages={['Settings','People','Time & attendance','Payroll','Approvals','Exports'].filter(page=>page!=='People'||params.get('denyPeople')!=='1')} onPage={setDestination} onNewRun={()=>{}}/>;}
const focus=resolveFirstPayrollRunFocus({enabled,demoMode:false,requestedPage:params.get('workspacePage'),requestedOrganizationId:params.get('organizationId'),requestedRunId:params.get('focusPayrollRunId'),organizationId:1,access:data.access,authorizedRuns:data.payrollRuns});
window.fixtureFocus=focus;
function LegacyQueue(){const [org,setOrg]=useState(1);return <><button onClick={()=>setOrg(2)}>Switch fixture employer</button><StatutoryRemittanceActionQueue organizationId={org} notify={()=>{}}/></>;}
createRoot(document.getElementById('root')).render(<main>{params.get('journeyCase')?<JourneyFixture kind={params.get('journeyCase')}/>:params.get('queue')==='legacy'?<LegacyQueue/>:focus!==null?<PayrollRunView data={data} initialRunId={focus} busy={false} onNewRun={()=>{}} onProcess={async()=>{}} onRelease={async()=>({})} onDecide={async()=>{}} onPage={()=>{}} onRefresh={async()=>{}} notify={()=>{}} availablePages={['Payroll','People','Exports']}/>:<FirstPayrollReadinessCard readiness={readiness} guided inlineEnabled data={data} onRefresh={async()=>{}} allowedPages={['Payroll','Settings','People','Exports']} onNewRun={()=>{}} onPage={()=>{}}/>}</main>);`,resolveDir:process.cwd(),sourcefile:'first-payroll-connected.tsx',loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},outfile:output+'/bundle.js'});
const bundle=await readFile(output+'/bundle.js');
const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const cssFiles=['globals.css','workspace-theme.css','dashboard-design.css','workspace-panels.css',
 'ess-mobile.css','premium-dashboard.css','phase-two.css','experience-refresh.css'];
const css=(await Promise.all(cssFiles.map(async file=>{
 const path='src/app/'+file,source=await readFile(path,'utf8');
 return (await postcss([tailwind()]).process(source,{from:path})).css;
}))).join('\n');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n:root{--line:#dce5ed;--muted:#536983;--canvas-subtle:#f8fafc;}body{margin:0;font-family:Arial;color:#10213d}main{max-width:1120px;margin:24px auto;padding:16px}a,button{min-height:44px}a:focus-visible,button:focus-visible{outline:3px solid #0877ff;outline-offset:3px}</style><div id="root"></div><script src="/bundle.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
const results=[];
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
 let rejectRegisterOnce=true;
 let releasePreview;const previewReady=new Promise(resolve=>{releasePreview=resolve;});
 let releaseEmployerB;const employerBReady=new Promise(resolve=>{releaseEmployerB=resolve;});
 page.on('pageerror',e=>{errors.push(e.message);console.error('COMPONENT_ERROR '+e.stack);});
 await page.route('**/api/**',async route=>{
   const req=route.request();if(req.method()!=='GET')writes.push(req.method()+' '+new URL(req.url()).pathname);
   const url=new URL(req.url());
   if(new URL(page.url()).searchParams.get('queue')==='legacy'){
     const organizationId=req.postDataJSON()?.organizationId??Number(url.searchParams.get('organizationId'));
     if(organizationId===2)await employerBReady;
     return route.fulfill({json:{organizationId,currentUserId:1,assignees:[],sync:{created:0},tasks:[{id:organizationId,organizationId,sourceKey:'fictional',agency:null,applicableMonth:null,severity:'info',title:'Private employer '+organizationId,detail:'Fictional saved action',dueDate:null,status:'open',assignedToUserId:null,assignedToName:null,acknowledgedByName:null,acknowledgedAt:null,resolvedAt:null,ageHours:0,severityAgeHours:0,escalationStage:0}]}});
   }
   if(url.pathname.endsWith('/connected-impact'))return route.fulfill({status:204});
   if(url.pathname==='/api/compliance/remittance-actions'){
     if(req.method()==='POST')return route.fulfill({json:{organizationId:1,currentUserId:1,assignees:[],tasks:[],sync:{created:0}}});
     await new Promise(resolve=>setTimeout(resolve,300));
     return route.fulfill({status:403,json:{error:'Unavailable in isolated component fixture'}});
   }
   if(url.pathname==='/api/first-payroll/progress')return route.fulfill({json:{organizationId:1,progress:null}});
   if(url.pathname==='/api/invitations'&&req.method()==='POST')return route.fulfill({json:{invitation:{id:1}}});
   if(url.pathname==='/api/first-payroll/preview'){
     await previewReady;
     return route.fulfill({json:{organizationId:1,periodStart:url.searchParams.get('periodStart'),periodEnd:url.searchParams.get('periodEnd'),payDate:url.searchParams.get('payDate'),
       dryRun:true,persisted:false,previewReady:true,blockers:[],warnings:[],rows:[{employeeId:1,employeeNo:'EMP-1',name:'Fictional employee',gross:15000,sss:500,philHealth:250,pagIbig:100,withholding:0,net:14150,blockers:[]}]}});
   }
   if(url.pathname==='/api/payroll-runs'){
     const runId=Number(url.searchParams.get('runId'));
     if(![42,43].includes(runId))return route.fulfill({status:404,json:{error:'Fictional run not found'}});
     // The fixture must model the authorized full response envelope, not
     // the old unchecked {entries:[]} body that now rightly fails closed.
     if(new URL(page.url()).searchParams.get('badRegister')==='1'&&rejectRegisterOnce){
       rejectRegisterOnce=false;
       return route.fulfill({json:{organizationId:2,legalEntityId:7,runId,entries:[]}});
     }
     return route.fulfill({json:{organizationId:1,legalEntityId:7,runId,entries:[]}});
   }
   if(url.pathname.endsWith('/release-checklist'))return route.fulfill({json:{ready:false,items:[]}});
   return route.fulfill({status:403,json:{error:'Unavailable in isolated component fixture'}});
 });
 const journeyFailures=[];
 for(const kind of ['people','time','preview','reviewers'])try{
   await page.goto(base+'/?journeyCase='+kind);
   await page.getByRole('button',{name:kind==='people'?'Open people':kind==='time'?'Review attendance':kind==='reviewers'?'Review team access':'Prepare payroll',exact:true}).click();
   if(kind==='people'){
     const openPeople=page.getByRole('button',{name:'Open People to edit payout details',exact:true});
     assert.equal(await openPeople.count(),1,'Existing employee payout blockers need a route to edit People, not another hire form');
     const payoutBounds=await openPeople.evaluate(button=>{const region=button.closest('section').getBoundingClientRect(),control=button.getBoundingClientRect();return {regionLeft:region.left,regionRight:region.right,left:control.left,right:control.right};});
     assert.ok(payoutBounds.left>=payoutBounds.regionLeft&&payoutBounds.right<=payoutBounds.regionRight,'Payout navigation must fit its nested mobile panel: '+JSON.stringify(payoutBounds));
     await page.screenshot({path:output+'/journey-payout-edit-'+width+'.png',fullPage:true});
     await openPeople.focus();await openPeople.press('Enter');await page.getByRole('heading',{name:'People destination'}).waitFor();
     for(const restriction of ['denyPeople=1','viewerRole=payroll']){
       await page.goto(base+'/?journeyCase=people&'+restriction);await page.getByRole('button',{name:'Open people',exact:true}).click();
       assert.equal(await page.getByRole('button',{name:'Open People to edit payout details',exact:true}).count(),0,'Payout recovery cannot grant new People permissions');
     }
   }else if(kind==='time'){
     await page.getByLabel('Pay period start',{exact:true}).fill('2026-10-01');await page.getByLabel('Pay period end',{exact:true}).fill('2026-10-15');
     const acknowledgment=page.getByRole('checkbox');await acknowledgment.check();
     await page.getByLabel('Pay period end',{exact:true}).fill('2026-10-16');
     assert.equal(await acknowledgment.isChecked(),false,'Changing the reviewed period must require a fresh human acknowledgment');
     assert.equal(await page.getByRole('button',{name:'Record authorized human review',exact:true}).isDisabled(),true);
     await acknowledgment.check();
     assert.equal(await page.getByRole('button',{name:'Record authorized human review',exact:true}).isEnabled(),true,'The new period is actionable after a fresh explicit acknowledgment');
   }else if(kind==='reviewers'){
     const email=page.getByLabel('Work email',{exact:true});await email.fill('fictional-payroll@example.invalid');
     await page.getByRole('button',{name:'Invite payroll',exact:true}).click();
     await page.getByRole('alert').filter({hasText:'refresh'}).waitFor();
     assert.equal(await email.inputValue(),'','A committed invitation must not be presented as failed or left ready to resend when only refresh failed');
     await page.getByText('Invitation sent for payroll; acceptance still required.',{exact:true}).waitFor();
     assert.equal(await page.getByRole('button',{name:'Invite payroll',exact:true}).isDisabled(),true,'A refresh failure must not leave the committed invitation ready to resend');
   }else{
     await page.getByLabel('Period start',{exact:true}).fill('2026-10-01');await page.getByLabel('Period end',{exact:true}).fill('2026-10-15');await page.getByLabel('Pay date',{exact:true}).fill('2026-10-15');
     const previewButton=page.getByRole('button',{name:'Preview first payroll (no writes)',exact:true});
     await Promise.all([page.waitForRequest('**/api/first-payroll/preview?**'),previewButton.click()]);
     await page.getByLabel('Period end',{exact:true}).fill('2026-10-31');await page.getByLabel('Pay date',{exact:true}).fill('2026-10-31');releasePreview();
     await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Preview first payroll (no writes)'&&!b.disabled));
     assert.equal(await page.getByText('Preview ready for reconciliation',{exact:true}).count(),0,'A delayed preview for the old cutoff cannot authorize the newly selected cutoff');
     assert.equal(await page.getByRole('button',{name:'Create actual draft payroll (writes a draft record)',exact:true}).count(),0);
     await page.getByText('Pay-period details changed. Preview this period again before creating a draft.',{exact:true}).waitFor();
     await previewButton.click();await page.getByText('Preview ready for reconciliation',{exact:true}).waitFor();
     assert.equal(await page.getByRole('button',{name:'Create actual draft payroll (writes a draft record)',exact:true}).isEnabled(),true,'A fresh preview of the current cutoff restores the explicit draft action');
     const table=page.getByRole('region',{name:'First payroll per-employee preview',exact:true});
     if(width===390)assert.equal(await table.evaluate(e=>e.scrollWidth>e.clientWidth),true,'Wide payroll evidence must scroll inside its own region on mobile');
   }
   await page.screenshot({path:output+'/journey-'+kind+'-'+width+'.png',fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,kind+' journey must fit the viewport');
 }catch(error){journeyFailures.push(kind+': '+error.message);}
 releasePreview();assert.deepEqual(journeyFailures,[],'First-payroll product journey regressions');
 assert.deepEqual(writes,['POST /api/invitations'],'Only the explicit invitation button writes during journey repair checks');writes.length=0;
 await page.goto(base+'/?mode=off');
 await page.getByRole('button',{name:'Open payroll',exact:true}).click();
 await page.getByRole('button',{name:'Preview first payroll (no writes)',exact:true}).waitFor();
 assert.equal(await page.locator('a[href*="focusPayrollRunId"]').count(),0);
 await page.screenshot({path:output+'/flag-off-'+width+'.png',fullPage:true});
 await page.goto(base+'/');const resume=page.getByRole('link',{name:'Open payroll',exact:true});
 assert.equal(await resume.getAttribute('href'),'/app?organizationId=1&workspacePage=Payroll&focusPayrollRunId=43');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Readiness must fit the viewport');
 await resume.focus();assert.equal(await resume.evaluate(e=>e===document.activeElement),true);
 await page.screenshot({path:output+'/resume-'+width+'.png',fullPage:true});
 await resume.press('Enter');await page.waitForURL('**/app?**');
 await page.getByRole('region',{name:'Payroll Officer run workflow'}).waitFor();
 assert.equal(await page.evaluate(()=>window.fixtureFocus),43);
 await page.screenshot({path:output+'/draft-'+width+'.png',fullPage:true});
 await page.goto(base+'/app?organizationId=1&workspacePage=Payroll&focusPayrollRunId=43&badRegister=1');
 await page.getByRole('button',{name:'Retry register'}).waitFor();
 assert.equal(await page.getByRole('region',{name:'Payroll Officer run workflow'}).count(),0,
   'A foreign-employer register must not unlock payroll controls');
 assert.equal(await page.getByRole('region',{name:'Payroll workflow overview'}).count(),0,
   'A foreign-employer register must not advertise payroll lifecycle readiness');
 assert.equal(await page.locator('.payroll-detail .run-stats').count(),0,
   'Gross, deductions and net must stay hidden until register verification');
 await page.screenshot({path:output+'/unverified-register-'+width+'.png',fullPage:true});
 await page.getByRole('button',{name:'Retry register'}).click();
 await page.getByRole('region',{name:'Payroll Officer run workflow'}).waitFor();
 await page.goto(base+'/app?organizationId=1&workspacePage=Payroll&focusPayrollRunId=42');
 await page.getByText('Saved fictional payroll',{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>window.fixtureFocus),42,'Explicit saved run must win over newest run');
 const queue=page.locator('[data-remittance-action-queue]');
 await queue.getByRole('alert').waitFor();
 assert.equal(await queue.getByText('No unresolved statutory remittance actions.',{exact:true}).count(),0);
 await queue.getByRole('button',{name:'Retry reading actions',exact:true}).click();
 await queue.getByText('Loading or verifying statutory compliance actions…',{exact:true}).waitFor();
 assert.equal(await queue.getByText('No unresolved statutory remittance actions.',{exact:true}).count(),0);
 await queue.getByRole('alert').waitFor();
 assert.deepEqual(writes,[],'Opening, reloading and retrying must remain read-only');
 await queue.getByRole('button',{name:'Sync',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('[data-remittance-action-queue] button[disabled]'));
 await queue.getByText('No unresolved statutory remittance actions.',{exact:true}).waitFor();
 assert.equal(await queue.getByRole('alert').count(),0,'Successful explicit Sync must clear the earlier read error');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Saved payroll must fit the viewport');
 assert.deepEqual(writes,['POST /api/compliance/remittance-actions'],'Only explicit Sync can mutate the action queue');
 writes.length=0;
 await page.screenshot({path:output+'/saved-'+width+'.png',fullPage:true});
 for(const query of ['organizationId=2&focusPayrollRunId=42','organizationId=1&focusPayrollRunId=999','mode=off&organizationId=1&focusPayrollRunId=42']){
   await page.goto(base+'/app?workspacePage=Payroll&'+query);
   await page.getByRole('region',{name:'First payroll setup readiness'}).waitFor();
   assert.equal(await page.evaluate(()=>window.fixtureFocus),null);
 }
 assert.deepEqual(writes,[],'Navigation cannot create, process, approve or release payroll');
 await page.goto(base+'/?queue=legacy');
 await page.getByText('Private employer 1',{exact:true}).waitFor();
 assert.deepEqual(writes,['POST /api/compliance/remittance-actions'],'Flag-off retains the legacy mount sync');
 await page.getByRole('button',{name:'Switch fixture employer',exact:true}).click();
 assert.equal(await page.getByText('Private employer 1',{exact:true}).count(),0,'Old employer actions must clear before new response');
 releaseEmployerB();await page.getByText('Private employer 2',{exact:true}).waitFor();
 assert.equal(await page.getByText('Private employer 1',{exact:true}).count(),0);
 assert.deepEqual(errors,[]);results.push({width,pass:true,cases:['flag-off legacy behavior','keyboard resume','exact saved run','foreign register blocks payroll workflow until Retry','failed read is not empty success','GET-only read retry','explicit Sync required','foreign employer denied','unknown run denied','flag-off focus denied'],navigationWrites:0,explicitSyncWrites:1});await page.close();
}await writeFile(output+'/results.json',JSON.stringify({result:'PASS',sourceHead:process.env.PR_HEAD_SHA??'local',journeyRepairs:['existing employee payout edit navigation','attendance date change resets acknowledgment','late cutoff preview cannot enable draft','committed invitation survives refresh failure','mobile preview table and actions fit their panel'],results,
 boundary:'Actual UI components and navigation resolver with fictional authorized snapshots and mocked API responses, including invitation POST; not authenticated API, financial calculation, physical-device or live deployment proof.'},null,2));console.log('PASS first-payroll connected components: desktop + 390px, flag-off and negative navigation cases');}
finally{await browser.close();await new Promise(r=>server.close(r));}
