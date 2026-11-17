/** Immutable withdrawal fixture for historical receipt rejection tests.
 * The actual live manifest is first verified by the complete fresh source-bound
 * renewal verifier. Projection explains the old source; it grants NO credits. */
import {readFileSync} from 'node:fs';
import {wageRenewalHoldView} from '../../scripts/qa/wage-registry-renewal-verify.mjs';
export function readWageWithdrawalFixture(){
 return wageRenewalHoldView(JSON.parse(readFileSync('scripts/qa/tenant-isolation-coverage-manifest.json','utf8')));
}
