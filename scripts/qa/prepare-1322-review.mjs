// One-time reviewer preparation. Never included in the final PR tree.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const HEAD = '562cf77333de667dfb99f6a0a0fb340fc776a1ec';
const repo = 'erwinmehehe/payrollph';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const read = path => readFileSync(path, 'utf8');
const write = (path, text) => writeFileSync(path, text);
const mf = 'scripts/qa/tenant-isolation-coverage-manifest.json';
const doc = 'docs/engineering/tenant-isolation-coverage-inventory.md';
const shared = 'scripts/qa/tenant-manifest-driven-http.mjs';
const retired = '.github/workflows/qa-dl01-regression-diagnostics.yml';
const newTest = 'tests/tenant-dl01-reviewed-proof-links.test.mjs';
const countTests = ['tests/remittance-month-close-read.test.ts', 'tests/tenant-isolation-coverage-inventory.test.mjs', 'tests/tenant-manifest-driven-http.test.mjs'];
const allowed = [mf, doc, shared, retired, newTest, ...countTests].sort();
assert.equal(process.env.GITHUB_REPOSITORY, repo);
assert.equal(process.env.CI, 'true');
assert.equal(git('rev-parse', 'HEAD'), HEAD, 'Pinned review source changed');

const specs = [
  { route: 'employees/import', file: 'scripts/qa/tenant-dl01-import-history-http.mjs', declaration: 'export const IMPORT_HISTORY_METHOD = "GET employees/import";', forged: 'const ignored = expectStatus(await request(', exists: 'assert.equal(persistedVictim?.organizationId, victimOrg.id)', order: 'assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id)', reason: 'Two independent authenticated employers read their real nonempty own import history (200), are denied the real higher-ID victim-only batch under the victim employer (403), cannot select victim employee/run/batch rows through forged query parameters, and leave victim import, employee, payroll and audit rows unchanged in disposable PostgreSQL.' },
  { route: 'compliance/filing-validations/[id]/file', file: 'scripts/qa/tenant-dl01-filing-file-http.mjs', declaration: 'export const FILING_FILE_METHOD = "GET compliance/filing-validations/[id]/file";', forged: 'const forged = expectStatus(await request(', exists: 'assert.equal(persistedVictim?.organizationId, victimOrg.id)', order: 'assert.ok(victim.record.id > 6 && victim.record.id > fixtures[7].record.id && victim.record.id > fixtures[8].record.id)', reason: 'Two independent authenticated employers download exact own stored BIR worksheet bytes (200; SHA-256, content type, filename and no-store policy checked), are denied the existing higher-ID victim filing (403), receive 404 for that same real victim ID under their own employer, ignore forged victim run/employee selectors, and leave actual victim filing, payroll, employee and audit rows unchanged.' },
  { route: 'compliance/statutory-remittances/posting-evidence/[id]', file: shared, declaration: '"GET compliance/statutory-remittances/posting-evidence/[id]": {', forged: 'const forged = expectStatus(await request(', exists: 'assert.equal(persistedVictimPosting?.organizationId, victimOrg.id,', order: 'assert.ok(victimPosting.id > ownedPosting.id,', reason: 'Two independent authenticated employers download actual own posting-source CSV bytes (200; digest, type and attachment checked), are denied the real higher-ID victim-only posting artifact (403), ignore forged victim organization/batch selectors on own files and still deny the victim ID under a forged own organization (403), with all real victim PostgreSQL evidence and related rows unchanged.' },
];
const lineOf = (source, fragment) => {
  const hits = source.split('\n').flatMap((line, i) => line.includes(fragment) ? [i + 1] : []);
  assert.equal(hits.length, 1, 'Ambiguous or missing executed proof: ' + fragment);
  return hits[0];
};
const change = (text, old, replacement) => {
  assert.equal(text.split(old).length - 1, 1, 'Non-unique or missing old content: ' + old);
  return text.replace(old, replacement);
};

