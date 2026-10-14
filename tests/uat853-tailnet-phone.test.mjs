import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import {
  assertFictionalPhoneLab, assertNoPublicFunnel, tailnetHostname,
  verifyGatewayCredentials, isAuthorizedBasic, isApprovedMutationOrigin,
  hardenCookies, createPhoneGateway,
} from '../scripts/qa/uat853-tailnet-phone.mjs';

const sha='a'.repeat(40);
const host='qa-worker.example.ts.net';
const username='b'.repeat(48);
const password='c'.repeat(64);
const basic='Basic '+Buffer.from(username+':'+password).toString('base64');
const app={
  DATABASE_URL:'postgresql://uat853_owner:'+ 'a'.repeat(48)+'@127.0.0.1:5432/uat853',
  APP_BASE_URL:'http://127.0.0.1:3000',
  TRUSTED_APP_ORIGINS:'http://127.0.0.1:3000',
  DEMO_MODE:'false',
  ...Object.fromEntries([
    'PAYMONGO_DISBURSEMENTS_ENABLED','XENDIT_PAYOUTS_ENABLED',
    'XENDIT_PAYOUTS_LIVE_APPROVED','FINAL_PAY_MANUAL_RELEASE_ENABLED',
    'WFM_GEOFENCE_PILOT_ENABLED','WFM_PUNCH_EVIDENCE_ENABLED',
    'CENTRAL_SCHEDULER_ENABLED','WORKER_ENABLED',
  ].map(x=>[x,'false'])),
  PAYMONGO_SECRET_KEY:'',XENDIT_SECRET_KEY:'',OPENAI_API_KEY:'',SMTP_PASSWORD:'',
};
const state={kind:'fictional-local-disposable-pg16',sha,schemaReady:true,
  container:'payrollph-uat853-'+sha.slice(0,12)};

const listen = server => new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>resolve(server.address().port));
});
const close = server => new Promise(resolve=>server.close(resolve));

test('only guarded exact source and local fictional PG16 app may be served',()=>{
  assert.doesNotThrow(()=>assertFictionalPhoneLab(state,app,sha));
  assert.throws(()=>assertFictionalPhoneLab(state,app,'d'.repeat(40)),/SOURCE_SHA_CHANGED/);
  assert.throws(()=>assertFictionalPhoneLab({...state,schemaReady:false},app,sha),/SCHEMA_NOT_READY/);
  assert.throws(()=>assertFictionalPhoneLab(state,{...app,DATABASE_URL:app.DATABASE_URL.replace('127.0.0.1','prod.neon.tech')},sha));
  assert.throws(()=>assertFictionalPhoneLab(state,{...app,XENDIT_PAYOUTS_ENABLED:'true'},sha));
  assert.throws(()=>assertFictionalPhoneLab(state,{...app,XENDIT_SECRET_KEY:'secret'},sha));
  assert.throws(()=>assertFictionalPhoneLab(state,{...app,APP_BASE_URL:'https://payrollph.com'},sha));
});

test('tailnet identity must be connected and have exact ts.net hostname',()=>{
  assert.equal(tailnetHostname({BackendState:'Running',Self:{Online:true,DNSName:host+'.'}}),host);
  for(const bad of [
    {BackendState:'Stopped',Self:{Online:true,DNSName:host}},
    {BackendState:'Running',Self:{Online:false,DNSName:host}},
    {BackendState:'Running',Self:{Online:true,DNSName:'qa.evil.com'}},
    {BackendState:'Running',Self:{Online:true,DNSName:'qa.ts.net.attacker.example'}},
    {BackendState:'Running',Self:{Online:true,DNSName:'qa..ts.net'}},
  ]) assert.throws(()=>tailnetHostname(bad));
});

test('a public Tailscale Funnel is always refused; Serve-only config is allowed',()=>{
  assert.doesNotThrow(()=>assertNoPublicFunnel('{}'));
  assert.doesNotThrow(()=>assertNoPublicFunnel('null'));
  assert.doesNotThrow(()=>assertNoPublicFunnel(JSON.stringify({TCP:{443:{HTTPS:true}},Web:{[host+':443']:{Handlers:{'/':{Proxy:'http://127.0.0.1:3001'}}}}})));
  assert.doesNotThrow(()=>assertNoPublicFunnel({AllowFunnel:{[host+':443']:false}}));
  assert.throws(()=>assertNoPublicFunnel({AllowFunnel:{[host+':443']:true}}),/FUNNEL_PUBLIC/);
  assert.throws(()=>assertNoPublicFunnel({AllowFunnel:'enabled'}),/FUNNEL_UNVERIFIED/);
  assert.throws(()=>assertNoPublicFunnel('garbled'));
});

