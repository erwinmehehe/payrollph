import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync,writeFileSync} from "node:fs";

const RECEIPT="scripts/qa/tenant-receipt-credit-receipt.json";
const ROUTE="src/app/api/expenses/receipts/route.ts";
const FILE="scripts/qa/tenant-receipt-boundary-http.mjs";
const MANIFEST="scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW="docs/engineering/tenant-isolation-coverage-inventory.md";
const PLAN="docs/engineering/tenant-isolation-closure-plan.md";
const sha=bytes=>createHash("sha256").update(bytes.toString().replaceAll("\r\n","\n")).digest("hex");
const read=path=>readFileSync(path);
export function receiptProofs(reader=read) {
  const bytes=reader(RECEIPT);
  assert.equal(sha(bytes),"c5ea33bc673d60c769f000d26f1f166745df3e6e09135c8ddf4c7885f82bd252","receipt identity changed");
  const receipt=JSON.parse(bytes);
  for(const [path,hash] of Object.entries(receipt.pins)) assert.equal(sha(reader(path)),hash,"receipt input drift: "+path);
  const text=reader(FILE).toString().replaceAll("\r\n","\n");
  const lines=text.split("\n");
  const anchor=fragment=>{
    const found=lines.flatMap((line,i)=>line.includes(fragment)?[i+1]:[]);
    assert.equal(found.length,1,"ambiguous receipt anchor: "+fragment);return found[0];
  };
  const shared={file:FILE,foreignDenialLine:anchor('assert.equal(foreign.status, 404);'),
    unchangedDbLine:lines.lastIndexOf('    assert.deepEqual(await snapshot(v), victimBefore);')+1,
    victimIdOrderingLine:anchor('assert.ok(v.claim.id > b.claim.id && v.claim.id > 6)'),
    twoAttackerLine:anchor('for (const f of [a, b])'),proofPullRequest:receipt.proofPr,
    verifiedPrHeadSha:receipt.head,mergedProofCommit:receipt.merge,workflowRunId:receipt.run,workflowJobId:receipt.job,
    evidence:'https://github.com/erwinmehehe/payrollph/actions/runs/'+receipt.run+'/job/'+receipt.job,
    sourceReceipt:RECEIPT,sourceReceiptSha256:sha(bytes),independentSecurityReview:"PENDING",productionTested:false,
    limitations:"Fictional HTTPS memory byte-store/scanner contract; not real S3 protocol, antivirus or provider acceptance."};
  assert.ok(shared.unchangedDbLine>shared.foreignDenialLine);
  assert.ok(text.includes('assert.throws(() => assertReceiptBytes(ownRead, v.bytes'));
  return Object.fromEntries(["GET","POST"].map(verb=>{
    const ownPositiveLine=anchor(verb==="GET"?'const ownRead = await request(f, f.claim.id);':'const uploaded = await request(f, f.claim.id, f.bytes, v.org.id);');
    return [verb,{...shared,line:ownPositiveLine,ownPositiveLine,
      scope:"Two independent owner employers; real own "+verb+", higher-ID victim refusal, forged selectors, immutable victim SQL; synthetic PG16 only."}];
  }));
}
export function verifyReceiptCredits(manifest,reader=read){
  const row=manifest.allApiRouteFiles[ROUTE], proofs=receiptProofs(reader);
  for(const verb of ["GET","POST"]){const method=row.methods.find(x=>x.name===verb);
    assert.equal(method.status,"COVERED");assert.deepEqual(method.testedBy,proofs[verb]);
    assert.equal(method.reviewedUncertified,undefined);
  }return 2;
}
export function credit(args){
  const receipt=JSON.parse(read(RECEIPT));
  const label='GitHub Actions '+receipt.run+'/'+receipt.job+' PG16 receipt-boundary PASS';
  assert.equal(args.filter(x=>x==='--run-label').length,1);
  assert.equal(args[args.indexOf('--run-label')+1],label,"executed receipt required");
  const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
  execFileSync('git',['merge-base','--is-ancestor',receipt.merge,'HEAD']);
  assert.equal(git('rev-parse',receipt.merge+'^2'),receipt.head);
  assert.ok(git('log','-1','--format=%s',receipt.merge).startsWith('Merge pull request #1772 '));
  assert.equal(git('diff','--name-only',receipt.head,'HEAD','--','src/db','src/app/api/expenses/receipts'),"");
  const proofs=receiptProofs(), manifest=JSON.parse(read(MANIFEST)), row=manifest.allApiRouteFiles[ROUTE];
  const before={covered:manifest.metrics.coveredAfter,gap:manifest.metrics.gap};
  for(const verb of ["GET","POST"]){const m=row.methods.find(x=>x.name===verb);assert.equal(m.status,'GAP');assert.equal(m.testedBy,null);
    m.status='COVERED';m.reason='Provisional: merged #1772 source-matched two-attacker receipt '+label+'; independent security review PENDING; synthetic storage only, no production certification.';
    m.testedBy=proofs[verb];delete m.reviewedUncertified;
  }
  const all=Object.values(manifest.allApiRouteFiles).flatMap(r=>r.methods);
  manifest.metrics.coveredAfter=all.filter(m=>m.status==='COVERED').length;
  manifest.metrics.gap=all.filter(m=>m.status==='GAP').length;
  assert.equal(manifest.metrics.coveredAfter,before.covered+2);assert.equal(manifest.metrics.gap,before.gap-2);
  manifest.acceptanceStatus=manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+manifest.metrics.gap+' API methods');
  let overview=read(OVERVIEW).toString();
  for(const [field,old,value] of [['coveredAfter',before.covered,manifest.metrics.coveredAfter],['gap',before.gap,manifest.metrics.gap]]){
    const target='| '+field+' | '+old+' |';assert.ok(overview.includes(target));overview=overview.replace(target,'| '+field+' | '+value+' |');
  }
  const lines=overview.split('\n');
  for(const verb of ['GET','POST']){const start='| [`expenses/receipts` '+verb+']';const i=lines.findIndex(l=>l.startsWith(start));assert.ok(i>=0);
    assert.ok(lines[i].endsWith('| **GAP** |'));lines[i]=lines[i].replace('| **GAP** |','| **COVERED** |').replace('NO VALID METHOD PROOF','[merged receipt HTTP proof]('+proofs[verb].evidence+')');
  }
  overview=lines.join('\n').replace(/(\*\*RELEASE BLOCKER:\*\* )\d+( API methods)/,'$1'+manifest.metrics.gap+'$2')
    .replace(/(\*\*NOT ACCEPTED\*\*: )\d+( method gaps)/,'$1'+manifest.metrics.gap+'$2');
  overview='> **Receipt provisional credits:** '+manifest.metrics.coveredAfter+' COVERED / '+manifest.metrics.gap+' GAP; '+proofs.GET.evidence+'; synthetic storage, independent review PENDING.\n\n'+overview;
  let plan=read(PLAN).toString();
  const live=manifest.metrics.methods+' methods = '+before.covered+' COVERED + '+manifest.metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+before.gap+' GAP';
  assert.ok(plan.includes(live));
  plan=plan.replace(live,manifest.metrics.methods+' methods = '+manifest.metrics.coveredAfter+' COVERED + '+manifest.metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+manifest.metrics.gap+' GAP');
  plan=plan.replace(/frozen 406 = (\d+) COVERED \+ 3 PUBLIC-BY-DESIGN \+ (\d+) GAP/,(_,c,g)=>'frozen 406 = '+(Number(c)+2)+' COVERED + 3 PUBLIC-BY-DESIGN + '+(Number(g)-2)+' GAP');
  const batch=/\| 2 \| \*\*MNY-02\*\* \| 33 \| (\d+) \| 0 \| (\d+) \| INCOMPLETE \|/;
  assert.ok(batch.test(plan));
  plan=plan.replace(batch,(_,c,g)=>'| 2 | **MNY-02** | 33 | '+(Number(c)+2)+' | 0 | '+(Number(g)-2)+' | INCOMPLETE |');
  const frozen=/Frozen subtotal \(2026-11-04 proposal\): \*\*(\d+) COVERED \+ 3 PUBLIC-BY-DESIGN \+ (\d+) GAP = 406\*\*/;
  assert.ok(frozen.test(plan));plan=plan.replace(frozen,(_,c,g)=>'Frozen subtotal (2026-11-04 proposal): **'+(Number(c)+2)+' COVERED + 3 PUBLIC-BY-DESIGN + '+(Number(g)-2)+' GAP = 406**');
  verifyReceiptCredits(manifest);
  if(!args.includes('--check')){writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+'\n');writeFileSync(OVERVIEW,overview);writeFileSync(PLAN,plan);}
  console.log(JSON.stringify({methods:2,covered:manifest.metrics.coveredAfter,gap:manifest.metrics.gap,write:!args.includes('--check')}));
}
