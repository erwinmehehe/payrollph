import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {verifyEmailCredit,resolveProofRepoPath} from '../scripts/qa/tenant-email-verification-credit.mjs';
const read=path=>readFileSync(path,'utf8');
const manifest=JSON.parse(read('scripts/qa/tenant-isolation-coverage-manifest.json'));
const receipt=JSON.parse(read('scripts/qa/tenant-email-verification-credit-receipt.json'));
test('email credit binds executed inputs and exact owned/foreign/victim proof lines',()=>assert.equal(verifyEmailCredit(manifest,receipt),1));
test('email credit rejects a substituted run, proof and source',()=>{
  const wrong=structuredClone(receipt);wrong.execution.job++;assert.throws(()=>verifyEmailCredit(manifest,wrong),/receipt bytes/);
  const bad=structuredClone(manifest);bad.allApiRouteFiles['src/app/api/account/email/verify/route.ts'].methods[0].testedBy.workflowJobId++;
  assert.throws(()=>verifyEmailCredit(bad,receipt),/exact reviewed/);
  const source='src/app/api/account/email/verify/route.ts';
  assert.throws(()=>verifyEmailCredit(manifest,receipt,path=>read(path)+(path===source?'\n// drift':'')),/executed input drift/);
});

test('email proof import paths are strictly confined to the checked-out repository',()=>{
  for(const unsafe of ['../outside','.github/../secrets','src/../../etc/passwd',
    '/etc/passwd','C:\\\\Windows\\\\system.ini','src\\\\lib\\\\auth.ts','src//lib/auth.ts','src/./lib/auth.ts',
    'other/proof.mjs','src/lib/auth.ts\\0trail']) {
    assert.throws(()=>resolveProofRepoPath(unsafe));
  }
  assert.match(resolveProofRepoPath('src/app/api/account/email/verify/route.ts'),
    /src[\\\\/]app[\\\\/]api[\\\\/]account[\\\\/]email[\\\\/]verify[\\\\/]route\\.ts$/);
});