test('random gateway credentials are bound to SHA and the tailnet',()=>{
  const valid={kind:'qa-tailnet-only-gateway',sha,hostname:host,username,password};
  assert.doesNotThrow(()=>verifyGatewayCredentials(valid,sha,host));
  assert.throws(()=>verifyGatewayCredentials(valid,'d'.repeat(40),host),/SOURCE_MISMATCH/);
  assert.throws(()=>verifyGatewayCredentials(valid,sha,'other.example.ts.net'),/HOST_CHANGED/);
  assert.throws(()=>verifyGatewayCredentials({...valid,password:'weak'},sha,host));
});

test('basic authentication uses constant-time hashes and never defaults open',()=>{
  assert.equal(isAuthorizedBasic(basic,username,password),true);
  for(const wrong of [undefined,'','Bearer token','Basic invalid',
    'Basic '+Buffer.from('bad:'+password).toString('base64'),
    'Basic '+Buffer.from(username+':bad').toString('base64')]) {
    assert.equal(isAuthorizedBasic(wrong,username,password),false);
  }
});

test('mutations require exact HTTPS origin and reject cross-site',()=>{
  assert.equal(isApprovedMutationOrigin({origin:'https://'+host,'sec-fetch-site':'same-origin'},host),true);
  assert.equal(isApprovedMutationOrigin({origin:'http://127.0.0.1:3001'},host),true);
  assert.equal(isApprovedMutationOrigin({origin:'https://evil.example','sec-fetch-site':'same-origin'},host),false);
  assert.equal(isApprovedMutationOrigin({origin:'https://'+host+'.attacker.example'},host),false);
  assert.equal(isApprovedMutationOrigin({origin:'https://'+host,'sec-fetch-site':'cross-site'},host),false);
  assert.equal(isApprovedMutationOrigin({},host),false);
});

test('upstream session cookies are upgraded to Secure',()=>{
  assert.deepEqual(hardenCookies(['linaw_session=x; HttpOnly; SameSite=Lax','already=y; Secure']),
    ['linaw_session=x; HttpOnly; SameSite=Lax; Secure','already=y; Secure']);
});

test('local gated HTTP proxy rejects strangers, strips gateway credentials, and preserves safe browser semantics',async t=>{
  const upstreamRequests=[];
  const backend=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    upstreamRequests.push({url:req.url,headers:req.headers,body:Buffer.concat(chunks).toString()});
    res.setHeader('set-cookie','linaw_session=fake; HttpOnly; SameSite=Lax; Path=/');
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ok:true,host:req.headers.host,forwarded:req.headers['x-forwarded-host'],
      authorization:req.headers.authorization??null,origin:req.headers.origin??null}));
  });
  const upstreamPort=await listen(backend);
  const gateway=createPhoneGateway({hostname:host,username,password,upstreamPort});
  const port=await listen(gateway);
  t.after(async()=>{await close(gateway);await close(backend);});
  assert.equal(gateway.address().address,'127.0.0.1');
  const url='http://127.0.0.1:'+port;
  const gateHeaders={host,authorization:basic};
  const resp=async(path,headers={},options={})=>fetch(url+path,{headers:{host,...headers},...options});
  assert.equal((await resp('/login')).status,401);
  assert.equal((await resp('/login',{authorization:'Basic '+Buffer.from('wrong:password').toString('base64')})).status,401);
  assert.equal(upstreamRequests.length,0);
  const yes=await resp('/login',gateHeaders);
  assert.equal(yes.status,200);
  const value=await yes.json();
  assert.equal(value.authorization,null);
  assert.equal(value.forwarded,host);
  assert.equal(value.host,'127.0.0.1:'+upstreamPort);
  assert.match(yes.headers.get('set-cookie'),/; Secure/);
  assert.equal(yes.headers.get('x-frame-options'),'DENY');
  const rawStatus=(path,hostname)=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port,path,method:'GET',headers:{Host:hostname,Authorization:basic}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});
    req.on('error',reject);req.end();
  });
  assert.equal(await rawStatus('/api/test','evil.example'),421);
  assert.equal((await resp('/qa-artifacts/private.json',gateHeaders)).status,404);
  assert.equal((await resp('/.env',gateHeaders)).status,404);
  assert.equal((await resp('/api/test',{...gateHeaders,origin:'https://evil.example','sec-fetch-site':'cross-site','content-type':'application/json'},
    {method:'POST',body:'{}'})).status,403);
  assert.equal((await resp('/api/test',{...gateHeaders,'content-type':'application/json'},
    {method:'POST',body:'{}'})).status,403);
  const post=await resp('/api/test',{...gateHeaders,origin:'https://'+host,'sec-fetch-site':'same-origin',
    'content-type':'application/json','x-forwarded-host':'evil.example'},
    {method:'POST',body:'{"fake":true}'});
  assert.equal(post.status,200);
  const data=await post.json();
  assert.equal(data.authorization,null);
  assert.equal(data.origin,'https://'+host);
  assert.equal(data.forwarded,host);
  assert.equal(upstreamRequests.at(-1).body,'{"fake":true}');
  assert.equal(await rawStatus('//evil.com',host),400);
});
