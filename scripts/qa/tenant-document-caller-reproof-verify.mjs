import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {assertHistoricalNextConfigPreservedWithInvitationHeaders} from './tenant-invitation-header-source-compat.mjs';
const RECEIPT='scripts/qa/tenant-document-caller-reproof-receipt.json';
const DIGEST='aee9a88d62b4fa68efd1ab61eb66343218a77532467a9cc28654f19bb833d91e';
export function verifyDocumentCallerReproof(reference, read=readFileSync){
 const raw=read(RECEIPT,'utf8');
 assert.equal(createHash('sha256').update(raw).digest('hex'),DIGEST,'Executed caller receipt changed');
 const receipt=JSON.parse(raw);
 assert.deepEqual(reference,{receiptFile:RECEIPT,head:receipt.head,run:receipt.run,job:receipt.job,credits:0});
 assert.equal(receipt.label,'SOLO_VERIFIED_DEV_RECOVERY');
 assert.equal(receipt.head,'2d239ffa212a92205476083a1e9d960fd8be46a3');
 assert.equal(receipt.run,42434366023);assert.equal(receipt.job,128589939228);
 assert.equal(receipt.credits,0);
 for(const [file,sha] of Object.entries(receipt.pins)){
  if(file==='next.config.ts') {
   assertHistoricalNextConfigPreservedWithInvitationHeaders(read(file,'utf8'),sha);
   continue;
  }
  const raw=Buffer.from(read(file,'utf8').toString().replaceAll('\r\n','\n'));
  const current=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
  assert.equal(current,sha,'Executed caller input changed: '+file);
 }
 return receipt;
}
