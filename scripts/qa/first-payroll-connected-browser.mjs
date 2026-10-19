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
const focus=resolveFirstPayrollRunFocus({enabled,demoMode:false,requestedPage:params.get('workspacePage'),requestedOrganizationId:params.get('organizationId'),requestedRunId:params.get('focusPayrollRunId'),organizationId:1,access:data.access,authorizedRuns:data.payrollRuns});
window.fixtureFocus=focus;
function LegacyQueue(){const [org,setOrg]=useState(1);return <><button onClick={()=>setOrg(2)}>Switch fixture employer</button><StatutoryRemittanceActionQueue organizationId={org} notify={()=>{}}/></>;}
createRoot(document.getElementById('root')).render(<main>{params.get('queue')==='legacy'?<LegacyQueue/>:focus!==null?<PayrollRunView data={data} initialRunId={focus} busy={false} onNewRun={()=>{}} onProcess={async()=>{}} onRelease={async()=>({})} onDecide={async()=>{}} onPage={()=>{}} onRefresh={async()=>{}} notify={()=>{}} availablePages={['Payroll','People','Exports']}/>:<FirstPayrollReadinessCard readiness={readiness} guided inlineEnabled data={data} onRefresh={async()=>{}} allowedPages={['Payroll','Settings','People','Exports']} onNewRun={()=>{}} onPage={()=>{}}/>}</main>);`,resolveDir:process.cwd(),sourcefile:'first-payroll-connected.tsx',loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},outfile:output+'/bundle.js'});
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
   if(url.pathname==='/api/first-payroll/progress')return route.fulfill({json:{progress:null}});
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
}await writeFile(output+'/results.json',JSON.stringify({result:'PASS',sourceHead:process.env.PR_HEAD_SHA??'local',results,
 boundary:'Actual UI components and navigation resolver with fictional authorized snapshot and stubbed GETs; not authenticated API, financial calculation, physical-device or live deployment proof.'},null,2));console.log('PASS first-payroll connected components: desktop + 390px, flag-off and negative navigation cases');}
finally{await browser.close();await new Promise(r=>server.close(r));}
