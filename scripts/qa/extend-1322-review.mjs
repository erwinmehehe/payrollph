import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, {encoding:'utf8'}).trim();
const read = path => readFileSync(path, 'utf8');
const HEAD = '562cf77333de667dfb99f6a0a0fb340fc776a1ec';
const repo = 'erwinmehehe/payrollph';
const inv = 'tests/tenant-isolation-coverage-inventory.test.mjs';
const hi = 'tests/tenant-high-risk-batch-01.test.mjs';
const retired = '.github/workflows/qa-dl01-regression-diagnostics.yml';
const allowed = [retired,'docs/engineering/tenant-isolation-coverage-inventory.md',
 'scripts/qa/tenant-isolation-coverage-manifest.json','scripts/qa/tenant-manifest-driven-http.mjs',
 'tests/remittance-month-close-read.test.ts',inv,hi,'tests/tenant-manifest-driven-http.test.mjs',
 'tests/tenant-dl01-reviewed-proof-links.test.mjs'].sort();
assert.equal(process.env.GITHUB_REPOSITORY,repo);
assert.equal(process.env.CI,'true');
assert.equal(git('rev-parse','HEAD'),HEAD);
function change(text, old, next) {
 assert.equal(text.split(old).length-1,1,'Missing/ambiguous guard: '+old);
 return text.replace(old,next);
}
if(process.argv[2]==='prepare') {
 let src = read(inv);
 src = change(src,
  '"scripts/qa/tenant-manifest-driven-http.mjs", "scripts/qa/tenant-high-risk-01-http.mjs"].includes',
  '"scripts/qa/tenant-manifest-driven-http.mjs", "scripts/qa/tenant-high-risk-01-http.mjs",\n        "scripts/qa/tenant-dl01-import-history-http.mjs", "scripts/qa/tenant-dl01-filing-file-http.mjs"].includes');
 const marker = '      if (proof.file === "scripts/qa/tenant-manifest-driven-http.mjs") {';
 const block = `      if (["scripts/qa/tenant-dl01-import-history-http.mjs", "scripts/qa/tenant-dl01-filing-file-http.mjs"].includes(proof.file)) {
        const history = proof.file.endsWith("tenant-dl01-import-history-http.mjs");
        const route = history ? "employees/import" : "compliance/filing-validations/[id]/file";
        const key = "GET " + route;
        assert.equal(path, "src/app/api/" + route + "/route.ts", "No unrelated method may borrow DL-01 proof");
        assert.equal(method.name, "GET", "Read proof cannot certify a mutation");
        const declaration = history ? 'export const IMPORT_HISTORY_METHOD = "GET employees/import";' : 'export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";';
        const suite = readFileSync(proof.file, "utf8");
        const lines = suite.split("\\n");
        const pins = {
          line: declaration,
          ownPositiveLine: "const own = expectStatus(await request(",
          foreignDenialLine: "const foreign = expectStatus(await request(",
          forgedSelectorLine: history ? "const ignored = expectStatus(await request(" : "const forged = expectStatus(await request(",
          unchangedDbLine: "assert.deepEqual(after, before,",
          victimExistsLine: "assert.equal(persistedVictim?.organizationId, victimOrg.id)",
          victimIdOrderingLine: history ? "assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id)" : "assert.ok(victim.record.id > 6 && victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id)",
        };
        for (const [field, fragment] of Object.entries(pins)) {
          assert.ok(evidenceLine(proof.file, proof[field], key + " " + field).trimStart().startsWith(fragment), key + " incorrect " + field);
        }
        const span = field => lines.slice(proof[field] - 1, proof[field] + 3).join("\\n");
        assert.ok(span("ownPositiveLine").includes("), 200,"));
        assert.ok(span("foreignDenialLine").includes("), 403,"));
        assert.ok(proof.ownPositiveLine < proof.foreignDenialLine && proof.foreignDenialLine < proof.forgedSelectorLine);
        assert.ok(proof.forgedSelectorLine < proof.unchangedDbLine);
        assert.ok(suite.includes(history ? "assertOwnHistory(own, ownOrg.id, owned, victim)" : "assertOwnedFilingBytes(own, owned)"));
        assert.ok(suite.includes(history ? "assertOwnHistory(ignored, ownOrg.id, owned, victim)" : "assertOwnedFilingBytes(forged, owned)"));
        const snapshot = history ? "snapshotVictimImportHistory" : "snapshotVictimFilings";
        assert.ok(suite.includes("const before = await " + snapshot + "(victimOrg.id)"));
        assert.ok(suite.includes("const after = await " + snapshot + "(victimOrg.id)"));
        assert.ok(suite.includes('process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only"'));
        assert.ok(suite.includes('process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000"'));
        assert.ok(suite.includes("for (const idx of [1, 2])"));
        assert.ok(suite.includes("assert.equal(receipts.length, 2)"));
        const hook = readFileSync("scripts/qa/tenant-static-template-http.mjs", "utf8");
        const fn = history ? "verifyTenantImportHistory" : "verifyTenantFilingFile";
        assert.ok(hook.includes("await " + fn + "(f, { request, expectStatus });"));
        assert.ok(source.join("\\n").includes("verifyTenantIndependentImportTemplate(f, { request, expectStatus })"));
        continue;
      }
`;
 src = change(src,marker,block+marker);
 src = change(src,
  '          "GET compliance/statutory-remittances/payment-evidence",\n        ]).has(key)',
  '          "GET compliance/statutory-remittances/payment-evidence",\n          "GET compliance/statutory-remittances/posting-evidence/[id]",\n        ]).has(key)');
 src = change(src,
  '        const caseSource = suite.slice(start, next < 0 ? undefined : next);',
  '        const registryEnd = suite.indexOf("\\n});\\nexport const FIRST_ADAPTED_METHODS", start);\n        assert.ok(registryEnd > start, key + ": registry boundary missing");\n        const caseSource = suite.slice(start, next < 0 ? registryEnd : next);');
 src = change(src,
  '        assert.ok(forged.includes(key.endsWith("/[id]")\n          ? "const crossId = expectStatus(await request("\n          : "const filtered = expectStatus(await request("),',
  '        const forgedByKey = {\n          "GET compliance/statutory-remittances/payment-evidence/[id]": "const crossId = expectStatus(await request(",\n          "GET compliance/statutory-remittances/payment-evidence": "const filtered = expectStatus(await request(",\n          "GET compliance/statutory-remittances/posting-evidence/[id]": "const forged = expectStatus(await request(",\n        };\n        assert.ok(forged.trimStart().startsWith(forgedByKey[key]),');
 writeFileSync(inv,src);
 let high = read(hi);
 high = change(high,'assert.equal(manifest.metrics.coveredAfter, 93, "91 covered methods inherited from main plus two DL-01 payment-evidence GETs");','assert.equal(manifest.metrics.coveredAfter, 96, "Retain 93 earlier proofs plus three reviewed real HTTP file/history methods");');
 high = change(high,'assert.equal(manifest.metrics.gap, 390, "390 unverified methods remain GAP; no new DL-01 runtime credit");','assert.equal(manifest.metrics.gap, 387, "387 unverified methods remain GAP; three executed DL-01 proofs now linked");');
 writeFileSync(hi,high);
 git('add','-A','--',...allowed);
 assert.deepEqual(git('diff','--cached','--name-only').split('\n').sort(),allowed);
 console.log(git('diff','--cached','--stat'));
} else if(process.argv[2]==='publish-tree') {
 assert.ok(process.env.GH_TOKEN);
 assert.equal(git('diff','--name-only'),'');
 assert.deepEqual(git('diff','--cached','--name-only').split('\n').sort(),allowed);
 assert.equal(existsSync(retired),false);
 const api = async (path,body) => {
  const r = await fetch('https://api.github.com/repos/'+repo+path,{method:'POST',headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw Error('Git objects failed '+r.status+' '+await r.text());
  return r.json();
 };
 const tree = [];
 for(const path of allowed) {
  if(!existsSync(path)){tree.push({path,mode:'100644',type:'blob',sha:null});continue;}
  const blob=await api('/git/blobs',{content:read(path),encoding:'utf-8'});
  assert.equal(blob.sha,git('hash-object',path));
  tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
 }
 const result=await api('/git/trees',{base_tree:git('rev-parse','HEAD^{tree}'),tree});
 assert.equal(result.sha,git('write-tree'));
 console.log('REVIEWED_TREE '+JSON.stringify({sha:result.sha,parent:HEAD,files:allowed}));
} else throw Error('Expected prepare or publish-tree');
