import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const {chromium}=createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_MODULE??'playwright');
const out='qa-artifacts/money-closes';await mkdir(out,{recursive:true});
await build({stdin:{contents:`import {createRoot} from "react-dom/client";import {FinalPaySignedReview} from "./src/components/final-pay-signed-review";
const mode=new URLSearchParams(location.search).get('mode');const record={id:1,employeeNo:'FICT',employeeName:'Fictional worker',grossFinalPay:mode==='unknown'?'invalid':'0.00',taxAdjustment:'-7500.00',finalStatutoryDeductions:'0.00',loanDeductions:'0.00',netFinalPay:'0.00',computationSnapshot:{unpaidTaxWithholding:7500,unpaidStatutoryDeductions:0}};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:760,margin:'32px auto',padding:16,fontFamily:'Arial',fontSize:16,lineHeight:1.6}}><h1>Fictional final-pay review</h1><p>Payable cash: ₱0.00</p>{mode!=='off'&&<FinalPaySignedReview record={record}/>}<button disabled>Approve final pay — mandatory shortfall unresolved</button></main>);`,resolveDir:process.cwd(),sourcefile:'money-closes.tsx',loader:'tsx'},bundle:true,platform:'browser',jsx:'automatic',outfile:out+'/harness.js'});
const bundle=await readFile(out+'/harness.js');const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle:'<meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional money review</title><div id="root"></div><script src="/bundle.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}:{})});
try{for(const width of [1280,390])for(const mode of ['deficit','unknown','off']){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?mode='+mode);await page.getByRole('heading',{name:'Fictional final-pay review'}).waitFor();
 if(mode==='off')assert.equal(await page.getByRole('region',{name:'Signed final-pay reconciliation'}).count(),0);
 else{await page.getByRole('region',{name:'Signed final-pay reconciliation'}).waitFor();assert.match(await page.getByRole('region',{name:'Signed final-pay reconciliation'}).innerText(),mode==='deficit'?/-₱7,500\.00/:/Unverified/);}
 assert.equal(await page.getByRole('button').isDisabled(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:out+'/'+mode+'-'+width+'.png',fullPage:true});await page.close();console.log('PASS actual signed-review component '+mode+' '+width);
}await writeFile(out+'/results.json',JSON.stringify({result:'PASS',sourceHead:process.env.PR_HEAD_SHA??'local',widths:[1280,390],cases:['deficit','unknown','off'],boundary:'Actual read-only component with fictional frozen fields; wrapper approval button is illustrative, not authenticated route or release authorization proof.'},null,2));}
finally{await browser.close();await new Promise(r=>server.close(r));}
