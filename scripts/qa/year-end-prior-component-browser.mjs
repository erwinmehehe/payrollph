import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const {chromium}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_MODULE??'playwright');
const out='qa-artifacts/year-end-prior-component';await mkdir(out,{recursive:true});
await build({stdin:{contents:'import {createRoot} from "react-dom/client";import {YearEndPriorReview} from "./src/components/workspace/year-end-prior-review";createRoot(document.getElementById("root")!).render(<YearEndPriorReview organizationId={1} userId={2} employeeId="1" taxYear="2025"/>);',resolveDir:process.cwd(),sourcefile:'prior.tsx',loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:out+'/harness.js'});
const bundle=await readFile(out+'/harness.js');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:'<meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional prior evidence QA</title><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
try{for(const width of [1280,390]){
 const page=await browser.newPage({viewport:{width,height:900}});let record=null,fail=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/year-end/prior-evidence?*',async route=>{
  await new Promise(r=>setTimeout(r,250));
  if(fail)return route.fulfill({status:409,json:{code:'PRIOR_SOURCE_CHANGED'}});
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();
   if(body.action==='save'){assert.equal(body.expectedDigest,record?.digest??'');record={evidence:body.evidence,digest:'fictional-current-source',revision:(record?.revision??0)+1,approved:false,makerUserId:1};}
   else {assert.equal(body.expectedDigest,record.digest);record.approved=true;}
  }
  await route.fulfill({json:{record}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('heading',{name:'Previous employer & PERA review'}).waitFor();
 await page.screenshot({path:out+'/empty-'+width+'.png',fullPage:true});
 await page.getByRole('button',{name:'Load evidence',exact:true}).click();await page.getByRole('button',{name:'Working…'}).waitFor();await page.screenshot({path:out+'/loading-'+width+'.png'});
 await page.getByText('New draft',{exact:true}).waitFor();
 await page.getByLabel('Private 2316 or no-prior-employer declaration reference',{exact:true}).fill('private:fictional-declaration');
 await page.getByLabel('SHA-256 of the reviewed source document',{exact:true}).fill('a'.repeat(64));
 await page.getByRole('button',{name:'Save draft / revision'}).click();await page.getByText('Revision 1 · Awaiting independent checker',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Approve exact source'}).click();await page.getByText('Revision 1 · Approved',{exact:true}).waitFor();
 await page.screenshot({path:out+'/approved-'+width+'.png',fullPage:true});
 await page.getByLabel('Verified PERA tax credit amount (not contribution)',{exact:true}).fill('100.00');assert.equal(await page.getByRole('button',{name:'Approve exact source'}).isDisabled(),true);
 fail=true;await page.getByRole('button',{name:'Save draft / revision'}).click();await page.getByRole('alert').waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('role')==='alert');await page.screenshot({path:out+'/error-'+width+'.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 assert.equal(await page.evaluate(()=>Array.from(document.querySelectorAll('input,select')).every(e=>e.labels?.length>0)),true);
 await page.close();console.log('PASS prior component draft/checker/dirty/loading/error focus/labels/no overflow '+width);
}
 await writeFile(out+'/results.json',JSON.stringify({headSha:process.env.PR_HEAD_SHA??'local',result:'PASS',widths:[1280,390],boundary:'Actual React component with fictional intercepted API responses. Not authenticated API or database proof.'},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
