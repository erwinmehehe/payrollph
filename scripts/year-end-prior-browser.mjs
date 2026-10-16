import assert from 'node:assert/strict';
export async function testPriorEvidence({browser,owner,checker,employee,fixture,outDir,results}) {
 const base='https://127.0.0.1:3445';
 const query=`organizationId=${fixture.organizationId}&employeeId=${fixture.employeeId}&taxYear=2026`;
 const api=base+'/api/year-end/prior-evidence?'+query;
 const headers={origin:base,'sec-fetch-site':'same-origin'};
 const anonymous=await browser.newContext({ignoreHTTPSErrors:true});
 assert.equal((await anonymous.request.get(api)).status(),401);await anonymous.close();
 assert.equal((await employee.request.get(api)).status(),403);
 assert.equal((await owner.request.get(api)).status(),200);
 assert.match((await owner.request.get(api)).headers()['cache-control'],/no-store/);
 assert.equal((await owner.request.post(api,{headers:{origin:'https://foreign.example','sec-fetch-site':'cross-site'},data:{action:'save'}})).status(),403);
 const off='https://127.0.0.1:3444';
 assert.equal((await owner.request.get(off+'/api/year-end/prior-evidence?'+query)).status(),404);
 assert.equal((await owner.request.get(off+'/workspace/prior-employer?'+query)).status(),404);
 // Existing 2025 adjustment is settled: even a valid source cannot change it.
 const none={status:'none-confirmed',employerName:'',employerTin:'',periodFrom:'',periodTo:'',taxableIncome:'0.00',taxWithheld:'0.00',exemptBenefits:'0.00',sourceReference:'private:fictional-declaration',sourceSha256:'a'.repeat(64),peraCredit:'0.00',peraReference:'',peraSha256:''};
 const blocked=await owner.request.post(api.replace('2026','2025'),{headers,data:{action:'save',evidence:none,expectedDigest:''}});
 assert.equal(blocked.status(),409);assert.equal((await blocked.json()).code,'PRIOR_SETTLED_OR_BOUND');
 assert.equal((await owner.request.post(api,{headers,data:{action:'save',evidence:none,expectedDigest:''}})).status(),200);
 const record=(await (await owner.request.get(api)).json()).record;
 assert.equal((await owner.request.post(api,{headers,data:{action:'approve',expectedDigest:record.digest}})).status(),409);
 assert.equal((await checker.request.post(api,{headers,data:{action:'approve',expectedDigest:'stale'}})).status(),409);
 assert.equal((await checker.request.post(api,{headers,data:{action:'approve',expectedDigest:record.digest}})).status(),200);
 assert.equal((await (await owner.request.get(api)).json()).record.approved,true);
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},ignoreHTTPSErrors:true,storageState:await checker.storageState()});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/workspace/prior-employer?'+query);await page.getByRole('button',{name:'Load evidence',exact:true}).click();
  await page.getByText('Revision 1 · Approved',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  await page.screenshot({path:outDir+'/prior-approved-'+width+'.png',fullPage:true});await context.close();
 }
 results.push({checkpoint:'prior-evidence-authenticated',result:'pass',checks:['401','employee403','MFA payroll sessions','CSRF403','no-store','flag-off API/page404','settled409','self-check409','stale409','independent approve','desktop1280','phone390'],syntheticOnly:true});
 console.log('PASS prior authenticated API/checker/settled/flags-off and desktop/390px');
}
