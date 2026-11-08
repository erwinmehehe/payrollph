/** Test process only: reserved scanner/object/webhook fixtures; deny other egress. */
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {requireSecurityWrite} from './tenant-security-write-local-contract.mjs';
requireSecurityWrite();
const stats={webhooks:[],scans:0,puts:0,gets:0,deletes:0};const objects=new Map();
mkdirSync('outputs',{recursive:true});
const save=()=>writeFileSync('outputs/security-write-transport.json',JSON.stringify(stats));save();
dns.lookup=async(host,options)=>{assert.equal(host,'hooks.fixture.invalid','SECURITY_FIXTURE_DNS_REFUSED');const row={address:'93.184.216.34',family:4};return options?.all?[row]:row;};
const nativeHttp=http.request;
http.request=(url,...args)=>{const u=new URL(url);assert.equal(u.hostname,'127.0.0.1','SECURITY_FIXTURE_HTTP_REFUSED');return nativeHttp(url,...args);};
https.request=(url,options,callback)=>{
  const u=new URL(url);assert.equal(u.hostname,'hooks.fixture.invalid','SECURITY_FIXTURE_HTTPS_REFUSED');
  assert.match(u.pathname,/^\/fictional\/[A-Za-z0-9_-]+$/);assert.equal(options.method,'POST');
  const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=error=>{req.emit('error',error);return req;};
  req.end=body=>{try{assert.ok(Buffer.byteLength(body)<5000);const payload=JSON.parse(body);
    assert.equal(payload.event,'payroll.processed');assert.equal(payload.data?.test,true);assert.ok(Number.isSafeInteger(payload.organizationId));
    assert.match(options.headers['Linaw-Signature'],/^t=\d+,v1=[a-f0-9]{64}$/);
    stats.webhooks.push({organizationId:payload.organizationId,signatureSha256:createHash('sha256').update(options.headers['Linaw-Signature']).digest('hex'),bodySha256:createHash('sha256').update(body).digest('hex')});save();
    const res=new EventEmitter();res.statusCode=204;res.resume=()=>res;
    process.nextTick(()=>{callback(res);res.emit('end');});
  }catch(e){process.nextTick(()=>req.emit('error',e));}return req;};return req;
};
syncBuiltinESMExports();
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const u=new URL(input instanceof Request?input.url:String(input));
  if(u.href==='https://scanner.fixture.invalid/scan'){
    const h=new Headers(init.headers);const b=Buffer.from(init.body??[]);
    assert.equal(h.get('authorization'),'Bearer '+process.env.MALWARE_SCAN_TOKEN);assert.equal(h.get('content-type'),'application/pdf');
    assert.ok(b.length<10000&&b.subarray(0,4).equals(Buffer.from('%PDF'))&&b.includes(Buffer.from('FICTIONAL-DOCUMENT-TEST-ONLY')));
    stats.scans++;save();return Response.json({clean:true,engine:'fictional-ci-scanner'});
  }
  if(u.origin==='https://objects.fixture.invalid'){
    assert.match(u.pathname,/^\/fictional-documents\/private-documents\/[1-9]\d*\/(?:[1-9]\d*|company)\/[a-f0-9-]{36}$/);
    assert.ok(u.searchParams.get('X-Amz-Credential')?.startsWith('fixture-document-access/'));
    assert.match(u.searchParams.get('X-Amz-Signature')??'',/^[a-f0-9]{64}$/);
    if(init.method==='PUT'){assert.ok(!objects.has(u.pathname));const bytes=Buffer.from(init.body);assert.ok(bytes.length<10000&&bytes.includes(Buffer.from('FICTIONAL-DOCUMENT-TEST-ONLY')));objects.set(u.pathname,bytes);stats.puts++;save();return new Response(null,{status:200});}
    if(init.method==='GET'){stats.gets++;save();return objects.has(u.pathname)?new Response(objects.get(u.pathname),{status:200}):new Response(null,{status:404});}
    if(init.method==='DELETE'){objects.delete(u.pathname);stats.deletes++;save();return new Response(null,{status:204});}
    throw Error('SECURITY_FIXTURE_OBJECT_METHOD_REFUSED');
  }
  if(u.protocol==='http:'&&u.hostname==='127.0.0.1')return nativeFetch(input,init);
  throw Error('SECURITY_FIXTURE_FETCH_REFUSED');
};
