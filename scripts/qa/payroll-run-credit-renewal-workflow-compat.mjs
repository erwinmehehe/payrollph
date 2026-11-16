/** Preserve unaccepted historical page evidence across ONLY exact-head checkout
 * and a read-only main-ledger fetch. HTTP/application instructions stay exact.
 * hardening. This grants zero credits and never relabels an old job as a rerun. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const FILE='.github/workflows/security-http-smoke.yml';
const OLD='cca392e383c9f24b3ab6d3ec0e5b0de5a6be2736';
const CHECKOUT_ONLY='c87526d027c8f8daa4d350b9ae95cf3b61135afe';
const CURRENT='859457318db55c554fa915e76edbbebeacfeed00';
const MAIN_LEDGER_FETCH='      - name: Fetch main ledger for strict source-withdrawal assertions\n'+
  '        shell: bash\n        run: |\n'+
  '          git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main\n'+
  '          git cat-file -e origin/main:scripts/qa/tenant-isolation-coverage-manifest.json\n';
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
export function historicalHttpWorkflowCheckoutSource(file,expected,read=readFileSync){
  assert.equal(file,FILE);assert.equal(expected,OLD);
  const source=String(read(file,'utf8')).replaceAll('\r\n','\n');
  assert.equal(blob(source),CURRENT,'Unreviewed HTTP workflow changes cannot borrow checkout hardening');
  assert.equal(source.split(MAIN_LEDGER_FETCH).length,2,'Exactly one read-only main baseline fetch required');
  const checkoutSource=source.replace(MAIN_LEDGER_FETCH,'');
  assert.equal(blob(checkoutSource),CHECKOUT_ONLY,'Main fetch must leave every prior step byte-identical');
  const now='      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n'+
    '        with:\n          persist-credentials: false\n'+
    '          ref: ${{ github.event.pull_request.head.sha || github.sha }}\n'+
    '      - name: Verify exact proposed HTTP-proof source\n        env:\n'+
    '          EXPECTED_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}\n'+
    '        run: test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"\n';
  assert.equal(checkoutSource.split(now).length,2,'One exact reviewed checkout change required');
  const restored=checkoutSource.replace(now,'      - uses: actions/checkout@v7\n');
  assert.equal(blob(restored),OLD,
    'All historical HTTP, schema, feature and provider instructions must reconstruct byte-for-byte');
  return restored;
}
export function assertHistoricalHttpWorkflowCheckout(file,expected,read=readFileSync){
  historicalHttpWorkflowCheckoutSource(file,expected,read);return true;
}
