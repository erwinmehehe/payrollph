import {verifyNarrowStudioAutomationSource,HISTORIC_AUTOMATION_SHA} from './tenant-studio-automation-source-compat.mjs';
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
export const APPROVALS_PATH='src/app/api/approvals/[id]/route.ts';
export const APPROVALS_PINS=Object.freeze({
  ".github/workflows/tenant-approvals-recovery.yml": "475e602fc527403445e8c291b426ca2ce00efbfc",
  "docs/sql/source-baseline-supplement.sql": "9acc7896f4ea382917da7acd53984e73c6aface3",
  "drizzle/0109_tamper_evident_audit_chain.sql": "b8cf23d83e80822210309e31f6d6c25ff7e0ba07",
  "next.config.ts": "72fe25fba8c44a20c29eabfd85568114f5c70c6f",
  "package-lock.json": "49a688969f37bd3fd690d313970221ff2d5f7fc2",
  "package.json": "7078c01f09c85f79dd79ba5517a80e80cdb72ae3",
  "scripts/qa/apply-isolated-baseline.mjs": "75b9e7f1b39a6ca5b2253086e519ae7d71229255",
  "scripts/qa/money-proof-target.mjs": "fe153c3222d799d4badebdf8edf71103058e0b5e",
  "scripts/qa/tenant-approval-delegated-proof.mjs": "140f500e6619da489b97fb1322e770b6a3aa7077",
  "scripts/qa/tenant-approval-flows-contract.mjs": "aff3a0daf4aabebb56816a05217834080f418190",
  "scripts/qa/tenant-approval-flows-http.mjs": "76f0a9657fd7d34caaddac553f8bea722351aa15",
  "scripts/qa/tenant-approval-payroll-decline-proof.mjs": "408dce1a31d45dddb5530728c9b21187f44a0019",
  "scripts/qa/tenant-approval-sources-contract.mjs": "66371897f18d87e2b2ca3dd8215573a95d8ea104",
  "scripts/qa/tenant-approval-sources-http.mjs": "80fb6bd436d04a572dd75b9c3ef426f9ff78c207",
  "scripts/qa/tenant-approval-task-contract.mjs": "aec1742a120c93e7c2f54ab127bd8312501c733a",
  "scripts/qa/tenant-approval-task-http.mjs": "849fcb15f0c2b9770269b372f81c6837d2422e07",
  "scripts/qa/tenant-approval-types-contract.mjs": "acb26fa3ef9017df7b2bf50c35e600e6ca6e66b6",
  "scripts/qa/tenant-approval-types-http.mjs": "d77891b26aeddba8700a1fc9f1a7385cc5752a7b",
  "scripts/qa/tenant-legal-employer-admin-proof.mjs": "b47226154e683f384f01528777204e251465c63d",
  "scripts/qa/tenant-money-lifecycle-http.mjs": "7ef27a2cac748fca42b85b8e083851bcea6d95f3",
  "scripts/qa/tenant-read-recovery-snapshot.mjs": "89c1976d3fce5842bce84a87754d830e54c675a6",
  "scripts/qa/tenant-table-catalog.mjs": "77a8814d522fa89a9ac890f2b4725a4259847ad4",
  "scripts/qa/tenant-table-env.d.mts": "8cbc53fab338fc6a7ee2c3add773bb581c52999a",
  "scripts/qa/tenant-table-env.mjs": "05dcdcdbd513b0e257b6aefb5d9449117224b357",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
  "scripts/qa/tenant-table-invariants.mjs": "52f9acded7750a722cb663b9eeb6ea0a709ecd9b",
  "scripts/qa/tenant-table-loader.mjs": "86660dc3b55b655d75429d04ef22c4d50a7df7fe",
  "scripts/qa/tenant-table-path.mjs": "aa84a05716961b2b01e4ab4d1e5e5dfd5a31d6f1",
  "src/app/api/approvals/[id]/route.ts": "7a93ce87ea453be87631a18086c3f93636d538c2",
  "src/db/index.ts": "7a5718d0a99ce5b3a7f0f25e385f79a61be807f6",
  "src/db/schema.ts": "3f504163c9847a99434a5e01a72c120dfd680a02",
  "src/lib/access.ts": "08d3481dbd20279a4a8aef64f0932f79bec48444",
  "src/lib/account.ts": "e9fd7448970b49fa10d97c67478a71ceb0b91c75",
  "src/lib/approval-chains.ts": "db9f117cc2891067e2c9680583fc12b48e54aac4",
  "src/lib/approval-escalation-notifications.ts": "170d6845d23c573462cd43599f2a3b756289cee5",
  "src/lib/approval-human-separation.ts": "a71f6e927e6fa09970f81bd8e6ae22f8830565d4",
  "src/lib/approval-source-tenant-boundary.ts": "84b2c56b2741659cb569ef7e74a61f163cb74a17",
  "src/lib/approved-exit-payroll.ts": "4f5baf79359d67535fdfa1b640317869b382785c",
  "src/lib/audit.ts": "3aa8f2c627884072c0c294dbf7861980b302927c",
  "src/lib/auth.ts": "b13275e0e09b629ddb679c55e7898da44c72ad20",
  "src/lib/automation-change-events.ts": "dbe588ee67f7c6f823b8e8b203e40273d6ed94c5",
  "src/lib/automation-document-generation.ts": "441bcddb0e7347d5430a665bc0e87e14725b9e13",
  "src/lib/automation-document-templates.ts": "a5576257cba98bfe39132fb94024b7c04d2e5681",
  "src/lib/automation-execution-recovery.ts": "ecc727efb94ed78bd73ce7389ad4ef8aee264659",
  "src/lib/automation-operational-cases.ts": "5355d830524f54e6d47dd551c9d7bc5e73649f52",
  "src/lib/automation-webhook-context.ts": "9c7ef04d910a119682964d14cfe4c9818c9eccbb",
  "src/lib/automation.ts": "288d27789e062803d68ea38fd41fa78ee155a1ee",
  "src/lib/bank-account-crypto.ts": "350ab8def720f4c69a6e9a41e2b85d5b708affa5",
  "src/lib/critical-release-flags.ts": "aa9867f795bbcbe9cfe42c6df7f64d0f0c4a9671",
  "src/lib/crypto.ts": "2316f58f15961e25ffee0353e107e993b630206c",
  "src/lib/delegation.ts": "4e01ca02ce83cdf42610b1e87a40a72bf2360abf",
  "src/lib/demo-security.ts": "10f8fa0a7894a66d902ebde5ac4a4e7dee5c1590",
  "src/lib/document-object-storage.ts": "5c209c44dc8e5bde6b68de7ade22a5819ac1bef4",
  "src/lib/document-schema-compat.ts": "33fcf0a7e3eec6163f7a3b55103b3bdbe6f8968d",
  "src/lib/dynamic-group-authorization.ts": "8e0fc03182c0936571c7d0e16610d3658c8cec4d",
  "src/lib/dynamic-worker-group-conditions.ts": "d00a3315a3c4f7fe815fdff5108d8affdfd2c552",
  "src/lib/dynamic-worker-groups.ts": "15581d0ae9995b037310f03d8ffac59c630c9229",
  "src/lib/employee-document-vault.ts": "bb23f8f8d0cba3bd76c22a24644f8bacec73b926",
  "src/lib/employee-vault-object-reconciliation.ts": "0b1813421cdef8f32747145db4697745cc31d3a7",
  "src/lib/employee-vault-profile.ts": "911f7b6c06aca662c1aa6d33adf015dcc907c97f",
  "src/lib/enterprise-session.ts": "1d3b4d6746a3a1c12fb220299eea7df3e54f29e5",
  "src/lib/ess-profile-schema.ts": "18f5ad183844efde757c12ea74b8ce7e742e3d4d",
  "src/lib/governed-approval-handoffs.ts": "e303744032016897a2db768ef6182634ec0fb51b",
  "src/lib/government-id-crypto.ts": "2b24f55aba6f4032416e5557b3527d3519fafe88",
  "src/lib/hcm-business-process.ts": "c59ad463c3600f293b106e538019ad6692a19b46",
  "src/lib/hcm-documents.ts": "7a40bd59f1a8308d67c3eb7f4ce750545aad4c36",
  "src/lib/hcm-effective-changes.ts": "5e11f82d184a135012955ddee79998ac0fa4481d",
  "src/lib/hcm-effective-source-integrity.ts": "9a92cc84d3552bf70a91cc9857bd5fc7968db48e",
  "src/lib/hcm-leave-employment.ts": "bf051b386c7d08590e50931c578d9226e8feae98",
  "src/lib/hcm-position-business-process.ts": "2017c0533c0ded0fe5e8c8d82d15f320c6b7f9bb",
  "src/lib/hcm-work-period-guard.ts": "783b5560d80d1053bb1d028da34c03311a07cd9f",
  "src/lib/integration-connectors.ts": "d3d1f4ce62016052c838a32c77b533f600e66ecc",
  "src/lib/integration-secret.ts": "40236bc1510239faf32c1263907603b70a6e73cc",
  "src/lib/mail-provider.ts": "ad6356cb445d719d627b28ada831499f45b8cbd5",
  "src/lib/mailer.ts": "f23dfb3cf26dccf1ea1d793320c756efaaa390c5",
  "src/lib/managed-payroll.ts": "830124977fdbbb15428f18b3ab5c5c3bb40fbc87",
  "src/lib/multi-entity-hcm-hold.ts": "3b05a6ca3cf157513d37a55ccb3bf2f8002579cc",
  "src/lib/multi-entity-policy.ts": "9aacd6cd3c7147d383608d162e89be7e822cc044",
  "src/lib/multi-entity-registration-storage.ts": "57364cd16ac51c5d22fac7f8bb1688dbeb2659b2",
  "src/lib/multi-entity-run-guard.ts": "cbc620684196298a8716bfc7d799e96fef8fc374",
  "src/lib/multi-entity-selector-boundary.ts": "690e773e2b5d3e89d7747a095b5d5f0717844d13",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
  "src/lib/mwe-classification.ts": "ee82741f6405e59dff3e9eb48cfb9820b449c99a",
  "src/lib/organization-auth-policy.ts": "b38486fda78ac0da767bf79d7b9b6e9f4cfec08e",
  "src/lib/outbox-schema.ts": "c0baa9adfc257fe1baaacbf7a71e2f5c1dce5a0b",
  "src/lib/pay-basis.ts": "f6b203eddca9e183311ea42ff0689c3a968b48d4",
  "src/lib/payroll-approval-integrity.ts": "222dfa661657ceae7ebf081ea34aeb92e23ddf10",
  "src/lib/payroll-assurance-server.ts": "b9f13bcc26253211409c3cc27deb1318650b908e",
  "src/lib/payroll-assurance.ts": "8f0cdf3cdd12fbf4d42daf471d0f732ee17da082",
  "src/lib/payroll-connected-release-gate-server.ts": "cdaa944e038760a4b346edf939b2515f4b174ebf",
  "src/lib/payroll-connected-release-gate.ts": "cbfca594f67319e3f12bf8ec6209dd192e721f65",
  "src/lib/payroll-period-ui.ts": "69809c7ab56618b5b2299439654007e41e40b0d1",
  "src/lib/payroll-period-validation.ts": "bc67f500ed47f47e093d3265639de1b852914423",
  "src/lib/payroll-rules.ts": "4bf8c0482a0f4439cd8b175a97b589f7d9945baa",
  "src/lib/permission-overlay-absence.ts": "ad995a329485ccabd23cddbf0c56a8a0b3de2673",
  "src/lib/permissions.ts": "9878a2ab0afb6f0b14a0e9c0e24a095a3f2e0288",
  "src/lib/pg-tls-policy.ts": "d78604400731d75c5c50912d981402d611d06e60",
  "src/lib/ph-statutory-rule-packs.ts": "90f35dc102b1c6c4af954fb98df1e4eaef504bf9",
  "src/lib/rate-limit-memory.ts": "04e8d2c464aeba483132e60f80ec6f766d7ab218",
  "src/lib/rate-limit.ts": "05d7be3acb385e3542cf0ec3904a74796f0647b5",
  "src/lib/request-schema-readonly.ts": "3ce74abab1959a9362d16bc67d6d643dad25e98f",
  "src/lib/security-network.ts": "f263da3898451ee53c7b3d1490241ea8aa46e0c2",
  "src/lib/security-request.ts": "de996ebb7eb663aaebf65f8a963d955b8bc90c9d",
  "src/lib/slack-connector.ts": "a6d2a3867eaea6d8c0e30f000d90346852316293",
  "src/lib/storage.ts": "8d4c5816d1d651eb421f2cdbaf7dd1722544270a",
  "src/lib/tenant-module-storage.ts": "b2d303007f8a3a383cb44e0d2cb8f17e4cdfa3ea",
  "src/lib/tenant-modules.ts": "c82266f63fbe8b00f1aa92025f06cc4ec62951d9",
  "src/lib/validation.ts": "3f96d328ab20f5eda147d14f214257f8044958ac",
  "src/lib/wage-orders.ts": "2ea37036211a846ff515540d6b982760df8db1eb",
  "src/lib/webhook-backoff.ts": "876fe7fa4742f2983a433bb8b23c22a80b112359",
  "src/lib/webhook-signing.ts": "1755f15e5ea9ef6a2c873571a3f144b9e05db827",
  "src/lib/webhooks.ts": "2643845237a0dd9de160e3fb9734459edb969abf",
  "src/lib/worker-attribute-context.ts": "f28ed9b3e3cbb198cc593dd13136515393e86c93",
  "src/lib/workforce-absence-intervals.ts": "37b4a9d38059dacabaaeccced6fa2d8dd41865b3",
  "src/lib/workforce-absence.ts": "a5b9652ef76b76a9b101410afeebd23ce85ddaf5",
  "src/lib/workforce-attendance.ts": "d44f5f20b5a6a92f9121fe86348298c09cdff39e",
  "src/lib/workforce-overtime.ts": "b9bf66560f514d743dd4f9ce0362d0dda030a761",
  "src/lib/workforce-payroll.ts": "9581b6e7ca30c1e6cbb9810a23a484b80dfa02d1",
  "src/lib/workforce-schedule-assignment.ts": "02f16d35dd6f62e5b239346596cdec5d2aa66d52",
  "src/lib/workforce-schedule-guardrails.ts": "5fa0e8740932c28f9198854c5fc16af47d71f886",
  "src/lib/workforce-schedule-window.ts": "1006ff86fbc6fae8d4d707601742e9fee0d9629e",
  "src/lib/workforce-scheduling.ts": "28d56a0ff054e4b65f1d2479eabc99b6ec13ac4c",
  "src/lib/workforce-timesheet-expectations.ts": "72bc10aea7e46bbf21454f6b4795599c6f617e64",
  "src/lib/workforce-timesheet-server.ts": "6eac417a56097fbd6125c7b78de0e6c5dd413295",
  "src/lib/workforce-timesheet.ts": "6f1f50b7329899530bd0ec0cb52bbdaa2b757b44",
  "src/lib/workforce-worksite.ts": "32953d8ddecc1e443e66f79e9da89a21c26ca786",
  "tsconfig.json": "51b2236817d4f86d64198a483b0207941862d212"
});
const RECEIPT='scripts/qa/tenant-approvals-recovery-receipt.json',SEALED='c86b6c582de88772319ff10649dad03963695453',MANIFEST='scripts/qa/tenant-isolation-coverage-manifest.json',INVENTORY='docs/engineering/tenant-isolation-coverage-inventory.md',PLAN='docs/engineering/tenant-isolation-closure-plan.md';
const blob=x=>{const b=Buffer.from(x);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')};
export function approvalEvidence(read=readFileSync){const raw=read(RECEIPT);assert.equal(blob(raw),SEALED,'Execution receipt drift');const r=JSON.parse(raw);assert.equal(r.sourceHead,'6f1a193f8b56eb52174c33e7caf4335d8a8c95e7');assert.equal(r.run,42842335605);assert.equal(r.label,'SOLO_VERIFIED_DEV_RECOVERY');assert.equal(r.productionAccepted,false);assert.deepEqual(r.jobs.map(j=>j.name).sort(),['approval-types-http','complete-method-receipt','fictional-approval-flows-http','fictional-approval-http','fictional-approval-sources-http','money-lifecycle-pg16 (false)','money-lifecycle-pg16 (true)'].sort());for(const j of r.jobs){assert.equal(j.result,'success');assert.equal(j.output.length,1);}for(const[p,s]of Object.entries(APPROVALS_PINS)){
  if(p==='src/lib/automation.ts'){
    assert.equal(s,HISTORIC_AUTOMATION_SHA,'Original immutable receipt pin changed');
    verifyNarrowStudioAutomationSource(read);
  } else assert.equal(blob(read(p)),s,'Fresh HTTP proof needed: '+p);
 }return r;}
export function expectedApprovalsReceipt(read=readFileSync){const r=approvalEvidence(read);return {file:'scripts/qa/tenant-approval-types-http.mjs',line:326,ownPositiveLine:326,foreignDenialLine:230,forgedSelectorLine:343,unchangedDbLine:354,routeBlobSha:APPROVALS_PINS[APPROVALS_PATH],proofBlobSha:APPROVALS_PINS['scripts/qa/tenant-approval-types-http.mjs'],receiptFile:RECEIPT,receiptBlobSha:SEALED,sourceHead:r.sourceHead,workflowRunId:r.run,workflowJobs:r.jobs.map(j=>({name:j.name,id:j.id})),evidence:'https://github.com/erwinmehehe/payrollph/actions/runs/42842335605',evidenceLabel:r.label,postgresMajor:16,providerCalled:false,productionCertified:false,independentlyAccepted:false,independentSecurityReview:'PENDING',scope:'Complete same-head PG16 HTTP gate: generic approve/decline, leave/chain, HCM/workforce/handoffs/automation, dynamic groups, delegation, payroll approve/reject and both exact-link profiles; owned SQL transitions, real victim denials, forged selectors and unchanged foreign SQL/audits. No production acceptance.'};}
export function verifyApprovalsCredit(m,read=readFileSync){const route=m.allApiRouteFiles[APPROVALS_PATH],row=route.methods.find(x=>x.name==='PATCH');assert.equal(route.gitBlobSha,APPROVALS_PINS[APPROVALS_PATH]);assert.equal(row.status,'COVERED');assert.equal(row.reviewedUncertified,undefined);assert.deepEqual(row.testedBy,expectedApprovalsReceipt(read));return 1;}
const FILING_BANNER_PREFIX='> **SOLO_VERIFIED_DEV_RECOVERY — approvals PATCH proposal, NOT production acceptance:** ';
export function withApprovalsStatusBanner(text,metrics,pageGaps){
 // Replace only this writer's leading checkpoint(s); retain other proof history.
 // A wording/count update must not prepend another copy on each reconciliation.
 let rest=text;
 while(rest.startsWith(FILING_BANNER_PREFIX)){
  const end=rest.indexOf('\n');rest=end<0?'':rest.slice(end+1).replace(/^\n+/,'');
 }
 return FILING_BANNER_PREFIX+metrics.methods+' methods = '+metrics.coveredAfter+' COVERED + '+metrics.publicByDesign+' PUBLIC-BY-DESIGN + '+metrics.privilegedOperationsTokenOnly+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+metrics.gap+' GAP. [Fresh main combined-family receipt](../../scripts/qa/tenant-approvals-recovery-receipt.json). Both the approvals PATCH and the separately merged BIR candidate POST have distinct provisional evidence; '+pageGaps+' page/action gaps remain. Independent security/payroll review and production acceptance are pending.\n\n'+rest;
}
export function reconcileApprovalsCredit({write=false}={}){
 const m=JSON.parse(readFileSync(MANIFEST,'utf8')),before={covered:m.metrics.coveredAfter,gap:m.metrics.gap};
 const row=m.allApiRouteFiles[APPROVALS_PATH].methods.find(x=>x.name==='PATCH');
 if(row.status==='GAP'){assert.equal(row.testedBy,null);row.status='COVERED';delete row.reviewedUncertified;row.testedBy=expectedApprovalsReceipt();row.reason='SOLO_VERIFIED_DEV_RECOVERY: all six same-head PG16 HTTP approval proof executions passed; exact-source receipt and pins, no provider/agency or production acceptance.';}
 verifyApprovalsCredit(m);
 const methods=Object.values(m.allApiRouteFiles).flatMap(r=>r.methods);
 for(const [field,status]of [['coveredAfter','COVERED'],['gap','GAP'],['publicByDesign','PUBLIC-BY-DESIGN'],['privilegedOperationsTokenOnly','PRIVILEGED-OPERATIONS-TOKEN-ONLY']])m.metrics[field]=methods.filter(x=>x.status===status).length;
 m.acceptanceStatus=m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/,'NOT ACCEPTED: '+m.metrics.gap+' API methods');
 const note='SOLO_VERIFIED_DEV_RECOVERY approvals PATCH credit: '+m.metrics.coveredAfter+' COVERED / '+m.metrics.gap+' GAP; source-sealed combined-family PG16 proof, no production acceptance.';
 if(!m.acceptanceStatus.includes(note))m.acceptanceStatus+=' '+note;
 let overview=readFileSync(INVENTORY,'utf8');const pageGaps=m.scopedPages.filter(p=>p.status==='GAP').length;
 overview=overview.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods and \d+ business-ID page entries/,'**RELEASE BLOCKER:** '+m.metrics.gap+' API methods and '+pageGaps+' business-ID page entries').replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps and \d+ page\/action gaps/,'**NOT ACCEPTED**: '+m.metrics.gap+' method gaps and '+pageGaps+' page/action gaps');
 for(const key of ['coveredAfter','gap'])overview=overview.replace(new RegExp('^\\| '+key+' \\| \\d+ \\|$','m'),'| '+key+' | '+m.metrics[key]+' |');
 const lines=overview.split('\n'),i=lines.findIndex(x=>x.startsWith('| [`approvals/[id]` PATCH]('));assert.ok(i>=0);
 const cells=lines[i].split(' | ');cells[cells.length-2]='[approvals PATCH complete-method PG16 receipt](../../scripts/qa/tenant-approvals-recovery-receipt.json) — generic + leave/chain + typed sources + payroll + delegation';cells[cells.length-1]='**COVERED** |';lines[i]=cells.join(' | ');overview=lines.join('\n');
 overview=withApprovalsStatusBanner(overview,m.metrics,pageGaps);
 let plan=withApprovalsStatusBanner(readFileSync(PLAN,'utf8'),m.metrics,pageGaps);
 // Derive the live frozen-batch table from its immutable method/source links.
 const frozen=plan.split('### Batch DL-01 —')[1]?.split('## Page and server-action closure')[0];assert.ok(frozen);
 const total={COVERED:0,'PUBLIC-BY-DESIGN':0,'PRIVILEGED-OPERATIONS-TOKEN-ONLY':0,GAP:0},provisional=[];
 for(const section of ('### Batch DL-01 —'+frozen).split('### Batch ').slice(1)){
  const id=section.split(' ')[0],counts={COVERED:0,'PUBLIC-BY-DESIGN':0,'PRIVILEGED-OPERATIONS-TOKEN-ONLY':0,GAP:0};
  for(const line of section.split('\n').filter(x=>x.startsWith('- `')&&x.includes(' — [source](../../src/app/api/'))){const [verb]=line.split('`')[1].split(' '),path=line.split(' — [source](../../')[1].split('#L')[0],status=m.allApiRouteFiles[path].methods.find(x=>x.name===verb).status;counts[status]++;total[status]++;}
  if(counts.GAP===0)provisional.push(id);
  plan=plan.split('\n').map(line=>{const cells=line.split('|');if(cells.length!==10||cells[2].trim()!=='**'+id+'**')return line;cells[4]=' '+counts.COVERED+' ';cells[5]=' '+counts['PUBLIC-BY-DESIGN']+' ';cells[6]=' '+counts['PRIVILEGED-OPERATIONS-TOKEN-ONLY']+' ';cells[7]=' '+counts.GAP+' ';cells[8]=counts.GAP?' INCOMPLETE ':' PROVISIONAL — NOT ACCEPTED ';return cells.join('|');}).join('\n');
 }
 plan=plan.replace(/^Frozen subtotal[^\n]+/m,line=>line.replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/,'**'+total.COVERED+' COVERED + '+total['PUBLIC-BY-DESIGN']+' PUBLIC-BY-DESIGN + '+total['PRIVILEGED-OPERATIONS-TOKEN-ONLY']+' PRIVILEGED-OPERATIONS-TOKEN-ONLY + '+total.GAP+' GAP = 406**'));
 plan=plan.replace(/^Frozen subtotal[^\n]+/m,line=>line.replace(/\d+ batches remain INCOMPLETE; [^.]+ remain PROVISIONAL — NOT ACCEPTED\./,(12-provisional.length)+' batches remain INCOMPLETE; '+provisional.join(', ')+' remain PROVISIONAL — NOT ACCEPTED.'));
 if(write){writeFileSync(MANIFEST,JSON.stringify(m,null,2)+'\n');writeFileSync(INVENTORY,overview);writeFileSync(PLAN,plan);}
 else {assert.equal(row.status,'COVERED');assert.deepEqual(JSON.parse(readFileSync(MANIFEST,'utf8')),m,'Run this reviewed credit writer with --write first');assert.equal(readFileSync(INVENTORY,'utf8'),overview,'Inventory must be generated from the same credit');assert.equal(readFileSync(PLAN,'utf8'),plan,'Frozen queue must reconcile with the credited method');}
 return {methodsCredited:before.gap-m.metrics.gap,before,after:{covered:m.metrics.coveredAfter,gap:m.metrics.gap},write};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);assert.ok(args.length===1&&['--write','--check'].includes(args[0]));
 execFileSync('git',['merge-base','--is-ancestor','6f1a193f8b56eb52174c33e7caf4335d8a8c95e7','HEAD']);
 console.log(JSON.stringify(reconcileApprovalsCredit({write:args[0]==='--write'})));
}
