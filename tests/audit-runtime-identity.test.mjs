import assert from 'node:assert/strict';
import { createDecipheriv, constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { captureAuditRuntimeIdentity, encryptRuntimeIdentity, evidenceRecipient,
  RUNTIME_IDENTITY_URL, validateRuntimeIdentity } from '../scripts/qa/audit-runtime-identity.mjs';

const pair=generateKeyPairSync('rsa',{modulusLength:3072});
const recipient=pair.publicKey.export({type:'spki',format:'der'}).toString('base64');
const sha='a'.repeat(40),now=Date.parse('2026-10-17T12:00:00Z');
const token='synthetic-readiness-token-only-never-a-real-credential';
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'erwinmehehe/payrollph',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,
  PRODUCTION_READINESS_TOKEN:token,AUDIT_EVIDENCE_PUBLIC_KEY_BASE64:recipient};
function payload(){return {deploymentSha:sha,deploymentEnvironment:'production',generatedAt:new Date(now).toISOString(),
  evidenceScope:'PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL',
  database:{projectId:'calm-wave-70219564',branchId:'br-lucky-sound-b79i56jw',endpointId:'ep-cool-hat-b7e7gpoo',
    databaseName:'neondb',roleName:'synthetic_fixture_role',inRecovery:false}};}
function decrypt(envelope,privateKey=pair.privateKey){
  const key=privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.wrappedKey,'base64'));
  try{
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
    decipher.setAAD(Buffer.from(envelope.aad));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString());
  }finally{key.fill(0);}
}

test('encrypts an allowlisted identity; only the operator key recovers it; tampering is rejected',()=>{
  const p=payload();p.password='untrusted-secret-extension';p.database.connectionString='postgresql://do-not-retain';
  const identity=validateRuntimeIdentity(p,sha,now);
  assert.equal(Object.hasOwn(identity,'password'),false);
  assert.equal(Object.hasOwn(identity.database,'connectionString'),false);
  const first=encryptRuntimeIdentity(identity,evidenceRecipient(recipient));
  const second=encryptRuntimeIdentity(identity,evidenceRecipient(recipient));
  assert.deepEqual(decrypt(first),identity);assert.notEqual(first.ciphertext,second.ciphertext);
  const encoded=JSON.stringify(first);
  for(const secret of [token,'synthetic_fixture_role','neondb','do-not-retain','untrusted-secret-extension'])assert.equal(encoded.includes(secret),false);
  const modified={...first,tag:Buffer.alloc(16).toString('base64')};assert.throws(()=>decrypt(modified));
  assert.throws(()=>decrypt({...first,aad:first.aad+'x'}));
  const wrong=generateKeyPairSync('rsa',{modulusLength:3072});assert.throws(()=>decrypt(first,wrong.privateKey));
});

test('fails before transport on untrusted execution context, missing token or invalid recipient',async()=>{
  for(const change of [
    {GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'attacker/repo'},
    {GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/heads/feature'},
    {GITHUB_SHA:'not-a-sha'},{PRODUCTION_READINESS_TOKEN:''},
    {PRODUCTION_READINESS_TOKEN:token+'\r\nleak'},{AUDIT_EVIDENCE_PUBLIC_KEY_BASE64:''},
    {AUDIT_EVIDENCE_PUBLIC_KEY_BASE64:'Zm9v'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  ]){
    let called=false;
    await assert.rejects(captureAuditRuntimeIdentity({...env,...change},{fetchImpl:async()=>{called=true;throw Error('must not request');}}));
    assert.equal(called,false);
  }
  const weak=generateKeyPairSync('rsa',{modulusLength:2048});
  assert.throws(()=>evidenceRecipient(weak.publicKey.export({type:'spki',format:'der'}).toString('base64')));
});

test('rejects wrong deployment/target, recovery replicas, malformed roles and stale responses',()=>{
  for(const change of [{deploymentSha:'b'.repeat(40)},{deploymentEnvironment:'preview'},
    {evidenceScope:'forged'},{generatedAt:'invalid'},
    {generatedAt:new Date(now-300001).toISOString()},{generatedAt:new Date(now+30001).toISOString()}]){
    assert.throws(()=>validateRuntimeIdentity({...payload(),...change},sha,now));
  }
  for(const change of [{projectId:'wrong'},{branchId:'other-branch'},{endpointId:'wrong'},
    {databaseName:'other'},{inRecovery:true},{inRecovery:'false'},{roleName:'../unsafe'},
    {roleName:''},{roleName:'a'.repeat(64)}]){
    const p=payload();p.database={...p.database,...change};assert.throws(()=>validateRuntimeIdentity(p,sha,now));
  }
});

test('executes a single credentialed GET and persists ciphertext; never follows redirects or accepts errors',async()=>{
  let mode='ok';const requests=[];
  const server=createServer((req,res)=>{
    requests.push({method:req.method,url:req.url,token:req.headers['x-readiness-token']});
    if(mode==='redirect'){res.writeHead(302,{Location:'https://example.invalid/do-not-follow'});res.end();return;}
    if(mode==='denied'){res.writeHead(404);res.end('private diagnostic denied');return;}
    res.setHeader('Content-Type',mode==='html'?'text/html':'application/json');
    res.end(mode==='oversized'?JSON.stringify({padding:'x'.repeat(40000)}):mode==='malformed'?'{':JSON.stringify(payload()));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();let written=null;
  const transport=async(url,options)=>{
    assert.equal(url,RUNTIME_IDENTITY_URL);assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return fetch('http://127.0.0.1:'+address.port+'/api/readiness/database-target',options);
  };
  try{
    const result=await captureAuditRuntimeIdentity(env,{fetchImpl:transport,now:()=>now,writeEvidence:e=>{written=e;}});
    assert.deepEqual(result,{captured:true,encrypted:true,privilegesProven:false});
    assert.deepEqual(decrypt(written),validateRuntimeIdentity(payload(),sha,now));
    assert.deepEqual(requests,[{method:'GET',url:'/api/readiness/database-target',token}]);
    for(mode of ['redirect','denied','html','malformed','oversized']){
      let saved=false;
      await assert.rejects(captureAuditRuntimeIdentity(env,{fetchImpl:transport,now:()=>now,writeEvidence:()=>{saved=true;}}));
      assert.equal(saved,false);
    }
    assert.equal(requests.length,6,'no retry, second endpoint or redirected credential transmission');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
