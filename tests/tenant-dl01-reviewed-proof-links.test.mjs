/** Bookkeeping regression only; the real three-employer HTTP/PG16 suites provide coverage. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json', 'utf8'));
const overview = readFileSync('docs/engineering/tenant-isolation-coverage-inventory.md', 'utf8');
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
  const method = record?.methods.find(m => m.name === 'GET');
  const source = readFileSync(spec.file, 'utf8');
  test('reviewed GET requires every exact executed proof link: ' + spec.route, () => {
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

test('DL-01, DL-02 and HCM method proofs remain intact with one guarded scoped page', () => {
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(r => r.methods);
  assert.equal(methods.length, 493);
  assert.deepEqual(['COVERED','PUBLIC-BY-DESIGN','GAP'].map(s => methods.filter(m => m.status === s).length), [140,10,343]);
  assert.deepEqual([manifest.metrics.coveredAfter,manifest.metrics.publicByDesign,manifest.metrics.gap], [140,10,343]);
  assert.match(manifest.acceptanceStatus, /^NOT ACCEPTED: 343 API methods and 19 page\/action GAPs remain\./);
  assert.equal(manifest.scopedPages.length, 20);
  const coveredPage = manifest.scopedPages.find(p =>
    p.path === 'src/app/hcm/manager-decision-inbox/page.tsx');
  assert.equal(coveredPage.status, 'COVERED');
  assert.equal(coveredPage.testedBy?.file, 'scripts/qa/hcm-manager-inbox-page-http.mjs');
  assert.equal(manifest.scopedPages.filter(p => p.status === 'GAP').length, 19);
  const probation = manifest.allApiRouteFiles['src/app/api/hcm/probation-reviews/route.ts'].methods;
  assert.deepEqual(probation.map(method => method.name), ['GET','POST','PATCH']);
  assert.ok(probation.every(method =>
    method.status === 'COVERED' &&
    method.testedBy?.file === 'scripts/qa/hcm-probation-sweep-http.mjs'));
  const importPost = manifest.allApiRouteFiles['src/app/api/employees/import/route.ts'].methods.find(m => m.name === 'POST');
  assert.equal(importPost.status, 'GAP', 'GET proof cannot cover the import write');
  assert.equal(importPost.testedBy, null);
  assert.ok(overview.includes('| coveredAfter | 140 |'));
  assert.ok(overview.includes('| gap | 343 |'));
});
