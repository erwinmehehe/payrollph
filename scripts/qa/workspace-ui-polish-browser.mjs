/** Actual components with fictional read-only transport; no database or production traffic. */
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {build} from "esbuild";
const {chromium}=await import(process.env.QA_PLAYWRIGHT_MODULE ?? "playwright");
const entry=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {WorkspaceShell} from './src/components/workspace/shell';
import {WorkforceLiveFloor} from './src/components/workspace/workforce-live-floor';
import {WorkforceOperationsInbox} from './src/components/workspace/workforce-operations-inbox';
import {WorkforcePlanningPanel} from './src/components/workforce-planning-panel';
import {CompensationPanel} from './src/components/compensation-panel';
import {SpendOperationsPanel} from './src/components/spend-operations-panel';
import {AccountPanel} from './src/components/account-panel';
import {Employee360Overview} from './src/components/employee-360-overview';
import {dashboardFixture} from './tests/fixtures/dashboard-ui';
const view=new URLSearchParams(location.search).get('view')||'workforce';
const employee={id:1,firstName:'Fictional',lastName:'Worker',name:'Fictional Worker',employeeNo:'QA-001'};
window.__qaActions=[];const action=(name)=>window.__qaActions.push(name);
window.fetch=async(input,options)=>{
 if(options?.method && options.method!=='GET')throw Error('This fixture allows reads only');
 const url=String(input);let body={};
 if(url.includes('/live-floor?'))body={page:1,totalEmployees:1,hasMore:false,unresolvedSchedules:0,generatedAt:'2026-10-24T05:28:00Z',timezone:'Asia/Manila',workDate:'2026-10-24',rows:[],summary:{shiftSegments:0,requiresReview:0,recordedIn:0,recordedOut:0,scheduledLater:0,approvedLeave:0}};
 else if(url.includes('/attendance-exception-events?'))body={summary:{open:5,overdue:0,unassigned:5,resolved:0}};
 else if(url.includes('/timesheets?'))body={manager:true,latest:[],expectations:[],policy:{active:true,enforcementMode:'advisory'}};
 else if(url.includes('/workforce-planning'))body={profiles:[],jobFamilies:[],jobLevels:[],jobGrades:[],plans:[],positions:[],assignments:[],orgUnits:[],legalEntities:[],costCenters:[],worksites:[],shifts:[],employees:[employee],scenarios:[],baselines:[],executions:[],approvalConfiguration:{configured:false,conflict:false,policy:null},access:{canApply:false}};
 else if(url.includes('/compensation?'))body={access:{companyWide:true,role:'owner',orgUnitName:null},advancedConfigurationAllowed:true,employees:[employee],jobProfiles:[],jobGrades:[],legalEntities:[],bands:[],cycles:[],proposals:[],components:[],componentAssignments:[],promotions:[],compensationEvents:[]};
 else if(url.includes('/spend?'))body={employees:[employee],cards:[],transactions:[],reports:[],unreportedClaims:[]};
 else if(url.includes('/expenses?'))body={claims:[],employees:[employee],reimbursementReviewEnabled:false};
 else if(url.includes('/employees?'))body=[employee];
 else if(url==='/api/account')body={profile:{id:1,name:'Fictional Owner',email:'owner@example.invalid',role:'owner',createdAt:'2026-10-19T03:45:00Z'},security:{totpEnabled:false,backupCodes:0,sessionDays:14,accountLockedUntil:null},sessions:[],summary:{total:0,active:0,otherActive:0,expired:0,revoked:0}};
 return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};
const common={organizationId:1,setNotice:action,onPage:action};
const cards=['employment','onboarding','documents','leave','performance','compensation','payroll','history'].map((id,i)=>({id,title:['Employment','Onboarding','Documents','Leave','Performance','Compensation','Payroll evidence','Employment history'][i],value:i===1?'In progress':i>3?'Not linked':'Fictional source snapshot',detail:'Review the linked source record. An empty snapshot does not verify completion.',source:'Authorized fictional source records',available:i!==4,targetId:'employee-360-'+id,tone:'neutral'}));
const content=view==='workforce'?<div className='workspace-panel workforce-workspace'><WorkforceLiveFloor {...common}/><WorkforceOperationsInbox {...common} onOpenTab={action} onOpenAttendance={()=>action('attendance')}/></div>
 :view==='planning'?<WorkforcePlanningPanel {...common}/>:view==='compensation'?<CompensationPanel {...common}/>
 :view==='spend'?<SpendOperationsPanel {...common}/>:view==='account'?<AccountPanel onNotice={action}/>
 :<div style={{maxWidth:760,margin:'0 auto'}}><Employee360Overview employeeNo='QA-001' cards={cards}/>{cards.map(c=><h3 key={c.id} id={c.targetId}>{c.title} source</h3>)}</div>;
