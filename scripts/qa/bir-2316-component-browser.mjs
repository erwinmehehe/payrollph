import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { certificateSource, certificateReview } from '../../tests/fixtures/bir-2316-certificate.ts';
import { certificateSourceDigest } from '../../src/lib/bir-2316-source-digest.ts';
import { prepare2316Certificate } from '../../src/lib/bir-2316-certificate.ts';
import { render2316CertificatePdf } from '../../src/lib/bir-2316-pdf.ts';
const {chromium}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_MODULE ?? 'playwright');
await mkdir('qa-artifacts',{recursive:true});
await build({stdin:{contents:'import {createRoot} from "react-dom/client"; import {Certificate2316Review} from "./src/components/workspace/certificate-2316-review"; createRoot(document.getElementById("root")!).render(<Certificate2316Review organizationId={1} initialEmployeeId="1" initialTaxYear="2025"/>);',resolveDir:process.cwd(),sourcefile:'2316-component.tsx',loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:'qa-artifacts/2316-harness.js'});
const bundle=await readFile('qa-artifacts/2316-harness.js');
const server=createServer(async(req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
 if(req.url.startsWith('/api/')){
  if(req.method==='GET'){await new Promise(r=>setTimeout(r,500));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({source:certificateSource,sourceDigest:certificateSourceDigest(certificateSource)}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const {review,sourceDigest}=JSON.parse(Buffer.concat(chunks).toString());assert.equal(sourceDigest,certificateSourceDigest(certificateSource));
  const result=prepare2316Certificate(certificateSource,review);
  if(!result.ok){res.statusCode=422;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Complete the review.',issues:result.issues}));return;}
  res.setHeader('Content-Type','application/pdf');res.end(Buffer.from(await render2316CertificatePdf(certificateSource,review)));return;
 }
 res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><div role="alert" id="__next-route-announcer__"></div><script src="/bundle.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true, ...(process.env.QA_CHROMIUM_EXECUTABLE ? {executablePath:process.env.QA_CHROMIUM_EXECUTABLE} : {})});
const out='qa-artifacts/bir-2316-component';await mkdir(out,{recursive:true});
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('heading',{name:'Prepare an unsigned Form 2316'}).waitFor();
  await page.screenshot({path:out+'/empty-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'Load source records'}).click();await page.getByRole('status').waitFor();
  await page.screenshot({path:out+'/loading-'+width+'.png'});await page.getByRole('heading',{name:'Santos, Maria'}).waitFor();
  const review=certificateReview();for(const [key,value]of Object.entries(review.text))await page.locator('[name="'+key+'"]').fill(value);
  for(const [key,value]of Object.entries(review.detailItems))await page.locator('[name="item'+key+'"]').fill(value);
  await page.getByLabel('Employer type',{exact:true}).selectOption('main');await page.getByLabel('Previous employer review',{exact:true}).selectOption('none-confirmed');await page.locator('[name="pera"]').fill('0.00');await page.getByRole('checkbox').check();
  await page.locator('[name="item39"]').fill('500000.01');await page.getByRole('button',{name:'Check totals and generate unsigned PDF'}).click();await page.locator('.certificate-error').filter({hasText:'DETAIL_TOTAL_MISMATCH'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.certificate-error')===document.activeElement);await page.screenshot({path:out+'/error-'+width+'.png'});
  await page.locator('[name="item39"]').fill('500000.00');await page.getByRole('button',{name:'Check totals and generate unsigned PDF'}).click();await page.getByRole('link',{name:'Download unsigned PDF'}).waitFor();
  const pending=page.waitForEvent('download');await page.getByRole('link',{name:'Download unsigned PDF'}).click();const download=await pending;assert.equal(await download.failure(),null);await download.saveAs(out+'/unsigned-'+width+'.pdf');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:out+'/complete-'+width+'.png',fullPage:true});await page.screenshot({path:out+'/download-'+width+'.png'});await page.close();console.log('PASS component-only loading/error/focus/form/download/no-overflow '+width);
 }
 await writeFile(out+'/results.json',JSON.stringify({result:'PASS',headSha:process.env.PR_HEAD_SHA??'local',widths:[1280,390],checks:['empty','loading','error focus','explicit labels','PDF download','no horizontal overflow','no browser errors'],boundary:'Actual React component and PDF renderer with fictional source API responses; not authenticated API or database acceptance.'},null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
