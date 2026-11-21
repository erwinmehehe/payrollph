/** Build the security-write v2 receipt from one inspected native Actions job. Grants ZERO credits.
 *
 *   node scripts/qa/security-write-v2-capture.mjs --job <job.json> [--write]
 *
 * job.json: {runId, jobId, name, testedHead, testedMerge, base, steps:[{name,conclusion}], jsonLines:[...]}
 * Every closure pin must equal the blob in the executed head's tree, so the receipt can only describe source that ran.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {closure} from './wage-registry-renewal-v2-capture.mjs';
import {V2_GLOBAL_ROOTS,V2_ACCOUNTING_ONLY} from './wage-registry-renewal-v2.mjs';
import {SECURITY_V2_EXCLUDED_GLOBALS,SECURITY_V2_FAMILY_ROOTS,SECURITY_V2_MANIFEST,SECURITY_V2_RECEIPT,SECURITY_V2_RECEIPT_BLOB,SECURITY_V2_SCHEMA,
 SECURITY_V2_TARGETS,SECURITY_V2_WORKFLOW,validateSecurityV2Receipt} from './security-write-v2-credit.mjs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
const treeAt=head=>new Map(git('ls-tree','-r',head).split('\n').map(line=>{const [meta,file]=line.split('\t');return [file,meta.split(' ')[2]];}));

export function parseResults(jsonLines){
 const parsed=jsonLines.map(l=>JSON.parse(l));
 const biometrics=parsed.filter(x=>x.family==='BIO-01'),developer=parsed.filter(x=>x.kind==='TENANT_DEVELOPER_API_KEYS_POST');
 assert.equal(biometrics.length,1,'Exactly one BIO-01 result expected');assert.equal(developer.length,1,'Exactly one developer result expected');
 return {biometrics:biometrics[0],developer:developer[0]};
}

export function captureSecurityV2(job,manifest){
 assert.equal(job.name,'four-method-security-write');
 // The job checks out the PR merge ref. It equals the head tree only when the base is already contained in the head.
 execFileSync('git',['merge-base','--is-ancestor',job.base,job.testedHead]);
 const globalRoots=V2_GLOBAL_ROOTS.filter(f=>!SECURITY_V2_EXCLUDED_GLOBALS.includes(f));
 const cache=new Map(),globalPins=closure(globalRoots,undefined,undefined,cache);
 for(const f of Object.keys(globalPins))assert.ok(!V2_ACCOUNTING_ONLY.includes(f),'Bookkeeping in global base: '+f);
 const methodPins={},holds={};
 for(const t of SECURITY_V2_TARGETS){
  const all=closure([...SECURITY_V2_FAMILY_ROOTS,t.path,t.proof,t.contract],undefined,undefined,cache);
  methodPins[t.key]=Object.fromEntries(Object.entries(all).filter(([f])=>!Object.hasOwn(globalPins,f)));
  const row=manifest.allApiRouteFiles[t.path].methods.find(m=>m.name===t.verb);
  holds[t.key]=structuredClone(row);
 }
 const tree=treeAt(job.testedHead);
 for(const pins of [globalPins,...Object.values(methodPins)])for(const [file,sha]of Object.entries(pins))
  assert.equal(tree.get(file),sha,'Executed checkout does not match a sealed input at '+job.testedHead+': '+file);
 const receipt={schema:SECURITY_V2_SCHEMA,label:'SOLO_VERIFIED_DEV_RECOVERY',productionAccepted:false,independentlyAccepted:false,creditsAtExecution:0,
  execution:{workflow:SECURITY_V2_WORKFLOW,runId:job.runId,jobId:job.jobId,jobName:job.name,conclusion:'success',testedHead:job.testedHead,
   testedMerge:job.testedMerge,base:job.base,steps:job.steps,evidence:'https://github.com/erwinmehehe/payrollph/actions/runs/'+job.runId+'/job/'+job.jobId,
   boundary:'The job checked out the pull-request merge ref; its base was already an ancestor of the tested head, so the executed tree is the head tree.'},
  results:parseResults(job.jsonLines),methods:SECURITY_V2_TARGETS.map(t=>t.key),holds,globalRoots,globalPins,methodPins,
  boundary:'Each method is bound to its own executed closure plus the global base; drift elsewhere (including the documents route) does not withdraw it.'};
 validateSecurityV2Receipt(receipt);
 return receipt;
}

const cli=process.argv[1]?.replaceAll('\\','/').endsWith('/security-write-v2-capture.mjs');
if(cli){
 const at=process.argv.indexOf('--job');assert.ok(at>0,'Usage: --job <job.json> [--write]');
 const receipt=captureSecurityV2(JSON.parse(readFileSync(process.argv[at+1],'utf8')),JSON.parse(readFileSync(SECURITY_V2_MANIFEST,'utf8')));
 if(process.argv.includes('--write')){
  assert.equal(SECURITY_V2_RECEIPT_BLOB,'PENDING_REAL_PG16_HTTP','Never overwrite a sealed execution receipt');
  writeFileSync(SECURITY_V2_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 }
 console.log(JSON.stringify({methods:receipt.methods,globalPins:Object.keys(receipt.globalPins).length,
  methodPins:Object.fromEntries(Object.entries(receipt.methodPins).map(([k,v])=>[k,Object.keys(v).length])),creditsWritten:0}));
}
