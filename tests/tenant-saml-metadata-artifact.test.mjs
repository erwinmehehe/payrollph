import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {writePrivateSamlReceipt} from '../scripts/qa/tenant-saml-metadata-artifact.mjs';
test('receipts use different private directories, exclusive regular files and exact public JSON',()=>{
 const root=mkdtempSync(join(tmpdir(),'saml-artifact-test-')),paths=[];
 try{
  for(let i=0;i<2;i++)paths.push(writePrivateSamlReceipt({fixture:i,coverageCredits:0},root));
  assert.notEqual(dirname(paths[0]),dirname(paths[1]));
  for(const[p,i]of paths.map((p,i)=>[p,i])){
   assert.equal(dirname(dirname(p)),root);assert.deepEqual(JSON.parse(readFileSync(p)),{fixture:i,coverageCredits:0});
   assert.ok(statSync(p).isFile());assert.equal(statSync(p).nlink,1);
   if(process.platform!=='win32'){assert.equal(statSync(dirname(p)).mode&0o777,0o700);assert.equal(statSync(p).mode&0o777,0o600);}
  }
 }finally{
  for(const p of paths){assert.equal(dirname(dirname(p)),root);unlinkSync(p);rmdirSync(dirname(p));}
  rmdirSync(root);
 }
});