createRoot(document.getElementById('root')).render(<WorkspaceShell data={{...dashboardFixture,user:{id:1,name:'Fictional Owner',role:'owner'}}} page={view==='workforce'?'Workforce':view==='planning'?'Planning':view==='compensation'?'Compensation':view==='spend'?'Expenses':view==='account'?'Settings':'People'} onPage={action} notifications={[]} onOpenPalette={()=>{}} onSwitchClient={()=>{}} onSignOut={()=>{}} workspaceRole='owner'>{content}</WorkspaceShell>);
`;
const result=await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd(),sourcefile:'ui-polish.tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'});
const css=['globals','workspace-theme','dashboard-design','workspace-panels','workspace-operations-layout','ess-mobile','premium-dashboard','phase-two','experience-refresh','workspace-ui-polish'].map(name=>readFileSync('src/app/'+name+'.css','utf8')).join('\n');
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(result.outputFiles[0].text);return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--font-inter:Arial;--font-jetbrains-mono:monospace}'+css+'</style><div id="root"></div><script src="/fixture.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
mkdirSync('outputs/ui-polish',{recursive:true});const checks=[];
try{
 for(const width of [1440,820,390,320].filter(w=>!process.env.QA_WIDTH||w===Number(process.env.QA_WIDTH)))for(const view of ['workforce','planning','compensation','spend','account','people'].filter(v=>!process.env.QA_VIEW||v===process.env.QA_VIEW)){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?view='+view);
  const root=page.locator(view==='workforce'?'.workforce-floor-filters':view==='planning'?'.planning-empty':view==='compensation'?'.component-option':view==='spend'?'.spend-form':view==='account'?'.account-workspace':'.employee-360-card').first();await root.waitFor();
  if(view==='workforce'){
   await page.getByRole('button',{name:'Open source review →'}).first().waitFor();
   await page.getByRole('button',{name:'Open source review →'}).first().click();
   assert.ok((await page.evaluate(()=>window.__qaActions)).includes('attendance'));
   const field=page.getByPlaceholder('Name, employee no. or shift');assert.ok(await field.evaluate(el=>el.clientWidth>180));
  }
  if(view==='planning'){
   assert.equal(await page.locator('.planning-empty').count(),3);
   assert.ok(await page.locator('.planning-empty').first().evaluate(el=>el.getBoundingClientRect().height<120));
   assert.equal(await page.locator('.planning-stage table thead').first().isVisible(),false);
  }
  if(view==='compensation'){
   const cb=page.getByLabel('Include in SSS base',{exact:true});await cb.uncheck();assert.equal(await cb.isChecked(),false);await cb.check();
   const bounds=await cb.evaluate(el=>({x:el.getBoundingClientRect().x,parent:el.parentElement.getBoundingClientRect().x}));assert.ok(bounds.x-bounds.parent<20);
  }
  if(view==='spend'){
   const issuer=page.getByLabel('Issuer',{exact:true});await issuer.fill('Fictional Bank');assert.ok(await issuer.evaluate(el=>el.clientHeight>=40));
   await page.getByLabel('Last 4 digits',{exact:true}).fill('1234');
  }
  if(view==='account'){await page.getByLabel('Name',{exact:true}).fill('Fictional New Owner');assert.ok(await page.getByLabel('Name',{exact:true}).evaluate(el=>el.clientHeight>=40));}
  if(view==='people'){
   const cards=page.locator('.employee-360-card');assert.equal(await cards.count(),8);assert.equal(await page.getByRole('button',{name:'Review Performance details'}).isDisabled(),true);
   await page.getByRole('button',{name:'Review Employment details'}).click();assert.equal(await page.evaluate(()=>document.activeElement?.id),'employee-360-employment');
   await page.getByText('About these source records',{exact:true}).click();assert.ok(await page.getByText(/Missing history or an empty queue/).isVisible());
  }
  assert.deepEqual(errors,[],view+'/'+width+' runtime');
  const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
  if(!fits) console.log(JSON.stringify(await page.evaluate(()=>Array.from(document.querySelectorAll('main *,.app-main *')).map(el=>({tag:el.tagName,cls:el.className,x:el.getBoundingClientRect().x,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(r=>r.right>innerWidth+1||r.x<0).slice(0,20))));
  assert.ok(fits,view+'/'+width+' viewport overflow');
  if(width===1440)assert.equal(await page.locator('.side-profile strong').evaluate(el=>getComputedStyle(el).color),'rgb(32, 59, 50)');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'outputs/ui-polish/'+view+'-'+width+'.png',fullPage:true});checks.push({view,width,passed:true});await page.close();
 }
 console.log('PASS: '+checks.length+' actual-component desktop/tablet/mobile layouts and keyboard/form interactions.');
}finally{writeFileSync('outputs/ui-polish/report.json',JSON.stringify(checks,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
