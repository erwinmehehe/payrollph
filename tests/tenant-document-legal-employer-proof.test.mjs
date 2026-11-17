import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const script=readFileSync("scripts/qa/tenant-document-legal-employer-http.mjs","utf8");
const flow=readFileSync(".github/workflows/tenant-document-legal-employer-http.yml","utf8");
test("real document employer proof is disposable and source-bound",()=>{
  for(const s of [
    'GITHUB_ACTIONS:"true"', 'NODE_ENV:"production"',
    'TENANT_DOCUMENT_ENTITY_PROOF:"disposable-pg16-real-http"',
    'DATABASE_URL:"postgresql://postgres:postgres@127.0.0.1:5432/app_db"',
    'MULTI_ENTITY_ENABLED:"true"', 'EMPLOYEE_DOCUMENT_VAULT_ENABLED:"true"',
    'S3_ACCESS_KEY_ID', 'PAYMONGO_SECRET_KEY', 'OPENAI_API_KEY',
    'assert.equal(sha(readFileSync(file)),pin',
  ]) assert.ok(script.includes(s),"Missing disposable-only runtime guard: "+s);
  assert.ok(flow.includes("image: postgres:16"));
  assert.ok(flow.includes("node --import tsx scripts/qa/tenant-document-legal-employer-http.mjs"));
  assert.ok(flow.includes("npm run db:push"));
  assert.ok(flow.includes("persist-credentials: false"));
  assert.ok(!flow.includes("secrets."));
});
test("requires nonempty own bytes plus real higher-ID foreign legal employer denial",()=>{
  for(const s of [
    'const foreign=await makeDocument(', 'const ownA=await makeDocument(',
    'const ownB=await makeDocument(', 'const ownC=await makeDocument(',
    'assert.ok(ownC.row.id>ownA.row.id',
    'assert.ok(foreign.row.id>ownA.row.id)',
    'assert.deepEqual(res.bytes,doc.data',
    'same parent, other legal employer',
    'forged employer query','forged employer header',
    'conflicting employer selectors','duplicated employer selectors',
    'unattributed parent document','foreign parent employer',
    'const [deleted]=await db.delete(s.userLegalEntityGrants)',
    'opaque404(deniedAfterRevoke,absent',
    'assert.deepEqual(await snapshot(),before',
    'status:"GAP"', 'methodCredits:0',
  ]) assert.ok(script.includes(s),"Missing real-HTTP positive/denial anchor: "+s);
});
