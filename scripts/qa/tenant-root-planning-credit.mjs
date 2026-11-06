import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

export const ROOT_METHODS=["POST workforce-planning","PATCH workforce-planning"];
const FILE="scripts/qa/tenant-root-planning-credit-receipt.json";
const MANIFEST="scripts/qa/tenant-isolation-coverage-manifest.json";
const hash=value=>createHash("sha256").update(value.toString().replaceAll("\r\n","\n")).digest("hex");
const read=path=>readFileSync(path);
const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
export function verifyRootCredits(manifest,reader=read){
  assert.equal(hash(reader(FILE)),"0ad6015febbbd52a0216a34f5044859d8b0d32036f1be99c48dd3fcd359248d2","root receipt identity changed");
  const receipt=JSON.parse(reader(FILE));
  assert.deepEqual(Object.keys(receipt.methods),ROOT_METHODS);
  assert.equal(receipt.head,"3cc07639c617f447187447d3fd2f5cf2d0fd7ec6");
  assert.equal(receipt.run,41815695216);assert.equal(receipt.job,126525742584);
  for(const [path,digest] of Object.entries(receipt.pins))assert.equal(hash(reader(path)),digest,path+": root proof input drift");
  for(const key of ROOT_METHODS){
    const verb=key.split(" ")[0], method=manifest.allApiRouteFiles["src/app/api/workforce-planning/route.ts"].methods.find(m=>m.name===verb);
    assert.equal(method.status,"COVERED");assert.deepEqual(method.testedBy,receipt.methods[key]);
    assert.equal(method.reviewedUncertified,undefined);
    const proof=method.testedBy;
    const declaration=reader(proof.rowFile).toString().split("\n").slice(proof.rowLine-1,proof.rowLine+1).join("");
    assert.ok(declaration.includes('key: "'+key+'"'),"exact multiline root method declaration required");
    const lines=reader(proof.file).toString().split("\n");
    assert.ok(lines[proof.ownPositiveLine-1].includes('const owned = expectStatus(await request(urlFor("own"),'));
    assert.ok(lines[proof.foreignDenialLine-1].includes('const foreign = expectStatus(await request(urlFor("foreign"),'));
    assert.ok(lines[proof.unchangedDbLine-1].includes('assert.deepEqual(victimAfter, victimBefore,'));
  }
  return 2;
}

