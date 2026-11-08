import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const FILE='scripts/qa/tenant-spend-managed-receipt.json';
export const TARGETS=['POST spend','PATCH spend','POST managed-payroll/runs/[id]/approve'];
const blob=raw=>{const b=Buffer.from(raw.toString().replaceAll('\r\n','\n'));return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');};
const RECEIPT_DIGEST='06e88ab50b0b0e0d35b3a925e0fe3e1f3ab17cc13229fc966eacef5a1fbb312e';
export function verifySpendManaged(manifest,reader=readFileSync){
 const raw=reader(FILE).toString().replaceAll('\r\n','\n');
 assert.equal(createHash('sha256').update(raw).digest('hex'),RECEIPT_DIGEST,'immutable reviewed receipt');
 const r=JSON.parse(raw);
 assert.equal(r.head,'f286d177ebc5acb304fd743d5df31a421471bcd4');
 assert.equal(r.run,42425680713); assert.equal(r.job,128563327706);
 assert.deepEqual(Object.keys(r.methods),TARGETS);
 for(const [file,pin] of Object.entries(r.pins)){
  assert.ok(!file.includes('..')&&!file.startsWith('/'),'repository source only');
  assert.equal(blob(reader(file)),pin,file+': executed source drift');
 }
 for(const key of TARGETS){const [verb,...parts]=key.split(' '),path='src/app/api/'+parts.join(' ')+'/route.ts';
  const method=manifest.allApiRouteFiles[path].methods.find(m=>m.name===verb);
  assert.equal(method.status,'COVERED');assert.deepEqual(method.testedBy,r.methods[key]);
  assert.equal(method.testedBy.evidenceLabel,'SOLO_VERIFIED_DEV_RECOVERY');
  assert.equal(manifest.allApiRouteFiles[path].gitBlobSha,r.pins[path]);
 }
 return 3;
}
