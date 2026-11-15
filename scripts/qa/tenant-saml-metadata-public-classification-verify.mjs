/** Both owner authorization and source-current executed proof are mandatory. */
import {readFileSync} from 'node:fs';
import {verifyFreshSamlExecution} from './tenant-saml-metadata-fresh-execution-verify.mjs';
import {SAML_PUBLIC_PATH,verifySamlPublicPolicy} from './tenant-saml-metadata-public-policy.mjs';
export function verifySamlPublicClassification(m,read=readFileSync){
 verifyFreshSamlExecution(read);return verifySamlPublicPolicy(m,read);
}
export function samlPublicClassificationDelta(before,m,read=readFileSync){
 const old=before.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0],current=m.allApiRouteFiles[SAML_PUBLIC_PATH].methods[0];
 return current.status==='PUBLIC-BY-DESIGN'&&old.status==='GAP'?verifySamlPublicClassification(m,read):0;
}
