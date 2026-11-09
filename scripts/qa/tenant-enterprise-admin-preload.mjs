/** Test-process transport only. Never imported by application source. */
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';import https from 'node:https';import http from 'node:http';
import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {readFileSync} from 'node:fs';
import {requireEnterpriseProofEnvironment} from './tenant-enterprise-admin-contract.mjs';
requireEnterpriseProofEnvironment();
const fictional=host=>/^(idp|employer)-\d+\.enterprise\.example\.test$/.test(host);
const originalLookup=dns.lookup;
dns.lookup=async function(host,options){
 if(fictional(host))return options?.all?[{address:'93.184.216.34',family:4}]:{address:'93.184.216.34',family:4};
 if(host==='localhost'||host==='127.0.0.1')return originalLookup.call(this,host,options);
 throw Error('ENTERPRISE_PROOF_EGRESS_REFUSED: unlisted DNS host');
};
dns.resolveTxt=async function(host){
 assert.ok(fictional(host),'ENTERPRISE_PROOF_EGRESS_REFUSED: unlisted TXT host');
 const raw=readFileSync('outputs/tenant-enterprise-dns.json','utf8');
 assert.ok(raw.length<32000);const rows=JSON.parse(raw);assert.equal(typeof rows[host],'string');return [[rows[host]]];
};
https.request=function(url,options,callback){
 const target=new URL(String(url));
 assert.ok(fictional(target.hostname));assert.equal(target.protocol,'https:');
 assert.equal(options.method,'GET');assert.equal(target.pathname,'/.well-known/openid-configuration');
 assert.equal(options.servername,target.hostname);assert.equal(typeof options.lookup,'function');
 const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=error=>{if(error)req.emit('error',error);return req;};
 req.end=()=>queueMicrotask(()=>{const response=new PassThrough();response.statusCode=200;callback(response);response.end(JSON.stringify({issuer:target.origin,authorization_endpoint:target.origin+'/authorize',token_endpoint:target.origin+'/token',jwks_uri:target.origin+'/jwks'}));});
 return req;
};
const originalHttp=http.request;
http.request=function(url,...args){const u=new URL(String(url));assert.ok(['127.0.0.1','localhost'].includes(u.hostname),'ENTERPRISE_PROOF_EGRESS_REFUSED');return originalHttp.call(this,url,...args);};
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){const u=new URL(input instanceof Request?input.url:String(input));assert.ok(['127.0.0.1','localhost'].includes(u.hostname),'ENTERPRISE_PROOF_EGRESS_REFUSED');return originalFetch.call(this,input,...args);};
syncBuiltinESMExports();
