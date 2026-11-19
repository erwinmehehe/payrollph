/** Historical test inputs only. Never call this from a current-credit writer. */
import {readFileSync,cpSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {historicalDocumentSecurityFixture,protectedDocumentCreditKeys,sourceHoldArchive} from '../../scripts/qa/document-source-accounting.mjs';
import {readSecurityEvidence,verifySecurityCredits} from '../../scripts/qa/tenant-security-write-credit.mjs';
export {SECURITY_TARGETS} from '../../scripts/qa/tenant-security-write-credit.mjs';
const live=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
export function readHistoricalSecurityEvidence(){return readSecurityEvidence(historicalDocumentSecurityFixture(live()).read);}
export function verifyHistoricalSecurityCredits(manifest){
 const old=historicalDocumentSecurityFixture(manifest);
 return verifySecurityCredits(old.manifest,old.read);
}
export function copyDocumentHoldInputs(root){
 protectedDocumentCreditKeys(live());
 const archive=sourceHoldArchive();
 for(const variant of archive.variants)for(const file of Object.keys(variant.sourcePins)) {
  mkdirSync(dirname(join(root,file)),{recursive:true});cpSync(file,join(root,file));
 }
}
