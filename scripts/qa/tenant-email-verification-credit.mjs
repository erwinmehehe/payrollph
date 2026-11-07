import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';

export const EMAIL_RECEIPT = Object.freeze({head:'480e6d621c91564f9645563b3417a10fb2ebd5a0',merge:'9ac4795efe8c013cd7a66ba73005dc481bde6626',run:42316473226,job:128230185900});
const route='src/app/api/account/email/verify/route.ts';
const harness='scripts/qa/tenant-account-email-verify-http.mjs';
const workflow='.github/workflows/tenant-account-email-verify-http.yml';
const manifestPath='scripts/qa/tenant-isolation-coverage-manifest.json';
const receiptPath='scripts/qa/tenant-email-verification-credit-receipt.json';
const RECEIPT_DIGEST='cd95cc8dc4ddee4f5ac5e5271e752b70be51913f30905be9145aa6587ee75cb3';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
// Source references come from a reviewed fixture, but still never permit that
// fixture or an import specifier to read outside this checked-out repository.
const repositoryRoot=path.resolve(process.cwd());
const rootFiles=new Set(['package.json','package-lock.json','next.config.ts','tsconfig.json']);
export function resolveProofRepoPath(relativeFile) {
  assert.equal(typeof relativeFile,'string','proof file path must be a string');
  assert.ok(!relativeFile.includes('\\\\') && !relativeFile.includes('\\0'),
    'proof file path must be POSIX and NUL-free');
  assert.ok(!path.posix.isAbsolute(relativeFile) && !path.win32.isAbsolute(relativeFile),
    'absolute proof paths are forbidden');
  const segments=relativeFile.split('/');
  assert.ok(segments.every(segment=>segment.length>0 && segment!=='.' && segment!=='..'),
    'untrusted path components in proof input');
  assert.ok(
    rootFiles.has(relativeFile) ||
    /^(?:src|scripts|tests)\//.test(relativeFile) ||
    relativeFile.startsWith('.github/workflows/'),
    'proof input must be from an explicit source/QA root'
  );
  const absolute=path.resolve(repositoryRoot,relativeFile);
  assert.ok(absolute.startsWith(repositoryRoot+path.sep),
    'proof file escaped the repository root');
  return absolute;
}
const read=relativeFile=>readFileSync(resolveProofRepoPath(relativeFile),'utf8');
const blob=(rev,path)=>git('rev-parse',rev+':'+path);
const evidence=`https://github.com/erwinmehehe/payrollph/actions/runs/${EMAIL_RECEIPT.run}/job/${EMAIL_RECEIPT.job}`;

export function verifyEmailCredit(manifest, receipt, reader=read) {
  assert.equal(createHash('sha256').update(JSON.stringify(receipt,null,2)+'\n').digest('hex'),RECEIPT_DIGEST,'reviewed receipt bytes');
  assert.deepEqual(receipt.execution,EMAIL_RECEIPT,'execution receipt identity');
  const method=manifest.allApiRouteFiles[route].methods.find(m=>m.name==='POST');
  assert.equal(method.status,'COVERED');
  assert.deepEqual(method.testedBy,receipt.proof,'exact reviewed method evidence');
  for(const [path,sha] of Object.entries(receipt.pins)){
    const raw=Buffer.from(reader(path).replaceAll('\r\n','\n'));
    assert.equal(createHash('sha1').update(Buffer.from('blob '+raw.length+'\0')).update(raw).digest('hex'),sha,path+': executed input drift');
  }
  const lines=reader(harness).split('\n');
  for(const [key,fragment] of Object.entries(receipt.citations))assert.ok(lines[receipt.proof[key]-1]?.includes(fragment),'invalid '+key+' evidence citation');
  return 1;
}

