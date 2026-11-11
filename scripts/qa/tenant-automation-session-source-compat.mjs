/** Historical source projection only. Fresh combined-head HTTP is mandatory before credit. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMBINED_AUTOMATION_SHA,verifyCombinedStudioSource} from './tenant-studio-combined-source-compat.mjs';
export const HISTORICAL_AUTOMATION_SHA='288d27789e062803d68ea38fd41fa78ee155a1ee';
export const CURRENT_AUTOMATION_SHA=COMBINED_AUTOMATION_SHA;
export function verifySessionSourceCompatibility(historicalSha,currentSha,read=readFileSync){
 assert.equal(historicalSha,HISTORICAL_AUTOMATION_SHA,'Unexpected historical automation provenance');
 assert.equal(currentSha,CURRENT_AUTOMATION_SHA,'Unreviewed current automation source');
 return verifyCombinedStudioSource(read);
}
