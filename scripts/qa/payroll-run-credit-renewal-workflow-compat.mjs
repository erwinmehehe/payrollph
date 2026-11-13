/** Preserve unaccepted historical page evidence across ONLY exact-head checkout
 * hardening. This grants zero credits and never relabels an old job as a rerun. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const FILE='.github/workflows/security-http-smoke.yml';
const OLD='cca392e383c9f24b3ab6d3ec0e5b0de5a6be2736';
const CURRENT='c87526d027c8f8daa4d350b9ae95cf3b61135afe';
const blob=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
export function historicalHttpWorkflowCheckoutSource(file,expected,read=readFileSync){
  assert.equal(file,FILE);assert.equal(expected,OLD);
  const source=String(read(file,'utf8')).replaceAll('\r\n','\n');
  assert.equal(blob(source),CURRENT,'Unreviewed HTTP workflow changes cannot borrow checkout hardening');
  const now='      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\n'+
    '        with:\n          persist-credentials: false\n'+
    '          ref: ${{ github.event.pull_request.head.sha || github.sha }}\n'+
    '      - name: Verify exact proposed HTTP-proof source\n        env:\n'+
    '          EXPECTED_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}\n'+
    '        run: test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"\n';
  assert.equal(source.split(now).length,2,'One exact reviewed checkout change required');
  const restored=source.replace(now,'      - uses: actions/checkout@v7\n');
  assert.equal(blob(restored),OLD,
    'All historical HTTP, schema, feature and provider instructions must reconstruct byte-for-byte');
  return restored;
}
export function assertHistoricalHttpWorkflowCheckout(file,expected,read=readFileSync){
  historicalHttpWorkflowCheckoutSource(file,expected,read);return true;
}
