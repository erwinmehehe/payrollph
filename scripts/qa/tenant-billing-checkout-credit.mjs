/** Source-sealed promotion of merged #1900, never an HTTP evidence generator. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { CHECKOUT_INPUT_BLOBS, CHECKOUT_RECEIPT_BLOB } from './tenant-billing-checkout-credit-pins.mjs';

export const CHECKOUT_PATH = 'src/app/api/billing/route.ts';
export const CHECKOUT_RECEIPT = 'scripts/qa/tenant-billing-checkout-credit-receipt.json';
const MANIFEST = 'scripts/qa/tenant-isolation-coverage-manifest.json';
const INVENTORY = 'docs/engineering/tenant-isolation-coverage-inventory.md';
const PLAN = 'docs/engineering/tenant-isolation-closure-plan.md';
const blob = value => { const b = Buffer.from(value); return createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex'); };

export function checkoutEvidence(read = readFileSync) {
  const raw = read(CHECKOUT_RECEIPT);
  assert.equal(blob(raw), CHECKOUT_RECEIPT_BLOB, 'Unreviewed checkout execution receipt');
  const r = JSON.parse(raw);
  assert.equal(r.label, 'SOLO_VERIFIED_DEV_RECOVERY');
  assert.equal(r.sourceHead, '09f172f8280d345ed57decbe8a05aaf3a4e066e7');
  assert.equal(r.workflowRunId, 42809117765);
  assert.equal(r.workflowJobId, 129805758274);
  assert.equal(r.execution, 'github-actions-production-http-pg16');
  assert.equal(r.result.postgresMajor, 16);
  assert.equal(r.result.ownCheckout201, 2);
  assert.equal(r.result.independentOwnPositiveEmployers, 2);
  assert.equal(r.result.foreign403, 2);
  for (const key of ['victimBusinessIdsOverSix', 'higherIdVictimPersisted',
    'unitScopedDenied', 'mfaDenied', 'forgedForeignSelectorsIgnored',
    'victimBusinessAndAuditUnchanged', 'noRealPaymongoOrMoneyMovement']) assert.equal(r.result[key], true);
  assert.equal(r.result.coverageCredits, 0, 'The executed proof itself never awarded credit');
  assert.equal(r.result.independentlyAccepted, false);
  assert.equal(r.productionCertified, false);
  for (const [file, sha] of Object.entries(CHECKOUT_INPUT_BLOBS)) {
    assert.equal(blob(read(file)), sha, 'Fresh HTTP/PG16 proof required after input drift: ' + file);
  }
  const proof = read('scripts/qa/tenant-billing-paymongo-http.mjs').toString().split('\n');
  for (const [line, fragment] of [[149, 'deny(foreign, 403'], [150, 'snapshot(victim.org.id)'],
    [183, 'const own = await request(actor'], [188, 'own.status, 201'],
    [208, 'snapshot(victim.org.id)'], [185, 'subscriptionId: subVictim.id']]) {
    assert.ok(proof[line - 1]?.includes(fragment), 'Lost exact checkout evidence anchor: ' + line);
  }
  return r;
}

export function expectedCheckoutReceipt(read = readFileSync) {
  const r = checkoutEvidence(read);
  return {
    file: 'scripts/qa/tenant-billing-paymongo-http.mjs', line: 188,
    ownPositiveLine: 188, foreignDenialLine: 149, forgedSelectorLine: 185, unchangedDbLine: 208,
    routeBlobSha: CHECKOUT_INPUT_BLOBS[CHECKOUT_PATH],
    proofBlobSha: CHECKOUT_INPUT_BLOBS['scripts/qa/tenant-billing-paymongo-http.mjs'],
    receiptFile: CHECKOUT_RECEIPT, receiptBlobSha: CHECKOUT_RECEIPT_BLOB,
    proofPullRequest: r.proofPullRequest, verifiedPrHeadSha: r.sourceHead,
    mergedProofCommit: r.mergedProofCommit, workflowRunId: r.workflowRunId,
    workflowJobId: r.workflowJobId, evidence: r.evidence,
    evidenceLabel: r.label, postgresMajor: 16, actualProviderCalled: false,
    independentlyAccepted: false, productionTested: false, independentSecurityReview: 'PENDING',
    methodActions: ['existing subscription checkout', 'new subscription checkout'],
    scope: 'Two real own 201s, two victim 403s, forged secondary selectors cannot redirect the owned checkout, persisted victim business IDs >6 and unchanged victim SQL/audit. Synthetic in-process provider only; a checkout is not a payment or plan activation.',
  };
}

export function verifyCheckoutCredit(manifest, read = readFileSync) {
  const entry = manifest.allApiRouteFiles[CHECKOUT_PATH];
  const method = entry?.methods.find(m => m.name === 'POST');
  assert.equal(entry?.gitBlobSha, CHECKOUT_INPUT_BLOBS[CHECKOUT_PATH]);
  assert.equal(method?.status, 'COVERED');
  assert.equal(method.reviewedUncertified, undefined);
  assert.deepEqual(method.testedBy, expectedCheckoutReceipt(read), 'Borrowed or altered checkout proof');
  return 1;
}

function banner(text, metrics) {
  const tag = '> **SOLO_VERIFIED_DEV_RECOVERY — merged checkout credit:**';
  const note = tag + ' 498 methods = ' + metrics.coveredAfter + ' COVERED + 15 PUBLIC-BY-DESIGN + 11 PRIVILEGED-OPERATIONS-TOKEN-ONLY + ' + metrics.gap + ' GAP. One source-sealed #1900 PG16 HTTP method, no live provider, payment or production acceptance.\n\n';
  return note + text.replace(/^> \*\*SOLO_VERIFIED_DEV_RECOVERY — merged checkout credit:\*\*[^\n]*\n\n/, '');
}

export function reconcileCheckoutCredit({ write = false } = {}) {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const before = { covered: m.metrics.coveredAfter, gap: m.metrics.gap };
  const method = m.allApiRouteFiles[CHECKOUT_PATH].methods.find(x => x.name === 'POST');
  if (method.status === 'GAP') {
    assert.equal(method.testedBy, null);
    method.status = 'COVERED'; delete method.reviewedUncertified;
    method.testedBy = expectedCheckoutReceipt();
    method.reason = 'SOLO_VERIFIED_DEV_RECOVERY: merged #1900 source-current PG16 production HTTP, two owned checkout 201s and genuine higher-ID foreign 403s, forged selectors confined to own employer, immutable victim billing/payroll/audit. Synthetic provider only; not a payment or production acceptance.';
  }
  verifyCheckoutCredit(m);
  const methods = Object.values(m.allApiRouteFiles).flatMap(r => r.methods);
  m.metrics.coveredAfter = methods.filter(x => x.status === 'COVERED').length;
  m.metrics.gap = methods.filter(x => x.status === 'GAP').length;
  m.acceptanceStatus = m.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, 'NOT ACCEPTED: ' + m.metrics.gap + ' API methods');
  const note = ' SOLO_VERIFIED_DEV_RECOVERY: merged #1900 checkout receipt promoted; no production acceptance.';
  if (!m.acceptanceStatus.includes(note)) m.acceptanceStatus += note;
  let overview = readFileSync(INVENTORY, 'utf8');
  const pageGaps = m.scopedPages.filter(p => p.status === 'GAP').length;
  overview = overview.replace(/\*\*RELEASE BLOCKER:\*\* \d+ API methods and \d+ business-ID page entries/, '**RELEASE BLOCKER:** ' + m.metrics.gap + ' API methods and ' + pageGaps + ' business-ID page entries')
    .replace(/\*\*NOT ACCEPTED\*\*: \d+ method gaps and \d+ page\/action gaps/, '**NOT ACCEPTED**: ' + m.metrics.gap + ' method gaps and ' + pageGaps + ' page/action gaps');
  for (const key of ['coveredAfter', 'gap']) overview = overview.replace(new RegExp('^\\| ' + key + ' \\| \\d+ \\|$', 'm'), '| ' + key + ' | ' + m.metrics[key] + ' |');
  const lines = overview.split('\n'), index = lines.findIndex(l => l.startsWith('| [`billing` POST]('));
  assert.ok(index >= 0);
  const cells = lines[index].split(' | ');
  cells[cells.length - 2] = '[#1900 PG16 checkout proof](' + method.testedBy.evidence + ') — two own / victim SQL unchanged';
  cells[cells.length - 1] = '**COVERED** |'; lines[index] = cells.join(' | ');
  overview = banner(lines.join('\n'), m.metrics);
  let plan = banner(readFileSync(PLAN, 'utf8'), m.metrics);
  const frozen = plan.split('### Batch DL-01 —')[1]?.split('## Page and server-action closure')[0];
  assert.ok(frozen);
  const total = { COVERED: 0, 'PUBLIC-BY-DESIGN': 0, 'PRIVILEGED-OPERATIONS-TOKEN-ONLY': 0, GAP: 0 };
  for (const section of ('### Batch DL-01 —' + frozen).split('### Batch ').slice(1)) {
    const id = section.split(' ')[0], counts = { ...total };
    for (const key of Object.keys(counts)) counts[key] = 0;
    for (const line of section.split('\n').filter(x => x.startsWith('- `') && x.includes(' — [source](../../src/app/api/'))) {
      const [verb] = line.split('`')[1].split(' '), path = line.split(' — [source](../../')[1].split('#L')[0];
      const status = m.allApiRouteFiles[path].methods.find(x => x.name === verb).status;
      counts[status]++; total[status]++;
    }
    plan = plan.split('\n').map(line => {
      const c = line.split('|'); if (c.length !== 10 || c[2].trim() !== '**' + id + '**') return line;
      c[4] = ' ' + counts.COVERED + ' '; c[5] = ' ' + counts['PUBLIC-BY-DESIGN'] + ' ';
      c[6] = ' ' + counts['PRIVILEGED-OPERATIONS-TOKEN-ONLY'] + ' '; c[7] = ' ' + counts.GAP + ' '; return c.join('|');
    }).join('\n');
  }
  plan = plan.replace(/^Frozen subtotal[^\n]+/m, line => line.replace(/\*\*\d+ COVERED \+ \d+ PUBLIC-BY-DESIGN \+ \d+ PRIVILEGED-OPERATIONS-TOKEN-ONLY \+ \d+ GAP = 406\*\*/, '**' + total.COVERED + ' COVERED + ' + total['PUBLIC-BY-DESIGN'] + ' PUBLIC-BY-DESIGN + ' + total['PRIVILEGED-OPERATIONS-TOKEN-ONLY'] + ' PRIVILEGED-OPERATIONS-TOKEN-ONLY + ' + total.GAP + ' GAP = 406**'));
  for (const [file, bytes] of [[MANIFEST, JSON.stringify(m, null, 2) + '\n'], [INVENTORY, overview], [PLAN, plan]]) {
    if (write) writeFileSync(file, bytes);
    else assert.equal(readFileSync(file, 'utf8'), bytes, 'Run reviewed checkout credit --write: ' + file);
  }
  return { newlyCredited: before.gap - m.metrics.gap, before, after: { covered: m.metrics.coveredAfter, gap: m.metrics.gap } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(process.argv.length === 3 && ['--write', '--check'].includes(process.argv[2]));
  execFileSync('git', ['merge-base', '--is-ancestor', '58e9529d56a8b86c8b3ed060f7df6b3062619910', 'HEAD']);
  console.log(JSON.stringify(reconcileCheckoutCredit({ write: process.argv[2] === '--write' })));
}
