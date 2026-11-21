/** Historical test inputs only. Never call this from a current-credit writer. */
import {readFileSync,cpSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {historicalNext16DependencyInput} from './historical-next16-dependencies.mjs';
import {historicalDocumentSecurityFixture as archivedDocumentFixture,protectedDocumentCreditKeys,sourceHoldArchive} from '../../scripts/qa/document-source-accounting.mjs';
import {readSecurityV2Receipt} from '../../scripts/qa/security-write-v2-credit.mjs';
import {readSecurityEvidence,verifySecurityCredits} from '../../scripts/qa/tenant-security-write-credit.mjs';
export {SECURITY_TARGETS} from '../../scripts/qa/tenant-security-write-credit.mjs';
// The historical receipt verifies this archived source against its original Git
// blob. Current credits still read the working tree through the live verifier.
export function historicalDocumentSecurityFixture(manifest) {
 const historical = archivedDocumentFixture(manifest);
 return {
   manifest: historical.manifest,
   read: (file, ...args) => file === 'src/lib/payroll-rules.ts'
     ? readFileSync('tests/fixtures/tenant-historical-payroll-rules.txt', ...args)
     : file === 'package.json' || file === 'package-lock.json'
       ? historicalNext16DependencyInput(file, path => historical.read(path))
       : historical.read(file, ...args),
 };
}
const live=()=>JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json'));
export function readHistoricalSecurityEvidence(){return readSecurityEvidence(historicalDocumentSecurityFixture(live()).read);}
export function verifyHistoricalSecurityCredits(manifest){
 const old=historicalDocumentSecurityFixture(manifest);
 return verifySecurityCredits(old.manifest,old.read);
}
export function copyDocumentHoldInputs(root){
 protectedDocumentCreditKeys(live());
 const archive=sourceHoldArchive();
 const receipt=JSON.parse(readFileSync('scripts/qa/separation-pg16-http-receipt.json','utf8'));
 // The per-method security-write receipt verifies its own executed closure wherever a promoted row is read.
 const v2=readSecurityV2Receipt();
 const reproofPath='scripts/qa/separation-pg16-next-reproof.json';
 const reproof=JSON.parse(readFileSync(reproofPath,'utf8'));
 const paths=new Set([reproofPath,...archive.variants.flatMap(variant=>Object.keys(variant.sourcePins)),
  ...Object.keys(receipt.sourcePins),...Object.keys(reproof.sourcePins),
  ...Object.keys(v2.globalPins),...Object.values(v2.methodPins).flatMap(pins=>Object.keys(pins))]);
 for(const file of paths) {
  mkdirSync(dirname(join(root,file)),{recursive:true});cpSync(file,join(root,file));
 }
}
