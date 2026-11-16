import { verifyCurrentScopedPageGapCount } from "../scripts/qa/tenant-five-scoped-page-credit.mjs";
/** Bookkeeping regression only; the real three-employer HTTP/PG16 suites provide coverage. */
import assert from 'node:assert/strict'; import { verifyWorker360PageCredit } from '../scripts/qa/tenant-five-method-credit-verify.mjs';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertLiveTenantCounts } from "./helpers/tenant-counts.mjs";
import { verifyCredit as verifyOnboardingCredit } from '../scripts/qa/tenant-onboarding-credit.mjs';
import { historicWageRegistryProofView, verifyWageRegistrySourceHold } from '../scripts/qa/wage-registry-source-hold.mjs';
import { verifyAllTransitiveWageHolds, TRANSITIVE_HOLD_KIND } from '../scripts/qa/wage-registry-transitive-source-hold.mjs';

const manifest = JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json', 'utf8'));
const overview = readFileSync('docs/engineering/tenant-isolation-coverage-inventory.md', 'utf8');
const archival = historicWageRegistryProofView(manifest);
assert.equal(verifyAllTransitiveWageHolds(manifest).size,47);
const specs = [
  { route: 'employees/import', file: 'scripts/qa/tenant-dl01-import-history-http.mjs', declaration: 'export const IMPORT_HISTORY_METHOD = "GET employees/import";', forged: 'const ignored = expectStatus(await request(', exists: 'assert.equal(persistedVictim?.organizationId, victimOrg.id)', order: 'assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id)' },
  { route: 'compliance/filing-validations/[id]/file', file: 'scripts/qa/tenant-dl01-filing-file-http.mjs', declaration: 'export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";', forged: 'const forged = expectStatus(await request(', exists: 'assert.equal(persistedVictim?.organizationId, victimOrg.id)', order: 'assert.ok(victim.record.id > 6 && victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id)' },
  { route: 'compliance/statutory-remittances/posting-evidence/[id]', file: 'scripts/qa/tenant-manifest-driven-http.mjs', declaration: '"GET compliance/statutory-remittances/posting-evidence/[id]": {', forged: 'const forged = expectStatus(await request(', exists: 'assert.equal(persistedVictimPosting?.organizationId, victimOrg.id,', order: 'assert.ok(victimPosting.id > ownedPosting.id,' },
];

function assertLinks(method, spec, source) {
  assert.equal(method?.name, 'GET');
  assert.equal(method.status, 'COVERED', spec.route + ': reviewed proof cannot silently disappear');
  const proof = method.testedBy;
  assert.equal(proof?.file, spec.file, spec.route + ': wrong proof module');
  const lines = source.split('\n');
  const fragments = {
    line: spec.declaration,
    ownPositiveLine: 'const own = expectStatus(await request(',
    foreignDenialLine: 'const foreign = expectStatus(await request(',
    forgedSelectorLine: spec.forged,
    unchangedDbLine: 'assert.deepEqual(after, before,',
    victimExistsLine: spec.exists,
    victimIdOrderingLine: spec.order,
  };
  for (const [field, fragment] of Object.entries(fragments)) {
    const line = proof[field];
    assert.ok(Number.isInteger(line) && line > 0 && line <= lines.length, spec.route + ': ' + field);
    assert.ok(lines[line - 1].trimStart().startsWith(fragment), spec.route + ': non-executable/wrong ' + field);
  }
  assert.ok(proof.ownPositiveLine < proof.foreignDenialLine);
  assert.ok(proof.foreignDenialLine < proof.forgedSelectorLine);
  assert.ok(proof.forgedSelectorLine < proof.unchangedDbLine);
  assert.ok(source.includes('for (const idx of [1, 2])'));
  assert.ok(source.includes('f.ownerSessions[idx].cookie'));
  const ownSpan = lines.slice(proof.ownPositiveLine - 1, proof.ownPositiveLine + 2).join('\n');
  assert.match(ownSpan, /\), 200,/);
  if (spec.file.endsWith('tenant-manifest-driven-http.mjs')) {
    const adapter = lines.slice(proof.line - 1, proof.line + 4).join('\n');
    assert.match(adapter, /denial: 403/);
    assert.ok(source.includes('assert.equal(observations.length, FIRST_ADAPTED_METHODS.length * 2)'));
  } else {
    const denial = lines.slice(proof.foreignDenialLine - 1, proof.foreignDenialLine + 3).join('\n');
    assert.match(denial, /\), 403,/);
    assert.ok(source.includes('assert.equal(receipts.length, 2)'));
  }
}