export function promoteEmail(args){
  if(args.includes('--check')){
    verifyEmailCredit(JSON.parse(read(manifestPath)),JSON.parse(read(receiptPath)));
    console.log('One source-pinned provisional email-verification credit verified');return;
  }
  const label=`GitHub Actions ${EMAIL_RECEIPT.run}/${EMAIL_RECEIPT.job} PG16 account-email-verify PASS`;
  assert.equal(args[args.indexOf('--run-label')+1],label,'executed run label required');
  git('merge-base','--is-ancestor',EMAIL_RECEIPT.merge,'HEAD');
  assert.equal(git('rev-parse',EMAIL_RECEIPT.merge+'^2'),EMAIL_RECEIPT.head);
  // Conservative closure: all application, QA runtime, workflow and package inputs
  // must still match the executed tree. New promotion tooling is not a runtime input.
  const roots=['src','scripts','.github/workflows','package.json','package-lock.json','next.config.ts','tsconfig.json'];
  const tree=rev=>git('ls-tree','-r',rev,...roots);
  assert.equal(tree('HEAD'),tree(EMAIL_RECEIPT.head),'runtime input tree drift requires rerun');
  assert.equal(tree(EMAIL_RECEIPT.merge),tree(EMAIL_RECEIPT.head),'merge changed executed inputs');
  const sourceTree=new Map(tree(EMAIL_RECEIPT.head).split('\n').map(line=>{const [meta,file]=line.split('\t');return [file,meta.split(' ')[2]];}));
  // The installed compiler is needed only for generation. Source-only CI runs
  // verifyEmailCredit without npm install and must remain dependency-free.
  const ts=createRequire(import.meta.url)('typescript');
  const pending=[route,harness,workflow,'package.json','package-lock.json','tsconfig.json','next.config.ts',
    'scripts/qa/apply-isolated-baseline.mjs','scripts/qa/tenant-table-env.mjs',
    'tests/tenant-account-email-verify-contract.test.mjs','tests/tenant-email-verify-owned-proof.test.mjs'];
  const pins={};
  while(pending.length){
    const file=pending.pop();if(pins[file])continue;
    pins[file]=sourceTree.get(file)??blob(EMAIL_RECEIPT.head,file);
    if(!/\.(?:ts|tsx|mjs)$/.test(file))continue;
    for(const imported of ts.preProcessFile(read(file),true,true).importedFiles){
      const spec=imported.fileName;
      const stem=spec.startsWith('@/')?'src/'+spec.slice(2):spec.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),spec)):null;
      if(!stem)continue;
      const resolved=[stem,stem+'.ts',stem+'.tsx',stem+'.mjs',stem+'/index.ts'].find(candidate=>sourceTree.has(candidate));
      assert.ok(resolved,'unresolved executed dependency '+file+' -> '+spec);pending.push(resolved);
    }
  }
  const citations={
    ownPositiveLine:'assertOwnedEmailVerification({account,worker,token,session},expected);',
    foreignDenialLine:'const response = await verify(token, 409, name + " invalid foreign worker link");',
    unchangedDbLine:'assert.deepEqual(await snapshot(), before, name + " denied token changed account, worker or audit state");',
    discriminationLine:'assert.throws(()=>assertOwnedEmailVerification',
    victimIdOrderingLine:'assert.ok(v.worker.id > a.worker.id && v.worker.id > b.worker.id);',
  };
  const lines=read(harness).split('\n'),locations={};
  for(const [key,fragment] of Object.entries(citations)){
    const matches=lines.flatMap((line,i)=>line.includes(fragment)?[i+1]:[]);assert.equal(matches.length,1,key);locations[key]=matches[0];
  }
  const proof={file:harness,line:locations.ownPositiveLine,...locations,
    proofBlobSha:pins[harness],routeBlobSha:pins[route],workflowFile:workflow,workflowBlobSha:pins[workflow],
    testFile:'tests/tenant-email-verify-owned-proof.test.mjs',
    verifiedPrHeadSha:EMAIL_RECEIPT.head,mergedProofCommit:EMAIL_RECEIPT.merge,proofPullRequest:1805,
    workflowRunId:EMAIL_RECEIPT.run,workflowJobId:EMAIL_RECEIPT.job,runLabel:label,evidence,postgresMajor:16,
    scope:'One-use-token authorization: two independent fictional token holders each persist their own account and worker email, consume the exact token and revoke their own session. Both foreign-worker pointers are refused without SQL/audit changes. Wrong-employer discrimination, spent-token replay, revoked grant, mismatched worker grant and same-employer legacy grant are checked. No external email delivery or production certification.',
    independentSecurityReview:'PENDING',productionTested:false};
  const manifest=JSON.parse(read(manifestPath)),method=manifest.allApiRouteFiles[route].methods.find(m=>m.name==='POST');
  assert.equal(method.status,'GAP');assert.equal(method.testedBy,null);
  const old={...manifest.metrics};method.status='COVERED';method.testedBy=proof;
  method.reason='Provisional token-authenticated two-attacker email-verification HTTP/PG16 proof: '+evidence+'. Independent review PENDING; no production authorization.';
  delete method.reviewedUncertified;
  const methods=Object.values(manifest.allApiRouteFiles).flatMap(r=>r.methods);
  manifest.metrics.coveredAfter=methods.filter(m=>m.status==='COVERED').length;
  manifest.metrics.gap=methods.filter(m=>m.status==='GAP').length;
  assert.equal(manifest.metrics.coveredAfter,old.coveredAfter+1);assert.equal(manifest.metrics.gap,old.gap-1);
  manifest.acceptanceStatus=manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+manifest.metrics.gap+' API methods');
  const inventoryPath='docs/engineering/tenant-isolation-coverage-inventory.md';let inventory=read(inventoryPath);
  for(const key of ['coveredAfter','gap'])inventory=inventory.replace('| '+key+' | '+old[key]+' |','| '+key+' | '+manifest.metrics[key]+' |');
  const rows=inventory.split('\n'),index=rows.findIndex(r=>r.startsWith('| [`account/email/verify` POST]'));
  assert.ok(index>=0);assert.ok(rows[index].includes('**GAP**'));
  rows[index]=rows[index].replace('| NO VALID METHOD PROOF | **GAP** |',`| [token-scoped PG16 proof](${evidence}) | **COVERED** |`);
  assert.ok(rows[index].includes('**COVERED**'));
  inventory=rows.join('\n').replace(/^(> \*\*(?:RELEASE BLOCKER|NOT ACCEPTED)\*\*:? )\d+ (API methods|method gaps)/gm,(_,a,b)=>a+manifest.metrics.gap+' '+b);
  inventory=inventory.replace('\n','\n\n> **Email verification provisional promotion:** 423 COVERED / 11 PUBLIC-BY-DESIGN / 64 GAP. One token-authenticated method, source-pinned PG16 receipt; independent review PENDING. No production acceptance.\n');
  inventory=inventory.replace('**RELEASE BLOCKER:** 65 API methods','**RELEASE BLOCKER:** 64 API methods').replace('**NOT ACCEPTED**: 65 method gaps','**NOT ACCEPTED**: 64 method gaps').replace('**Integrated #1805 ledger:** 422 COVERED / 11 PUBLIC-BY-DESIGN / 65 GAP','**Integrated #1805 plus email ledger:** 423 COVERED / 11 PUBLIC-BY-DESIGN / 64 GAP');
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(inventoryPath,inventory);
  writeFileSync(receiptPath,JSON.stringify({execution:EMAIL_RECEIPT,pins,citations,proof},null,2)+'\n');
  const planPath='docs/engineering/tenant-isolation-closure-plan.md';
  let plan=read(planPath).replace('498 methods = 422 COVERED + 11 PUBLIC-BY-DESIGN + 65 GAP; frozen 406 = 338 COVERED + 3 PUBLIC-BY-DESIGN + 65 GAP','498 methods = 423 COVERED + 11 PUBLIC-BY-DESIGN + 64 GAP; frozen 406 = 339 COVERED + 3 PUBLIC-BY-DESIGN + 64 GAP');
  plan=plan.replace('| 6 | **EDG-01** | 33 | 6 | 0 | 27 | INCOMPLETE |','| 6 | **EDG-01** | 33 | 7 | 0 | 26 | INCOMPLETE |').replace('Frozen subtotal (2026-11-04 proposal): **338 COVERED + 3 PUBLIC-BY-DESIGN + 65 GAP = 406**','Frozen subtotal (2026-11-04 proposal): **339 COVERED + 3 PUBLIC-BY-DESIGN + 64 GAP = 406**');
  writeFileSync(planPath,plan);
  console.log(JSON.stringify({credits:1,covered:manifest.metrics.coveredAfter,gap:manifest.metrics.gap,evidence}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)promoteEmail(process.argv.slice(2));
