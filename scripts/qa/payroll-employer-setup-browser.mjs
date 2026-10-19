import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.QA_PLAYWRIGHT_MODULE??'playwright');
const out='qa-artifacts/payroll-employer-setup';await mkdir(out,{recursive:true});
const baseline=execFileSync('git',['show',`${process.env.QA_BASE_SHA??'6ed981427fd9e963c0ac8008750a316843f9f5c1'}:src/components/workspace/panels.tsx`],{encoding:'utf8',maxBuffer:4e6});
await build({stdin:{contents:`import {createRoot} from 'react-dom/client';import {useState} from 'react';
import {NewPayrollModal} from './src/components/workspace/panels';import {NewPayrollModal as Baseline} from 'baseline-panels';
import {EmployerSetupHelp} from './src/components/workspace/employer-setup-help';
const mode=new URLSearchParams(location.search).get('mode');
function Harness(){const [opened,setOpened]=useState(false);const onOpen=mode==='restricted'?undefined:()=>setOpened(true);
if(opened)return <h1>Employer setup destination</h1>;
if(mode==='entities')return <EmployerSetupHelp entitiesPage onOpen={onOpen}/>;
const Modal=mode==='baseline'?Baseline:NewPayrollModal;
return <Modal organizationId={42} onClose={()=>{}} onCreate={()=>{throw Error('Unexpected payroll mutation')}} busy={false}
 employerSetupNavigationEnabled={!['off','baseline'].includes(mode)} onOpenEmployerSetup={onOpen}/>;}
createRoot(document.getElementById('root')).render(<Harness/>);`,resolveDir:process.cwd(),sourcefile:'employer-setup.tsx',loader:'tsx'},
 bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"','process.env':'{}'},outfile:out+'/bundle.js',
 plugins:[{name:'baseline',setup(b){b.onResolve({filter:/^baseline-panels$/},()=>({path:'panels.tsx',namespace:'baseline'}));b.onLoad({filter:/.*/,namespace:'baseline'},()=>({contents:baseline,loader:'tsx',resolveDir:resolve('src/components/workspace')}));}}]});
const bundle=await readFile(out+'/bundle.js');
const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const cssFiles=['globals.css','workspace-theme.css','dashboard-design.css','workspace-panels.css','ess-mobile.css','premium-dashboard.css','phase-two.css','experience-refresh.css'];
const raw=(await Promise.all(cssFiles.map(f=>readFile('src/app/'+f,'utf8')))).join('\n');
const css=(await postcss([tailwind()]).process(raw,{from:resolve('src/app/globals.css')})).css;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
const results=[];
try{for(const width of [1440,390]){
 let offHtml;
 for(const mode of ['baseline','off','empty','error','restricted','ready','entities']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],writes=[];let requests=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const req=route.request();assert.equal(new URL(req.url()).searchParams.get('organizationId'),'42');
   if(req.method()!=='GET')writes.push(req.method());requests++;await new Promise(r=>setTimeout(r,200));
   if(mode==='error'&&requests===1)return route.fulfill({status:503,json:{error:'fictional failure'}});
   return route.fulfill({json:{legalEntities:mode==='ready'?[{id:7,code:'PRIMARY',displayName:'Fictional employer',primaryEntity:true}]:[]}});
  });
  await page.goto(base+'?mode='+mode);
  if(mode==='entities'){
   await page.getByRole('heading',{name:'Manage your legal employer'}).waitFor();
  }else{
   await page.getByRole('dialog',{name:'Create payroll draft'}).waitFor();
   if(mode==='empty'){await page.getByRole('option',{name:'Loading legal employers…'}).waitFor({state:'attached'});await page.screenshot({path:out+'/loading-'+width+'.png'});}
   await page.waitForFunction(()=>!document.querySelector('select')?.disabled);
   const create=page.getByRole('button',{name:'Create & process',exact:true});
   assert.equal(await create.isDisabled(),mode!=='ready');
  }
  if(mode==='baseline')offHtml=await page.locator('#root').innerHTML();
  if(mode==='off'){assert.equal(await page.locator('#root').innerHTML(),offHtml);assert.equal(await page.getByRole('button',{name:'Open employer setup'}).count(),0);}
  if(mode==='error'){
   await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('heading',{name:'Set up a legal employer first'}).count(),0);
   await page.screenshot({path:out+'/error-'+width+'.png',fullPage:true});
   await page.getByRole('button',{name:'Retry legal employers'}).click();await page.getByRole('heading',{name:'Set up a legal employer first'}).waitFor();assert.equal(requests,2);
  }
  if(mode==='restricted'){
   await page.getByText('Ask a company-wide owner or administrator to complete employer setup.').waitFor();
   assert.equal(await page.getByRole('button',{name:'Open employer setup'}).count(),0);
  }
  await page.screenshot({path:out+'/'+mode+'-'+width+'.png',fullPage:true});
  if(mode==='empty'){
   await page.getByRole('button',{name:'Create & process',exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:out+'/empty-footer-'+width+'.png'});
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow');
  if(['empty','entities'].includes(mode)){
   await page.getByRole('button',{name:'Open employer setup'}).focus();await page.keyboard.press('Enter');
   await page.getByRole('heading',{name:'Employer setup destination'}).waitFor();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);results.push({width,mode,result:'PASS',requests});await page.close();
 }
}
await writeFile(out+'/results.json',JSON.stringify({results,boundary:'Actual React components with fictional intercepted HTTP. Baseline/off DOM equality; not authenticated API or database proof.'},null,2));
console.log(JSON.stringify({result:'PASS',scenarios:results.length,widths:[1440,390],flagOffBaselineParity:true,mutations:0}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
