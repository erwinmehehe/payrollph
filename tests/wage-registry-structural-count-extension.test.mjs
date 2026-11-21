import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {blob} from "../scripts/qa/wage-registry-renewal-verify.mjs";
import {verifiedStructuralCountExtension,wageRenewalV2Drift} from "../scripts/qa/wage-registry-renewal-v2.mjs";

const path="tests/tenant-structural-access-guard.test.mjs";
const oldHash="e42853ebcee59615bf1e3ca4cd2bc412a80532ee";
const newHash="339a414ef48cbdf7101a236e548eaa603091be2c";
const source=readFileSync(path,"utf8");
const original=source
 .replace('test("all 499 handlers reaching PostgreSQL','test("all 498 handlers reaching PostgreSQL')
 .replace('assert.equal(methods, 499,','assert.equal(methods, 498,');

test("a 499-method inventory extends the original pinned guard at EXACTLY two count-only sites",()=>{
 assert.equal(blob(Buffer.from(original)),oldHash,"The prior test must reconstruct byte-for-byte");
 assert.equal(blob(Buffer.from(source)),newHash,"The current test must equal its reviewed full-file hash");
 assert.equal(source.split('test("all 499 handlers reaching PostgreSQL').length,2);
 assert.equal(source.split("assert.equal(methods, 499,").length,2);
 assert.equal(verifiedStructuralCountExtension(path,oldHash,Buffer.from(source)),true);
});
test("changed guards, changed counts, new imports and unknown hashes remain forbidden",()=>{
 const altered=[
  source.replace('assert.equal(methods, 499,','assert.equal(methods, 500,'),
  source.replace('assert.equal(hitsDb,','assert.ok(hitsDb>=0); assert.equal(hitsDb,'),
  source.replace('test("all 499 handlers reaching PostgreSQL','test("all 500 handlers reaching PostgreSQL'),
  source.replace('const acceptable = new Set(', 'const acceptable = new Set(["UNREVIEWED", ...'),
  source+"\n// third changed line",
 ];
 for(const s of altered)assert.equal(verifiedStructuralCountExtension(path,oldHash,Buffer.from(s)),false);
 assert.equal(verifiedStructuralCountExtension(path,"0".repeat(40),Buffer.from(source)),false);
 assert.equal(verifiedStructuralCountExtension("src/app/api/contractors/ewt-quarter/route.ts",oldHash,Buffer.from(source)),false);
 assert.equal(verifiedStructuralCountExtension(path,oldHash,Buffer.from(original)),false);
});
test("the immutable receipt accepts only this test-count extension, not altered proof sources",()=>{
 const receipt={globalPins:{},methodPins:{"GET reviewed-method":{[path]:oldHash}}};
 assert.deepEqual(wageRenewalV2Drift(receipt,"GET reviewed-method",()=>Buffer.from(source)),[]);
 assert.deepEqual(wageRenewalV2Drift(receipt,"GET reviewed-method",()=>Buffer.from(source.replace("assert.equal(methods, 499,","assert.equal(methods, 500,"))),[path]);
 const wrong={globalPins:{},methodPins:{"GET reviewed-method":{[path]:"0".repeat(40)}}};
 assert.deepEqual(wageRenewalV2Drift(wrong,"GET reviewed-method",()=>Buffer.from(source)),[path]);
});