for (const spec of specs) {
  const record = manifest.allApiRouteFiles['src/app/api/' + spec.route + '/route.ts'];
  const current = record?.methods.find(m => m.name === 'GET');
  const method = archival.allApiRouteFiles['src/app/api/' + spec.route + '/route.ts']
    ?.methods.find(m => m.name === 'GET');
  const source = readFileSync(spec.file, 'utf8');
  test('reviewed GET requires every exact executed proof link: ' + spec.route, () => {
    if (current.status === 'GAP') {
      assert.equal(current.testedBy,null);
      assert.equal(current.reviewedUncertified?.kind,TRANSITIVE_HOLD_KIND,
        'Historical proof cannot conceal a wage-source dependency gap');
      assert.equal(current.reviewedUncertified.coverageCredits,0);
      assert.deepEqual(current.reviewedUncertified.priorProof,method.testedBy);
    } else {
      assert.equal(current.status,'COVERED');
      assert.deepEqual(current.testedBy,method.testedBy);
    }
    assertLinks(method, spec, source);
    assert.ok(overview.includes('(../../' + spec.file + '#L' + method.testedBy.ownPositiveLine + ')'));
  });
  for (const field of ['line', 'ownPositiveLine', 'foreignDenialLine', 'forgedSelectorLine', 'unchangedDbLine', 'victimExistsLine', 'victimIdOrderingLine']) {
    test(spec.route + ' rejects a missing ' + field, () => {
      const broken = structuredClone(method);
      delete broken.testedBy[field];
      assert.throws(() => assertLinks(broken, spec, source));
    });
  }
  test(spec.route + ' rejects proof links to blank/comments or a different method module', () => {
    const lines = source.split('\n');
    lines[method.testedBy.ownPositiveLine - 1] = '// ' + lines[method.testedBy.ownPositiveLine - 1];
    assert.throws(() => assertLinks(method, spec, lines.join('\n')));
    const broken = structuredClone(method);
    broken.testedBy.file = 'scripts/qa/unrelated.mjs';
    assert.throws(() => assertLinks(broken, spec, source));
    broken.testedBy.file = spec.file;
    broken.status = 'PUBLIC-BY-DESIGN';
    assert.throws(() => assertLinks(broken, spec, source));
  });
}

