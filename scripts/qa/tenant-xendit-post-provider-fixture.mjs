/** A real loopback TCP server, not a mocked application fetch or database. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {SYNTHETIC_XENDIT_KEY} from './tenant-xendit-post-proof-target.mjs';
export async function startXenditProviderFixture(employers){
  const instructions=new Map();
  for(const e of employers)for(const[name,r]of Object.entries(e.runs))instructions.set(r.referenceNumber,{
    reference:r.referenceNumber,payoutId:r.payoutId,amount:1800000,name,employeeNo:e.worker.employeeNo,
    given:e.worker.firstName,surname:e.worker.lastName});
  const records=new Map(),calls=[];
  const server=createServer(async(req,res)=>{
    const reply=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
    try{
      assert.equal(req.headers.authorization,'Basic '+Buffer.from(SYNTHETIC_XENDIT_KEY+':').toString('base64'));
      assert.equal(req.headers['api-version'],'2025-09-01');
      let raw='';
      for await(const part of req){raw+=part;assert.ok(raw.length<=65536);}
      calls.push({method:req.method,path:req.url});
      const wire=(record,status)=>({payout_id:record.payoutId,reference_id:record.reference,status,
        source_currency:'PHP',destination_currency:'PHP',source_amount:record.amount,
        business_id:'biz_fictional_tenant_proof'});
      if(req.method==='POST'&&req.url==='/v3/payouts'){
        const body=JSON.parse(raw),expected=instructions.get(body.reference_id);
        assert.ok(expected,'Unregistered fictional payout reference');
        assert.equal(body.payout_details.source_amount,expected.amount);
        assert.equal(body.payout_details.source_currency,'PHP');
        assert.equal(body.recipient.given_name,expected.given);
        assert.equal(body.recipient.surname,expected.surname);
        assert.equal(body.recipient.account_details.account_number,'000000000001');
        assert.equal(body.purpose_code,'SALARY');
        assert.ok(req.headers['idempotency-key']);
        assert.ok(!records.has(expected.payoutId),'Duplicate provider POST must not occur');
        records.set(expected.payoutId,expected);
        // A real HTTP 503 after accepting the instruction leaves the application
        // uncertain. It must persist unknown and use GET recovery, never resend.
        return expected.name!=='normal'?reply(503,{error:'fictional accepted-but-response-unavailable'}):
          reply(201,wire(expected,'ACCEPTED'));
      }
      if(req.method==='GET'&&/^\/v3\/payouts\/po-[A-Za-z0-9-]+$/.test(req.url??'')){
        const id=req.url.slice('/v3/payouts/'.length),record=records.get(id);
        return record?reply(200,wire(record,'SUCCEEDED')):reply(404,{error:'fictional payout not found'});
      }
      reply(400,{error:'unregistered fictional provider request'});
    }catch{reply(400,{error:'fictional provider contract refused request'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3013,'127.0.0.1',resolve);});
  return{calls,records,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