export function creditRoot(args){
  if(args.includes("--check")){verifyRootCredits(JSON.parse(read(MANIFEST)));console.log("two source-matched root credits verified; no writes");return;}
  const label="GitHub Actions 41815695216/126525742584 PG16 root-planning PASS";
  assert.equal(args[args.indexOf("--run-label")+1],label,"actual root-planning receipt required");
  const proofHead="3cc07639c617f447187447d3fd2f5cf2d0fd7ec6";
  execFileSync("git",["merge-base","--is-ancestor","30b2db3794ad4b73df219442e645a4fc3817fd35","HEAD"]);
  assert.equal(git("rev-parse","3dd7fb49e6cf6232e9f4462b4d39fd9226538b52^{tree}"),git("rev-parse",proofHead+"^{tree}"),"executed PR merge tree must equal reviewed proof source");
  const paths=["src/app/api/workforce-planning/route.ts","scripts/qa/tenant-table-rows/write/workforce-planning-root.mjs",
    "scripts/qa/tenant-write-table-http.mjs","scripts/qa/tenant-table-http.mjs","scripts/qa/tenant-table-invariants.mjs",
    "scripts/qa/tenant-table-loader.mjs","scripts/qa/tenant-table-env.mjs",
    ".github/workflows/tenant-wrk02-batch3-root.yml","scripts/qa/apply-isolated-baseline.mjs","scripts/qa/prepare-hcm-work-item-fixture.mjs",
    "src/lib/auth.ts","src/lib/access.ts","src/lib/audit.ts","src/lib/security-request.ts","src/lib/security-secret.ts",
    "src/lib/hcm-business-process.ts","src/lib/hcm-position-assignment-guard.ts","src/lib/workflow-entity-hold.ts",
    "src/lib/critical-release-flags.ts","package-lock.json",
    ...git("ls-tree","-r","--name-only",proofHead,"src/db").split("\n")];
  // Source identity is checked before asking the canonical table-credit tool
  // to generate either method. No runtime proof is inferred from source tests.
  const pins={};for(const path of paths){
    const prior=execFileSync("git",["show",proofHead+":"+path]);
    assert.equal(hash(read(path)),hash(prior),path+": reviewed passing source changed");pins[path]=hash(prior);
  }
  const old=JSON.parse(read(MANIFEST));
  for(const verb of ["POST","PATCH"])assert.equal(old.allApiRouteFiles["src/app/api/workforce-planning/route.ts"].methods.find(m=>m.name===verb).status,"GAP");
  execFileSync(process.execPath,["scripts/qa/tenant-table-credit.mjs",...ROOT_METHODS.flatMap(k=>["--only-key",k]),"--run-label",label],{stdio:"inherit"});
  const manifest=JSON.parse(read(MANIFEST));const methods={};
  for(const key of ROOT_METHODS){const method=manifest.allApiRouteFiles["src/app/api/workforce-planning/route.ts"].methods.find(m=>m.name===key.split(" ")[0]);
    method.testedBy={...method.testedBy,proofPullRequest:1755,verifiedPrHeadSha:proofHead,executedMergeSha:"3dd7fb49e6cf6232e9f4462b4d39fd9226538b52",mergedProofCommit:"30b2db3794ad4b73df219442e645a4fc3817fd35",workflowRunId:41815695216,workflowJobId:126525742584,
      independentSecurityReview:"PENDING",productionTested:false,
      actionEvidence:"Both employers: seven entity types and a real direct assignment; vacancy freeze, governed review requests, forbidden transitions, victim/missing-ID parity, parallel-freeze single audit."};
    delete method.reviewedUncertified;methods[key]=method.testedBy;
  }
  const receipt={head:proofHead,run:41815695216,job:126525742584,pins,methods};
  writeFileSync(FILE,JSON.stringify(receipt,null,2)+"\n");
  writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+"\n");
  const planPath="docs/engineering/tenant-isolation-closure-plan.md";
  let plan=read(planPath).toString();
  plan=plan.replace(old.metrics.methods+" methods = "+old.metrics.coveredAfter+" COVERED + "+old.metrics.publicByDesign+" PUBLIC-BY-DESIGN + "+old.metrics.gap+" GAP",
    manifest.metrics.methods+" methods = "+manifest.metrics.coveredAfter+" COVERED + "+manifest.metrics.publicByDesign+" PUBLIC-BY-DESIGN + "+manifest.metrics.gap+" GAP");
  plan=plan.replace(/frozen 406 = (\d+) COVERED \+ 3 PUBLIC-BY-DESIGN \+ (\d+) GAP/,(_,c,g)=>"frozen 406 = "+(Number(c)+2)+" COVERED + 3 PUBLIC-BY-DESIGN + "+(Number(g)-2)+" GAP");
  plan=plan.replace(/(\| 5 \| \*\*WRK-02\*\* \| 39 \| )(\d+)( \| 0 \| )(\d+)( \| INCOMPLETE \|)/,(_,a,c,b,g,d)=>a+(Number(c)+2)+b+(Number(g)-2)+d);
  plan=plan.replace(/(Frozen subtotal \(2026-11-04 proposal\): \*\*)(\d+)( COVERED \+ 3 PUBLIC-BY-DESIGN \+ )(\d+)( GAP = 406\*\*)/,(_,a,c,b,g,d)=>a+(Number(c)+2)+b+(Number(g)-2)+d);
  writeFileSync(planPath,plan);
  console.log("rootReceiptSha256="+hash(read(FILE)));
}
