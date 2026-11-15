/** Private, unpredictable and exclusive sanitized-evidence file creation. */
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export function writePrivateSamlReceipt(receipt,base=tmpdir()){
 const directory=mkdtempSync(join(base,'payrollph-saml-metadata-public-'));
 chmodSync(directory,0o700);
 const path=join(directory,'receipt.json');
 writeFileSync(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 if(process.platform!=='win32'){
  assert.equal(statSync(directory).mode&0o777,0o700);
  assert.equal(statSync(path).mode&0o777,0o600);
 }
 assert.ok(statSync(path).isFile());assert.equal(statSync(path).nlink,1);
 return path;
}
