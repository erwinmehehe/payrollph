import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { verifyWorker360PageCredit } from "./tenant-five-method-credit-verify.mjs";
import { reconcileStudioPostCredit } from "./tenant-studio-post-credit.mjs";
const m=JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
const pageGaps=verifyWorker360PageCredit(m);
assert.equal(pageGaps,17,"Only the exact uncredited Worker 360 supersession is allowed");
const methods=Object.values(m.allApiRouteFiles).flatMap(r=>r.methods);
for(const [key,status] of [["coveredAfter","COVERED"],["gap","GAP"],["publicByDesign","PUBLIC-BY-DESIGN"],["privilegedOperationsTokenOnly","PRIVILEGED-OPERATIONS-TOKEN-ONLY"]])
  m.metrics[key]=methods.filter(x=>x.status===status).length;
m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods and \d+ page\/action GAPs/,"NOT ACCEPTED: "+m.metrics.gap+" API methods and "+pageGaps+" page/action GAPs");
const note=" Worker 360 legal-employer source supersession: previous API/SSR receipts remain historical; changed sources are GAP with zero new credits.";
if(!m.acceptanceStatus.includes(note))m.acceptanceStatus+=note;
writeFileSync("scripts/qa/tenant-isolation-coverage-manifest.json",JSON.stringify(m,null,2)+"\n");
const banner="> **SOLO_VERIFIED_DEV_RECOVERY Worker 360 source supersession:** "+m.metrics.methods+" methods = "+m.metrics.coveredAfter+" COVERED + "+m.metrics.publicByDesign+" PUBLIC-BY-DESIGN + "+m.metrics.privilegedOperationsTokenOnly+" TOKEN-ONLY + "+m.metrics.gap+" GAP; "+pageGaps+" page/action GAPs. One changed API and page lose historical provisional credit. Zero new credits; production acceptance pending.\n\n";
for(const path of ["docs/engineering/tenant-isolation-coverage-inventory.md","docs/engineering/tenant-isolation-closure-plan.md"]){
  let doc=readFileSync(path,"utf8");
  if(!doc.includes(banner))doc=banner+doc;
  for(const key of ["coveredAfter","gap"])doc=doc.replace(new RegExp("\\| "+key+" \\| \\d+ \\|","g"),"| "+key+" | "+m.metrics[key]+" |");
  doc=doc.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods and \d+ business-ID page entries/g,"**RELEASE BLOCKER:** "+m.metrics.gap+" API methods and "+pageGaps+" business-ID page entries");
  doc=doc.replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps and \d+ page\/action gaps/g,"**NOT ACCEPTED**: "+m.metrics.gap+" method gaps and "+pageGaps+" page/action gaps");
  writeFileSync(path,doc);
}
assert.equal(m.allApiRouteFiles["src/app/api/automation-studio/route.ts"].methods.find(x=>x.name==="POST").status,"COVERED","Preserve merged Studio receipt");
assert.equal(reconcileStudioPostCredit({write:true}).credited,0,"Accounting cannot promote another method");
console.log(JSON.stringify({apiCovered:m.metrics.coveredAfter,apiGaps:m.metrics.gap,pageGaps,newCredits:0,httpExecuted:false}));

