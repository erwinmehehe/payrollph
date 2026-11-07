import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export const MIGRATION_INPUT_BLOBS = Object.freeze({"src/app/api/migrations/route.ts":"6f2aabfe906a2c38594ea8b20d17b27a90dafb95","scripts/qa/tenant-requested-migrations-http.mjs":"283c7471e64730ac3553c5a771bbd29d10b1019b","scripts/qa/migration-method-proof.mjs":"a97bb41eb9341680d28d8f208ca547a46217cbfa",".github/workflows/tenant-requested-migrations-http.yml":"cd9efcd94c4266b1ee91a59e22ac5fc29de98339","tests/tenant-requested-migrations-contract.test.mjs":"ac86f5a159a5a2886d7051e79b40c4b93fba0aa9","src/lib/migration-import.ts":"c191c454152489b66a78e79c1550544e0d1ea919","src/lib/hcm-migration-safety.ts":"c6a8cbc96ac7749dff230d43538ca639b7a39cbe","src/lib/access.ts":"08d3481dbd20279a4a8aef64f0932f79bec48444","src/lib/auth.ts":"b13275e0e09b629ddb679c55e7898da44c72ad20","src/db/schema.ts":"3f504163c9847a99434a5e01a72c120dfd680a02"});
export const MIGRATION_POST_RECEIPT = Object.freeze({"file":"scripts/qa/tenant-requested-migrations-http.mjs","line":55,"ownPositiveLine":55,"foreignDenialLine":60,"forgedSelectorLine":62,"unchangedDbLine":66,"victimIdOrderingLine":27,"twoAttackerLine":44,"scope":"Provisional four-kind (employees, payroll_history, leave_balances, loans) real HTTP/PG16 proof: two independent fictional owner employers, eight persisted owned commits and audit receipts, eight foreign-tenant 403 refusals, six forged real-victim worker-number 422 refusals, unchanged victim SQL/audit, preview and replay checks. XLSX-specific transport and forced audit rollback untested; no production or tenant-wide acceptance.","methodActions":["employees","payroll_history","leave_balances","loans"],"proofPullRequest":1805,"verifiedPrHeadSha":"480e6d621c91564f9645563b3417a10fb2ebd5a0","mergedProofCommit":"9ac4795efe8c013cd7a66ba73005dc481bde6626","workflowRunId":42316450787,"workflowJobId":128230104851,"evidence":"https://github.com/erwinmehehe/payrollph/actions/runs/42316450787/job/128230104851","routeBlobSha":"6f2aabfe906a2c38594ea8b20d17b27a90dafb95","proofBlobSha":"283c7471e64730ac3553c5a771bbd29d10b1019b","proofHelperBlobSha":"a97bb41eb9341680d28d8f208ca547a46217cbfa","contractBlobSha":"ac86f5a159a5a2886d7051e79b40c4b93fba0aa9","workflowBlobSha":"cd9efcd94c4266b1ee91a59e22ac5fc29de98339","postgresMajor":16,"ownCommits":8,"foreignDenials":8,"forgedDenials":6,"multipartPreviews":2,"providerCalls":0,"productionTested":false,"independentSecurityReview":"PENDING"});
const gitBlob = b => { const bytes = Buffer.isBuffer(b) ? b : Buffer.from(b); return createHash("sha1").update("blob "+bytes.length+"\\0").update(bytes).digest("hex"); };
export function verifyMigrationPostCredit(manifest, reader = readFileSync) {
  const path = "src/app/api/migrations/route.ts";
  const route = manifest.allApiRouteFiles[path];
  assert.equal(route?.gitBlobSha, MIGRATION_INPUT_BLOBS[path], "the credited route must match the proved source");
  const matches = route.methods.filter(m => m.name === "POST");
  assert.equal(matches.length,1);
  const method = matches[0];
  assert.equal(method.status,"COVERED");
  assert.equal(method.reviewedUncertified,undefined);
  assert.deepEqual(method.testedBy,MIGRATION_POST_RECEIPT,"borrowed or altered HTTP receipt");
  for (const [file,sha] of Object.entries(MIGRATION_INPUT_BLOBS)) {
    assert.equal(gitBlob(reader(file)),sha,"proof or runtime source drift: "+file);
  }
  const lines = reader("scripts/qa/tenant-requested-migrations-http.mjs").toString("utf8").split("\n");
  for (const [line,fragment] of [
    [27,"victim.worker.id>6"],[44,"for(const e of [a,b]){"],
    [55,"const own=await send(e,body);"],[60,"foreign.status,403"],
    [62,"migrationProofBody(e,kind,victim.worker.employeeNo)"],
    [66,"foreign/forged requests cannot write victim data"]
  ]) assert.ok(lines[line-1]?.includes(fragment),"lost four-part proof anchor at "+line);
  const text = lines.join("\n");
  for(const fragment of ["ownCommits:8","foreignDenials:8","forgedDenials:6",
    "assertMigrationCommit(before,after,e,kind)","credits:0","providerCalls:0",
    "assert.deepEqual(await snapshot(victim.org.id),victimBefore"])
    assert.ok(text.includes(fragment),"missing own/victim proof: "+fragment);
  const api = reader(path).toString("utf8");
  assert.ok(api.indexOf("const denied = await assertOrganizationRole(") <
    api.indexOf("await ensureCoreCompatibilitySchema()"),"auth before DB writer");
  const all = Object.values(manifest.allApiRouteFiles).flatMap(r=>r.methods);
  assert.equal(all.filter(x=>x.status==="COVERED").length,manifest.metrics.coveredAfter);
  assert.equal(all.filter(x=>x.status==="GAP").length,manifest.metrics.gap);
  assert.match(manifest.acceptanceStatus,/^NOT ACCEPTED:/);
  assert.equal(method.testedBy.independentSecurityReview,"PENDING");
  assert.equal(method.testedBy.productionTested,false);
  return 1;
}
