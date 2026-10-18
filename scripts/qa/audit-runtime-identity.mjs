import { createCipheriv, createPublicKey, constants, publicEncrypt, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RUNTIME_IDENTITY_URL='https://erwinmehehe-payrollph.vercel.app/api/readiness/database-target';
const AAD='payrollph-audit-runtime-identity:v1';
const fail=code=>{throw new Error('AUDIT_RUNTIME_'+code);};

export function evidenceRecipient(encoded){
  if(typeof encoded!=='string'||encoded.length>2048||!(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)))fail('RECIPIENT_REQUIRED');
  let key;
  try{key=createPublicKey({key:Buffer.from(encoded,'base64'),format:'der',type:'spki'});}catch{fail('INVALID_RECIPIENT');}
  if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<3072
    ||(key.asymmetricKeyDetails?.modulusLength??0)>8192)fail('INVALID_RECIPIENT');
  return key;
}

export function validateRuntimeIdentity(payload,sha,now=Date.now()){
  if(!payload||typeof payload!=='object'||Array.isArray(payload)
    ||payload.evidenceScope!=='PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL'
    ||payload.deploymentSha!==sha||payload.deploymentEnvironment!=='production')fail('DEPLOYMENT_MISMATCH');
  const d=payload.database;
  if(!d||d.projectId!=='calm-wave-70219564'||d.branchId!=='br-lucky-sound-b79i56jw'
    ||d.endpointId!=='ep-cool-hat-b7e7gpoo'||d.databaseName!=='neondb'||d.inRecovery!==false
    ||typeof d.roleName!=='string'||!(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(d.roleName)))fail('TARGET_MISMATCH');
  const time=typeof payload.generatedAt==='string'?Date.parse(payload.generatedAt):NaN;
  if(!Number.isFinite(time)||time>now+30000||now-time>300000)fail('STALE_IDENTITY');
  // Explicit allowlist: no response extensions, schema counts, connection URLs,
  // request headers or operational secrets enter the evidence envelope.
  return {evidenceScope:'PRIVATE_RUNTIME_SESSION_IDENTITY_NOT_PRIVILEGE_PROOF',
    deploymentSha:sha,deploymentEnvironment:'production',generatedAt:new Date(time).toISOString(),
    database:{projectId:d.projectId,branchId:d.branchId,endpointId:d.endpointId,
      databaseName:d.databaseName,roleName:d.roleName,inRecovery:false}};
}

export function encryptRuntimeIdentity(identity,key){
  const aes=randomBytes(32),iv=randomBytes(12);
  try{
    const cipher=createCipheriv('aes-256-gcm',aes,iv);
    cipher.setAAD(Buffer.from(AAD));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(identity),'utf8'),cipher.final()]);
    const wrapped=publicEncrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aes);
    return {version:1,algorithm:'RSA-OAEP-SHA256+A256GCM',aad:AAD,
      wrappedKey:wrapped.toString('base64'),iv:iv.toString('base64'),
      tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  }finally{aes.fill(0);}
}

async function readBoundedJson(response){
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))fail('INVALID_RESPONSE');
  const reader=response.body?.getReader();if(!reader)fail('INVALID_RESPONSE');
  const chunks=[];let size=0;
  try{
    while(true){const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>32768){await reader.cancel();fail('RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}
  }finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_RESPONSE');}
}

export async function captureAuditRuntimeIdentity(env,{fetchImpl=fetch,now=Date.now,writeEvidence}={}){
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='erwinmehehe/payrollph'
    ||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REF!=='refs/heads/main'
    ||!(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')))fail('REVIEWED_MAIN_ONLY');
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')fail('TLS_REQUIRED');
  const token=env.PRODUCTION_READINESS_TOKEN;
  if(typeof token!=='string'||Buffer.byteLength(token)<32||/[\r\n]/.test(token))fail('READINESS_TOKEN_REQUIRED');
  const recipient=evidenceRecipient(env.AUDIT_EVIDENCE_PUBLIC_KEY_BASE64);
  const response=await fetchImpl(RUNTIME_IDENTITY_URL,{
    method:'GET',headers:{Accept:'application/json','x-readiness-token':token},
    redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store',
  });
  if(response.status!==200)fail('IDENTITY_UNAVAILABLE');
  const identity=validateRuntimeIdentity(await readBoundedJson(response),env.GITHUB_SHA,now());
  const envelope=encryptRuntimeIdentity(identity,recipient);
  if(typeof writeEvidence!=='function')fail('PRIVATE_OUTPUT_REQUIRED');
  await writeEvidence(envelope);
  // No plaintext role, target, token or returned response is printed.
  return {captured:true,encrypted:true,privilegesProven:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)fail('PRIVATE_OUTPUT_REQUIRED');
    await captureAuditRuntimeIdentity(process.env,{writeEvidence:envelope=>{
      writeFileSync(process.argv[2],JSON.stringify(envelope)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});
    }});
    console.log('AUDIT_RUNTIME_IDENTITY_ENCRYPTED_NOT_PRIVILEGE_APPROVAL');
  }catch(error){
    const code=error instanceof Error&&/^AUDIT_RUNTIME_[A-Z_]+$/.test(error.message)
      ?error.message:'AUDIT_RUNTIME_CAPTURE_FAILED';
    console.error(code);process.exitCode=1;
  }
}
