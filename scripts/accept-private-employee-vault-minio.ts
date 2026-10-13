import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  documentObjectKey, documentStorageConfig, signedDocumentObjectUrl,
  putDocumentObject, deleteDocumentObject,
} from "../src/lib/document-object-storage";
import { documentObjectIdentityMatches } from "../src/lib/employee-document-vault";
import { scanUpload, validateUpload } from "../src/lib/storage";

/**
 * Synthetic MinIO + deterministic scanner-contract acceptance.
 * This is NOT acceptance of a real S3 tenant, real ClamAV provider, legal
 * holds or production file residency.
 */
async function main() {
assert.equal(process.env.CI,"true");
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED,"true");
assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.env.DOCUMENT_OBJECT_STORAGE_ENDPOINT,"http://127.0.0.1:9000/");
assert.equal(process.env.DOCUMENT_OBJECT_STORAGE_BUCKET,"private-documents-ci");
const config=documentStorageConfig();
const org=42,employee=71;
const key=documentObjectKey(org,employee);
assert.equal(documentObjectIdentityMatches(key,org,employee),true);
assert.equal(documentObjectIdentityMatches(key,org+1,employee),false);

const bytes=Buffer.from("%PDF-1.7\n% Synthetic A5 private file - no customer data\n");
const mime="application/pdf";
const valid=validateUpload(bytes,mime,"synthetic.pdf");
assert.equal(valid.ok,true);

const calls:Array<{url:string;auth:string|null;size:number}>=[];
const fakeScan=(payload:Record<string,unknown>,status=200)=>async (_url:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(_url),auth:new Headers(init?.headers).get("authorization"),size:Buffer.isBuffer(init?.body)?init.body.byteLength:0});
  return new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});
};
const scanInput={fileName:"synthetic.pdf",mime};
const clean=await scanUpload(bytes,scanInput,{fetchImpl:fakeScan({clean:true,engine:"Synthetic Scanner Contract"})});
assert.equal(clean.scannedClean,true);
assert.equal(calls.length,1);
assert.match(calls[0].auth??"",/^Bearer /);
assert.equal(calls[0].size,bytes.length);
const infected=await scanUpload(bytes,scanInput,{fetchImpl:fakeScan({clean:false,engine:"Synthetic",threat:"FICTIONAL_TEST_SIGNATURE"})});
assert.equal(infected.scannedClean,false);
assert.equal(infected.unavailable,undefined);
const outage=await scanUpload(bytes,scanInput,{fetchImpl:fakeScan({error:"unavailable"},503)});
assert.equal(outage.scannedClean,false);
assert.equal(outage.unavailable,true);
const malformed=await scanUpload(bytes,scanInput,{fetchImpl:fakeScan({status:"unknown"})});
assert.equal(malformed.scannedClean,false);
assert.equal(malformed.unavailable,true);

const unsigned=new URL(config.endpoint+"/"+config.bucket+"/"+key);
const before=await fetch(unsigned);
assert.ok([403,404].includes(before.status),"unsigned object access must be denied");
await putDocumentObject(key,bytes,mime,{config});
const signed=signedDocumentObjectUrl(key,"GET",config,{expirySeconds:60});
const downloaded=await fetch(signed,{cache:"no-store"});
assert.equal(downloaded.status,200,"MinIO signed GET must retrieve actual privately stored bytes");
const received=Buffer.from(await downloaded.arrayBuffer());
assert.equal(createHash("sha256").update(received).digest("hex"),
  createHash("sha256").update(bytes).digest("hex"),"stored object must exactly match scanned bytes");

const anonymous=await fetch(unsigned,{cache:"no-store"});
assert.ok([403,404].includes(anonymous.status),"bucket must remain private even when key exists");

const expired=signedDocumentObjectUrl(key,"GET",config,{now:new Date("2025-01-01T00:00:00Z"),expirySeconds:60});
const late=await fetch(expired,{cache:"no-store"});
assert.ok([400,403].includes(late.status),"expired signed URL must be refused");

const tampered=new URL(signed);
tampered.searchParams.set("X-Amz-Expires","300");
const mutation=await fetch(tampered,{cache:"no-store"});
assert.ok([400,403].includes(mutation.status),"tampered signature lifetime must be refused");

await assert.rejects(()=>putDocumentObject(key,Buffer.from("%PDF-other"),mime,{config}),
  /Private document upload failed/,"conditional PUT cannot overwrite prior scanned bytes");
await deleteDocumentObject(key,{config});
const after=await fetch(signed,{cache:"no-store"});
assert.equal(after.status,404,"deleted disposable object must not remain available");
console.log("PASS synthetic private vault storage: signed GET, byte hash, private bucket, expiry, signature tampering, immutable PUT, delete; deterministic scanner clean/infected/outage");
}

main().catch(() => {
  console.error("Synthetic private vault acceptance failed; no production service was used.");
  process.exitCode = 1;
});
