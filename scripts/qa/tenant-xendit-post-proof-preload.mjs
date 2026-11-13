/** Only installed in a separately approved disposable proof server process. */
import {assertXenditPostProofTarget,assertXenditBlockedProofTarget,assertSyntheticXenditRequest} from './tenant-xendit-post-proof-target.mjs';
if(process.env.TENANT_XENDIT_PROFILE==='blocked')assertXenditBlockedProofTarget(process.env);
else assertXenditPostProofTarget(process.env);
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{
  const request=new Request(input,options);
  const target=assertSyntheticXenditRequest(request);
  return nativeFetch(target,{method:request.method,headers:request.headers,
    body:request.method==='GET'?undefined:request.body,duplex:'half',
    signal:request.signal,redirect:'error',cache:'no-store'});
};
