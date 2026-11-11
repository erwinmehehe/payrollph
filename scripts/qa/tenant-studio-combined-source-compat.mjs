/** Exact composition of #1922 and #1924. Preserves historical bytes only;
 * it does NOT claim an old job executed this engine or grant a new credit. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {restoreRecoveryPatch,restoreSessionPatch} from './tenant-automation-reviewed-patches.mjs';
export const COMBINED_AUTOMATION_SHA='edb8330bc19362fb6828247eeddfb2f0c6169795';
export const COMBINED_PROOF_PINS=Object.freeze({
 'scripts/qa/tenant-automation-reviewed-patches.mjs':'ce1bf354bb5c27b83a0ad1480c4b20ca2ca3f496',
 'src/lib/automation-recovery-scope.ts':'ff3dddff0e7ddea20a7be24792d84503a540202e',
 'src/lib/automation-employee-account-boundary.ts':'4b66410789ec536482d63d9d58c5df1b17b38746',
 'scripts/qa/tenant-studio-recovery-scope-http.mjs':'5ed183ec0560ae4ccc53f56f4652a2d66d782e1e',
 'scripts/qa/tenant-studio-recovery-scope-local-receipt.json':'b522cb5d4363e4436535bf757affbfd6c2103818',
 'scripts/qa/tenant-studio-recovery-scope-contract.mjs':'97ed2220e0d69ee391c73fa563c1649b3f1cfbe2',
 'scripts/qa/tenant-studio-draft-contract.mjs':'cb0e485354de6a470c04c9d79d89b8d6bafccb71',
 'scripts/qa/tenant-studio-language-contract.mjs':'cbc7432ddf9eaa3dadd3b9866aeffb3846714b6d',
 'scripts/qa/tenant-automation-session-ownership-http.mjs':'44323b1ca7cf406a2644f852425837ae05237cb2',
 '.github/workflows/tenant-automation-session-ownership.yml':'4e38d660816716d9ee9b3174c2e3ed88ed2413ce',
});
export function combinedBlob(raw){const b=Buffer.from(raw.toString().replaceAll('\r\n','\n'));return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');}
export function verifyCombinedStudioSource(read=readFileSync){
 const source=read('src/lib/automation.ts').toString().replaceAll('\r\n','\n');
 assert.equal(combinedBlob(source),COMBINED_AUTOMATION_SHA,'Current automation engine changed without source refresh');
 for(const [p,sha]of Object.entries(COMBINED_PROOF_PINS))assert.equal(combinedBlob(read(p)),sha,'Combined Studio proof input drift: '+p);
 assert.equal(combinedBlob(restoreRecoveryPatch(source)),'b6e8900f11f39f12263acb7ecd140a823e89a623','Session fix must remain intact');
 assert.equal(combinedBlob(restoreSessionPatch(source)),'ce2c8e8feee4554c85f7739b73f2fa0325b81306','Recovery fix must remain intact');
 assert.equal(combinedBlob(restoreRecoveryPatch(restoreSessionPatch(source))),'288d27789e062803d68ea38fd41fa78ee155a1ee','No unrelated engine edits may borrow historical receipts');
 return {credits:0,independentlyAccepted:false,productionCertified:false,sourceSha:COMBINED_AUTOMATION_SHA,proofStatus:'COMBINED_HEAD_HTTP_RENEWAL_REQUIRED'};
}
