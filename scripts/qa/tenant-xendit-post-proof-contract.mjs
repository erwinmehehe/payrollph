/** Four-operation proof assertions; no application/database imports. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const XENDIT_POST_ACTIONS=Object.freeze(['preflight','submit','reconcile','resolve-unknown']);
export const XENDIT_POST_SOURCE_PINS=Object.freeze({
  'src/app/api/payroll-runs/[id]/xendit-payout/route.ts':'b7d8aa1dc83959ec4516b5a65cc62999c79ebfda',
  'src/lib/xendit-payroll-operations.ts':'4c6b19bb3cf6e8478b128310f1f3c66925e21f5c',
  'src/lib/xendit-payroll-payouts.ts':'58e573a89d7677a560ebad3fd56671d60386e5a8',
  'src/lib/xendit-payout-ledger.ts':'6552b234f738b400dc3e9be39e34be74071d7248',
  'src/lib/payroll-payout-provider.ts':'8baf1b147c1f359dd2303341701c7df0506c53bd',
  'src/lib/payroll-run-membership.ts':'75f5a40afd1ee4f608a2fe38be9971f4bc8bed47',
  'src/lib/treasury-controls.ts':'54b280339e316ec9aa14bc39c7636c6adf5a32b4',
  'src/lib/access.ts':'08d3481dbd20279a4a8aef64f0932f79bec48444',
  'src/lib/auth.ts':'b13275e0e09b629ddb679c55e7898da44c72ad20',
  'src/lib/security-request.ts':'de996ebb7eb663aaebf65f8a963d955b8bc90c9d',
  'src/lib/payroll-payout-snapshot.ts':'6ad8fc04defe76b65b3fe5b149dd64e4695e6d29',
  'src/db/schema.ts':'3f504163c9847a99434a5e01a72c120dfd680a02',
  'scripts/qa/tenant-table-http.mjs':'31894982d768e34c1653be7c4335194f60233c6e',
});
export function verifyXenditPostSourcePins(read=readFileSync){
  for(const[file,expected]of Object.entries(XENDIT_POST_SOURCE_PINS)){
    const b=Buffer.from(read(file));
    assert.equal(createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex'),expected,
      'XENDIT_POST_SOURCE_DRIFT: '+file);
  }
}
export function assertOwnedXenditPreflight(response){
  assert.equal(response.status,200);
  assert.deepEqual(response.json,{ready:true,provider:'xendit',transferCount:1,
    totalAmountCents:1800000,blockers:[],moneyMoved:false});
}
export function assertOwnedXenditLedger(ledger,expected){
  assert.ok(ledger&&typeof ledger==='object','A populated own ledger is required');
  assert.equal(ledger.batchId,expected.batchId);
  assert.equal(ledger.provider,'xendit');
  assert.deepEqual(ledger.totals,{amountCents:1800000,transferCount:1});
  assert.deepEqual(ledger.rows,[{
    transferId:expected.transferId,payrollEntryId:expected.entryId,employeeNo:expected.employeeNo,
    referenceNumber:expected.referenceNumber,amountCents:1800000,providerPayoutId:expected.payoutId,
    status:expected.status,
  }],'Ledger must contain exactly the persisted own instruction, not another employer or a default empty response');
  const counts={prepared:0,submitted:0,succeeded:0,failed:0,reversed:0,unknown:0};
  counts[['submitting','reconciliation_required'].includes(expected.status)?'unknown':expected.status]=1;
  assert.deepEqual(ledger.counts,counts);
}
export function assertXenditPostRefusal(response,status,forbidden){
  assert.equal(response.status,status,'Wrong refusal: '+response.text.slice(0,120));
  for(const marker of forbidden)assert.ok(!response.text.includes(marker),'Denied request disclosed protected fixture data');
  assert.ok(!response.json?.ledger&&!response.json?.submitted,'A refusal cannot return a payout receipt');
}
export function assertXenditProtectedUnchanged(before,after,label){
  assert.deepEqual(after,before,label+': protected employer SQL/audit changed');
}
