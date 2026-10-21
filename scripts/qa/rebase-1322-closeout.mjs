// One-time preparation only; never included in the follow-up PR.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const repo = 'erwinmehehe/payrollph';
const original = '562cf77333de667dfb99f6a0a0fb340fc776a1ec';
const parent = '06dbf527dd3c8f0c29f0ae1f4dbc68833037a76c';
const retired = '.github/workflows/qa-dl01-regression-diagnostics.yml';
const allowed = [retired,'docs/engineering/tenant-isolation-coverage-inventory.md',
 'scripts/qa/tenant-isolation-coverage-manifest.json','scripts/qa/tenant-manifest-driven-http.mjs',
 'tests/remittance-month-close-read.test.ts','tests/tenant-isolation-coverage-inventory.test.mjs',
 'tests/tenant-high-risk-batch-01.test.mjs','tests/tenant-manifest-driven-http.test.mjs',
 'tests/tenant-dl01-reviewed-proof-links.test.mjs'].sort();
const git = (...args) => execFileSync('git', args, {encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const read = path => readFileSync(path,'utf8');
assert.equal(process.env.CI,'true');
assert.equal(process.env.GITHUB_REPOSITORY,repo);
assert.ok(process.cwd().endsWith('/target'), 'Only the disposable preparation checkout');
if (process.argv[2] === 'rebase') {
 assert.equal(git('rev-parse','HEAD'),original);
 assert.equal(git('diff','--name-only'),'');
 assert.deepEqual(git('diff','--cached','--name-only').split('\n').sort(),allowed);
 const patch = join(process.env.RUNNER_TEMP,'reviewed-1322-closeout.patch');
 writeFileSync(patch,execFileSync('git',['diff','--cached','--binary'],{encoding:'utf8',maxBuffer:16*1024*1024}));
 git('fetch','--no-tags','--depth=1','origin',parent);
 // Discard only this disposable job's staged copy, after preserving its patch.
 git('reset','--hard',parent);
 assert.equal(git('status','--porcelain'),'');
 git('apply','--3way','--index',patch);
 assert.equal(git('rev-parse','HEAD'),parent);
 assert.equal(git('diff','--name-only'),'');
 assert.deepEqual(git('diff','--cached','--name-only').split('\n').sort(),allowed);
 assert.equal(git('diff','--cached','--name-only','--','src'),'', 'Application source must be unchanged from actual current main');
 const manifest=JSON.parse(read('scripts/qa/tenant-isolation-coverage-manifest.json'));
 const baseline=JSON.parse(git('show','HEAD:scripts/qa/tenant-isolation-coverage-manifest.json'));
 assert.deepEqual([baseline.metrics.methods,baseline.metrics.coveredAfter,baseline.metrics.gap],[493,93,390]);
 assert.deepEqual([manifest.metrics.methods,manifest.metrics.coveredAfter,manifest.metrics.gap],[493,96,387]);
 const changed=new Set(['GET employees/import','GET compliance/filing-validations/[id]/file','GET compliance/statutory-remittances/posting-evidence/[id]']);
 for(const [path,route] of Object.entries(manifest.allApiRouteFiles)) {
  assert.equal(route.gitBlobSha,baseline.allApiRouteFiles[path].gitBlobSha,path+' current-main route hash');
  for(const method of route.methods) if(!changed.has(method.name+' '+route.route))
   assert.deepEqual(method,baseline.allApiRouteFiles[path].methods.find(m=>m.name===method.name),path+' unrelated classification');
 }
 assert.deepEqual(manifest.scopedPages,baseline.scopedPages);
 console.log('CURRENT_MAIN_CLOSEOUT '+JSON.stringify({parent,originalReviewedHead:original,covered:96,public:10,gaps:387,pageGaps:20,changedApplicationFiles:0}));
 console.log(git('diff','--cached','--stat'));
} else if(process.argv[2] === 'publish-tree') {
 assert.equal(git('rev-parse','HEAD'),parent);
 assert.ok(process.env.GH_TOKEN);
 assert.equal(git('diff','--name-only'),'');
 assert.deepEqual(git('diff','--cached','--name-only').split('\n').sort(),allowed);
 assert.equal(existsSync(retired),false);
 const api=async(path,body)=>{
  const r=await fetch('https://api.github.com/repos/'+repo+path,{method:'POST',headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw Error('Git object request failed '+r.status+' '+await r.text());
  return r.json();
 };
 const tree=[];
 for(const path of allowed){
  if(!existsSync(path)){tree.push({path,mode:'100644',type:'blob',sha:null});continue;}
  const blob=await api('/git/blobs',{content:read(path),encoding:'utf-8'});
  assert.equal(blob.sha,git('hash-object',path));
  tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
 }
 const result=await api('/git/trees',{base_tree:git('rev-parse','HEAD^{tree}'),tree});
 assert.equal(result.sha,git('write-tree'));
 console.log('REVIEWED_MAIN_TREE '+JSON.stringify({sha:result.sha,parent,files:allowed}));
 // No ref update, pull request, or merge is performed here.
} else throw Error('Expected rebase or publish-tree');