if (process.argv[2] === 'prepare') {
  assert.equal(git('status', '--porcelain'), '', 'Review checkout must start clean');
  const expectedBlobs = {
    [mf]: '81bc92e2d9e037d9e68b9e1614962bfe396d0674',
    [shared]: '5c7a4987e222b908d77bdeac0c6a2cca50a83191',
    [specs[0].file]: '938cd1f60f7b3d82a0050afcb44554f20e5d4882',
    [specs[1].file]: 'a001643e33c3d62ae2caf8b2417ad265486013e0',
  };
  for (const [path, sha] of Object.entries(expectedBlobs)) assert.equal(git('hash-object', path), sha, path);
  const original = JSON.parse(read(mf));
  const manifest = structuredClone(original);
  assert.deepEqual([manifest.metrics.methods, manifest.metrics.coveredAfter, manifest.metrics.publicByDesign, manifest.metrics.gap], [493,93,10,390]);
  for (const spec of specs) {
    const method = manifest.allApiRouteFiles['src/app/api/' + spec.route + '/route.ts'].methods.find(m => m.name === 'GET');
    assert.equal(method.status, 'GAP', spec.route);
    assert.equal(method.testedBy, null, spec.route);
    const source = read(spec.file);
    method.status = 'COVERED';
    method.reason = spec.reason;
    method.testedBy = {
      file: spec.file,
      line: lineOf(source, spec.declaration),
      ownPositiveLine: lineOf(source, 'const own = expectStatus(await request('),
      foreignDenialLine: lineOf(source, 'const foreign = expectStatus(await request('),
      unchangedDbLine: lineOf(source, 'assert.deepEqual(after, before,'),
      forgedSelectorLine: lineOf(source, spec.forged),
      victimExistsLine: lineOf(source, spec.exists),
      victimIdOrderingLine: lineOf(source, spec.order),
      scope: 'Real HTTP against disposable PostgreSQL16 with two independent attacker employers; actual own positive first, persisted victim-exclusive higher ID and exact denial, forged selectors, and real unchanged victim DB snapshot. Reviewed source was exercised by security run 39592582663 and salary-correction run 39592582809 on merge candidate 47cf659f53b99275d1438d9944bdd29167e1b7bf. Fresh final-commit CI remains required; this is not overall acceptance.',
    };
    console.log('REVIEWED_METHOD ' + JSON.stringify({method: 'GET ' + spec.route, proof: method.testedBy}));
  }
  manifest.metrics.coveredAfter = 96;
  manifest.metrics.gap = 387;
  manifest.acceptanceStatus = change(manifest.acceptanceStatus, 'NOT ACCEPTED: 390 API methods', 'NOT ACCEPTED: 387 API methods') + ' PR1322 closeout links executed four-part proof for import history, filing-file download and posting-evidence download; it neither waives remaining GAPs nor accepts tenant isolation.';
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(r => r.methods);
  assert.deepEqual(['COVERED','PUBLIC-BY-DESIGN','GAP'].map(s => methods.filter(m => m.status === s).length), [96,10,387]);
  const changedKeys = new Set(specs.map(s => 'GET ' + s.route));
  for (const [path, route] of Object.entries(manifest.allApiRouteFiles)) {
    assert.equal(route.gitBlobSha, original.allApiRouteFiles[path].gitBlobSha);
    for (const method of route.methods) if (!changedKeys.has(method.name + ' ' + route.route))
      assert.deepEqual(method, original.allApiRouteFiles[path].methods.find(m => m.name === method.name));
  }
  assert.deepEqual(manifest.scopedPages, original.scopedPages);
  write(mf, JSON.stringify(manifest, null, 2) + '\n');
  for (const path of countTests) {
    let text = read(path);
    for (const [field, before, after, reason] of [['coveredAfter',93,96,'Retain 93 earlier proofs plus three reviewed real HTTP file/history methods'],['gap',390,387,'387 unverified methods remain GAP; three executed DL-01 proofs now linked']]) {
      const rx = new RegExp('assert\\.equal\\(manifest\\.metrics\\.' + field + ', ' + before + ', "[^"\\n]*"\\);', 'g');
      assert.equal([...text.matchAll(rx)].length, 1, path + ' exact count ' + field);
      text = text.replace(rx, 'assert.equal(manifest.metrics.' + field + ', ' + after + ', "' + reason + '");');
    }
    if (path === countTests[2]) text = change(text,
      'assert.equal(specs.filter((spec) => registry.get(spec).status === "GAP").length, 3);',
      'assert.equal(specs.filter((spec) => registry.get(spec).status === "GAP").length, 2);');
    write(path, text);
  }
  let source = read(shared);
  const oldLine = source.split('\n').find(l => l.includes('assert.equal(gaps.length, 390,'));
  assert.ok(oldLine);
  source = change(source, oldLine, '  assert.equal(gaps.length, 387, "Three reviewed real file/history HTTP proofs are linked; remaining unverified methods stay GAP");');
  assert.equal(source.split('\n').length, read(shared).split('\n').length, 'Existing evidence lines may not shift');
  write(shared, source);

  let overview = read(doc);
  for (const [a,b] of [
    ['**RELEASE BLOCKER:** 390 API methods','**RELEASE BLOCKER:** 387 API methods'],
    ['**NOT ACCEPTED**: 390 method gaps','**NOT ACCEPTED**: 387 method gaps'],
    ['93 COVERED / 10 PUBLIC-BY-DESIGN / 390 GAP','96 COVERED / 10 PUBLIC-BY-DESIGN / 387 GAP'],
    ['| coveredAfter | 93 |','| coveredAfter | 96 |'],
    ['| gap | 390 |','| gap | 387 |'],
    ['The import-history and filing-file probes remain GAP pending executed evidence.', 'Import-history, filing-file and posting-evidence GET now have explicit links to their executed four-part proofs. The reviewed source passed disposable PostgreSQL/HTTP CI; the final closeout commit must also pass normal CI.'],
  ]) overview = change(overview,a,b);
  const tableRoutes = [...specs.map(s => s.route), 'compliance/statutory-remittances/payment-evidence/[id]', 'compliance/statutory-remittances/payment-evidence'];
  for (const route of tableRoutes) {
    const method = manifest.allApiRouteFiles['src/app/api/' + route + '/route.ts'].methods.find(m => m.name === 'GET');
    const prefix = '| [`' + route + '` GET]';
    const rows = overview.split('\n').filter(l => l.startsWith(prefix));
    assert.equal(rows.length, 1, 'Missing review row ' + route);
    const cells = rows[0].split(' | ');
    assert.ok(cells.length >= 6, route);
    cells[cells.length - 2] = '[Executed own/victim/forged-selector/unchanged-DB proof](../../' + method.testedBy.file + '#L' + method.testedBy.ownPositiveLine + ')';
    cells[cells.length - 1] = '**COVERED** |';
    overview = change(overview, rows[0], cells.join(' | '));
  }
  overview += '\n## PR1322 partial closeout review\n\nThree previously uncredited GET methods are now source-linked: employee import history, government filing-file download, and statutory posting-evidence download. Both attacker employers succeed on real own objects, target later existing victim-only IDs with exact denials, exercise forged tenant/object selectors, and verify unchanged victim PostgreSQL rows. Source links are guarded by `tests/tenant-dl01-reviewed-proof-links.test.mjs`; runtime proof remains the real three-employer CI harness, not these bookkeeping tests.\n\nDL-01 remains partial: its frozen 26-method queue has 7 COVERED, 2 PUBLIC-BY-DESIGN, and 17 GAP methods. The repository has 387 API GAPs and 20 page/action GAPs. No new confirmed leak, payroll logic, production flag, provider call or money movement is claimed. This reviewer closeout does not replace independent owner acceptance; the manifest remains NOT ACCEPTED.\n';
  write(doc, overview);
  assert.ok(existsSync(retired));
  unlinkSync(retired);
  write(newTest, read(process.env.REVIEW_GUARD_SOURCE));
  git('add', '-A', '--', ...allowed);
  const touched = git('diff','--cached','--name-only').split('\n').sort();
  assert.deepEqual(touched, allowed, 'Exact closeout file allowlist');
  console.log(git('diff', '--cached', '--stat'));
  console.log('REVIEW_PREPARED ' + JSON.stringify({source:HEAD, coveredBefore:93, coveredAfter:96, public:10, gapsBefore:390, gapsAfter:387, pageGaps:20}));
} else if (process.argv[2] === 'publish-tree') {
  assert.ok(process.env.GH_TOKEN, 'Git-object write token required only for this step');
  assert.equal(git('diff','--name-only'), '', 'Unstaged changes refused');
  assert.deepEqual(git('diff','--cached','--name-only').split('\n').sort(), allowed);
  assert.equal(existsSync(retired), false);
  const api = async (path, body) => {
    const response = await fetch('https://api.github.com/repos/' + repo + path, {
      method:'POST', headers:{Authorization:'Bearer '+process.env.GH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify(body),
    });
    if(!response.ok) throw Error('Git object request failed: ' + response.status + ' ' + await response.text());
    return response.json();
  };
  const tree = [];
  for (const path of allowed) {
    if(!existsSync(path)) { tree.push({path,mode:'100644',type:'blob',sha:null}); continue; }
    const content = read(path);
    const blob = await api('/git/blobs', {content,encoding:'utf-8'});
    assert.equal(blob.sha, git('hash-object', path));
    tree.push({path,mode:'100644',type:'blob',sha:blob.sha});
  }
  const base = git('rev-parse','HEAD^{tree}');
  const result = await api('/git/trees', {base_tree:base,tree});
  assert.match(result.sha,/^[0-9a-f]{40}$/);
  assert.equal(result.sha,git('write-tree'), 'Remote tree must exactly match tested local index');
  console.log('REVIEWED_TREE ' + JSON.stringify({sha:result.sha,parent:HEAD,files:allowed}));
  // Deliberately do not update any branch or create a PR/merge here.
} else throw Error('Expected prepare or publish-tree');
