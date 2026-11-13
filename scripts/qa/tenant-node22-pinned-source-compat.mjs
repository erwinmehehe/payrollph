/** Narrow runtime-compatibility review, not historical method re-execution.
 * Historical receipts and their original hashes stay immutable. All previous
 * DNS/public-IP/redirect/status/body/timeout/TLS logic must reconstruct exactly.
 * New real HTTPS/PKCE/JWKS execution is separately sealed and mandatory.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {oidcFullExecution} from './tenant-oidc-full-credit.mjs';
export function assertHistoricalPinnedNetworkPreserved(bytes,expected,read=readFileSync){
 assert.equal(expected,'f263da3898451ee53c7b3d1490241ea8aa46e0c2','Only the exact original network receipt is eligible');
 const source=bytes.toString().replaceAll('\r\n','\n');
 const blob=x=>createHash('sha1').update('blob '+Buffer.byteLength(x)+'\0'+x).digest('hex');
 assert.equal(blob(source),'bb82ff473655683e28621e6a8745c5ec0d9d9ef5','Network source/proof drift: unreviewed transport edit needs fresh proof');
 const addition='      ...{ autoSelectFamily: false },\n';assert.equal(source.split(addition).length,4);
 assert.equal(blob(source.replaceAll(addition,'')),expected,'Historical security logic changed');
 oidcFullExecution(read);return {newCredits:0,historicalReexecution:false,productionAccepted:false};
}