test('DL-01, DL-02 and HCM method proofs remain intact with two guarded scoped pages', () => {
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(r => r.methods);
  assert.equal(methods.length, manifest.metrics.methods);
  assert.ok(methods.length > 0);
  assertLiveTenantCounts(assert, manifest);
  const readinessPath='src/app/api/payroll-runs/[id]/pre-run-readiness/route.ts';
  const processPath='src/app/api/payroll-runs/[id]/process/route.ts';
  const readiness = manifest.allApiRouteFiles[readinessPath]
    ?.methods.find(m => m.name === 'GET');
  const changedProcess = manifest.allApiRouteFiles[processPath]
    ?.methods.find(m => m.name === 'POST');
  if (verifyWageRegistrySourceHold(manifest,readinessPath,'GET')) {
    assert.ok(verifyWageRegistrySourceHold(manifest,processPath,'POST'));
    assert.equal(readiness.status,'GAP');
    assert.equal(changedProcess.status,'GAP');
    assert.equal(readiness.testedBy,null);
    assert.equal(changedProcess.testedBy,null);
    assert.equal(archival.allApiRouteFiles[readinessPath].methods.find(x=>x.name==='GET').status,'COVERED');
    assert.equal(archival.allApiRouteFiles[processPath].methods.find(x=>x.name==='POST').status,'COVERED');
  } else if(!isVerifiedOracleSupersession(manifest,readinessPath,'GET')) {
  assert.equal(readiness?.testedBy?.file, 'scripts/qa/tenant-second-pass-http.mjs');
  assert.equal(changedProcess?.testedBy?.file, 'scripts/qa/tenant-second-pass-http.mjs');
  assert.match(changedProcess?.reason ?? '', /422.*403/,
    'Pre-run fail-closed proof must not be presented as successful money computation');
  } else assert.ok(isVerifiedOracleSupersession(manifest,'src/app/api/payroll-runs/[id]/process/route.ts','POST'));
  assert.equal(manifest.scopedPages.length, manifest.metrics.scopedPagesAndActions);
  const coveredPage = manifest.scopedPages.find(p =>
    p.path === 'src/app/hcm/manager-decision-inbox/page.tsx');
  assert.equal(coveredPage.status, 'COVERED');
  assert.equal(coveredPage.testedBy?.file, 'scripts/qa/hcm-manager-inbox-page-http.mjs');
  assert.equal(manifest.scopedPages.filter(p => p.status === 'GAP').length, verifyCurrentScopedPageGapCount(manifest));
  const probation = manifest.allApiRouteFiles['src/app/api/hcm/probation-reviews/route.ts'].methods;
  assert.deepEqual(probation.map(method => method.name), ['GET','POST','PATCH']);
  assert.ok(probation.every(method =>
    method.status === 'COVERED' &&
    method.testedBy?.file === 'scripts/qa/hcm-probation-sweep-http.mjs'));
  const actionsPath='src/app/api/compliance/remittance-actions/route.ts';
  const actionMethods=manifest.allApiRouteFiles[actionsPath].methods;
  const archivedActions=archival.allApiRouteFiles[actionsPath].methods;
  assert.deepEqual(actionMethods.map(m=>m.name),['GET','POST']);
  for (const current of actionMethods) {
    assert.equal(current.status,'GAP',"New wage source withdraws remittance-action credit");
    assert.equal(current.testedBy,null);
    assert.equal(current.reviewedUncertified?.kind,TRANSITIVE_HOLD_KIND);
    const prior=archivedActions.find(x=>x.name===current.name);
    assert.equal(prior?.status,'COVERED');
    assert.equal(prior.testedBy?.file,'scripts/qa/remittance-action-entity-http.mjs');
    assert.deepEqual(prior.testedBy,current.reviewedUncertified.priorProof);
  }
  const importPath='src/app/api/employees/import/route.ts';
  const importPost=manifest.allApiRouteFiles[importPath].methods.find(m=>m.name==='POST');
  assert.equal(importPost.status,'GAP',"Old onboarding receipt cannot recredit changed wage source");
  assert.equal(importPost.testedBy,null);
  assert.equal(importPost.reviewedUncertified?.kind,TRANSITIVE_HOLD_KIND);
  const archivedImport=archival.allApiRouteFiles[importPath].methods.find(m=>m.name==='POST');
  assert.equal(archivedImport.status,'COVERED');
  assert.notEqual(archivedImport.testedBy?.file,specs[0].file,'GET proof cannot cover the import write');
  assert.equal(verifyOnboardingCredit('POST employees/import',archivedImport),true);
  const closePost = manifest.allApiRouteFiles["src/app/api/payroll-runs/[id]/close/route.ts"]
    ?.methods.find(method => method.name === "POST");
  if(verifyWageRegistrySourceHold(manifest,"src/app/api/payroll-runs/[id]/close/route.ts","POST")) {
    assert.equal(closePost.status,"GAP","Prior close POST remains source-held");
    assert.equal(closePost.testedBy,null);
    assert.equal(archival.allApiRouteFiles["src/app/api/payroll-runs/[id]/close/route.ts"]
      .methods.find(x=>x.name==="POST").status,"COVERED");
  } else if(!isVerifiedOracleSupersession(manifest,"src/app/api/payroll-runs/[id]/close/route.ts","POST")) {
  assert.equal(closePost?.status, "COVERED",
    "Only separately source-pinned successful close POST can add a provisional credit");
  assert.equal(closePost.testedBy?.file, "scripts/qa/tenant-high-risk-01-http.mjs");
  const closeSource = readFileSync(closePost.testedBy.file, "utf8");
  const closeLines = closeSource.split("\n");
  assert.match(closeLines[closePost.testedBy.ownPositiveLine - 1] ?? "",
    /const ownPost = expectStatus\(await request\(closeUrl, \{/);
  assert.match(closeLines.slice(closePost.testedBy.ownPositiveLine - 1,
    closePost.testedBy.ownPositiveLine + 3).join("\n"),
    /cookie, method: "POST"[\s\S]*\}\), 200,/);
  assert.match(closeLines[closePost.testedBy.foreignDenialLine - 1] ?? "",
    /const foreignPost = expectStatus\(await request\("\/api\/payroll-runs\/" \+ f\.victimRun\.id \+ "\/close"/);
  assert.match(closeLines.slice(closePost.testedBy.foreignDenialLine - 1,
    closePost.testedBy.foreignDenialLine + 7).join("\n"),
    /cookie, method: "POST"[\s\S]*\}\), 403,/);
  assert.match(closeLines[closePost.testedBy.unchangedDbLine - 1] ?? "",
    /assert\.deepEqual\(victimAfter, victimBefore/);
  assert.match(closeSource,
    /await verifyPayrollClosePostIsolation\(f, \{ request, expectStatus, makeSession \}\);/);
  assert.ok(overview.includes('(../../scripts/qa/tenant-high-risk-01-http.mjs#L444)'),
    'The independently credited close POST must have its exact own-200 proof link in the inventory');
  }
  assert.ok(overview.includes('| coveredAfter | ' + manifest.metrics.coveredAfter + ' |'));
  assert.ok(overview.includes('| gap | ' + manifest.metrics.gap + ' |'));
});
import { isVerifiedOracleSupersession } from "../scripts/qa/payroll-run-oracle-hold.mjs";
