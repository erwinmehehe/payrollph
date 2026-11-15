import assert from 'node:assert/strict';
import {requireFullOidcEnv,IDP_ORIGIN,CANONICAL_APP} from './tenant-oidc-full-contract.mjs';
export function requireOidcBatchEnv(env=process.env){
 requireFullOidcEnv(env);
 assert.equal(env.OIDC_RECOVERY_BATCH_MODE,'fictional-pg16-start-callback-only','OIDC_BATCH_REFUSED: explicit bounded profile required');
}
export function assertOwnedOidcStart(response,e){
 assert.equal(response.status,302,'An own verified-domain start must redirect');
 assert.ok(response.headers.get('cache-control')?.includes('no-store'));
 const redirect=new URL(response.headers.get('location'));
 assert.equal(redirect.origin,IDP_ORIGIN);assert.equal(redirect.pathname,'/'+e.label+'/authorize');
 assert.equal(redirect.searchParams.get('client_id'),e.client);
 assert.equal(redirect.searchParams.get('login_hint'),e.email);
 assert.equal(redirect.searchParams.get('redirect_uri'),CANONICAL_APP+'/api/auth/sso/callback');
 assert.equal(redirect.searchParams.get('response_type'),'code');
 assert.equal(redirect.searchParams.get('code_challenge_method'),'S256');
 assert.match(redirect.searchParams.get('state')??'',/^[a-f0-9]{64}$/);
 assert.ok(redirect.searchParams.get('nonce'));
 assert.ok(redirect.searchParams.get('code_challenge'));
 const cookies=response.headers.getSetCookie();
 assert.ok(!cookies.some(x=>x.startsWith('__Host-linaw_session=')),'Start cannot create an authenticated session');
 const browser=cookies.filter(x=>x.startsWith('linaw_oidc_browser_state='));assert.equal(browser.length,1);
 assert.equal(browser[0].split(';')[0],'linaw_oidc_browser_state='+redirect.searchParams.get('state'));
 for(const attribute of ['HttpOnly','Secure','SameSite=lax','Path=/api/auth/sso/callback'])
  assert.ok(browser[0].toLowerCase().includes(attribute.toLowerCase()),'Missing browser-state bound: '+attribute);
 return redirect;
}
export function assertDeniedOidcStart(response,status,forbidden){
 assert.equal(response.status,status);
 assert.equal(typeof response.json?.error,'string');
 assert.ok(!response.headers.get('location'));
 assert.ok(!response.headers.getSetCookie().some(x=>/^(?:linaw_oidc_browser_state|__Host-linaw_session)=/.test(x)));
 for(const marker of forbidden)assert.ok(!response.text.includes(marker),'Denied start disclosed victim data');
}
