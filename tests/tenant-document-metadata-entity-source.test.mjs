import {assertLiveTenantCounts} from "./helpers/tenant-counts.mjs";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const staff = readFileSync("src/app/api/documents/route.ts","utf8");
const hcm = readFileSync("src/app/api/hcm/documents/route.ts","utf8");
const proxy = readFileSync("src/proxy.ts","utf8");
const hcmHold = readFileSync("src/lib/multi-entity-hcm-hold.ts","utf8");
const runner = readFileSync("scripts/qa/tenant-document-metadata-entity-http.mjs","utf8");
const workflow = readFileSync(".github/workflows/tenant-document-metadata-entity-http.yml","utf8");
const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
test("document GET filters staff to chosen persisted employer before returning names or document metadata",()=>{
 const index = text=>staff.indexOf(text);
 const role=index('const access = await getAccess(user.id, organizationId)');
 const scope=index("const entityScope = await resolveMultiEntityContext({");
 const selection=index("selectedLegalEntityId = entityScope.context.legalEntityId");
 const fetchStaff=index("const staff = await db.select({");
 const legalFilter=index("eq(employees.legalEntityId, selectedLegalEntityId)");
 const visible=index("const visibleDocuments = access.companyWide && selectedLegalEntityId == null");
 assert.ok(role>=0&&scope>role&&selection>scope&&fetchStaff>selection&&legalFilter>fetchStaff&&visible>legalFilter);
 for (const part of [
   "if (!entityScope.ok) return entityScope.response",
   "entityScope.context.group || entityScope.context.legalEntityId == null",
   "rows.filter((row) => row.employeeId != null && visibleEmployeeIds.has(row.employeeId))",
   '"Cache-Control": "private, no-store"',
 ]) assert.ok(staff.includes(part),"Lost secure document metadata list invariant "+part);
});
test("HCM GET refuses all un-attributed policies and documents before loading parent tables",()=>{
 const get=hcm.slice(hcm.indexOf("export async function GET("),hcm.indexOf("export async function POST("));
 const scope=get.indexOf("const entityScope = await resolveMultiEntityContext({");
 const noData=get.indexOf('code: "HCM_DOCUMENT_LEGAL_EMPLOYER_SCOPE_PENDING"');
 const parentLoad=get.indexOf("const [policies, assignments, requirements, compliance, staff, units, profiles, documentRows]");
 assert.ok(scope>=0&&noData>scope&&parentLoad>noData,"HCM GET must refuse BEFORE all parent-company policy/document reads");
 assert.ok(get.includes('if (criticalReleaseFlagEnabled("multiEntity"))'));
 assert.ok(get.includes("status: 503"));
 assert.ok(get.includes('"Cache-Control": "private, no-store"'));
});
test("HCM proxy embargo is authoritative for document GET/POST before route-level 503",()=>{
 assert.ok(proxy.includes("multiEntityHcmRequestDeferred(path, request.method)"));
 assert.ok(proxy.includes('code: "ENTITY_HCM_DEFERRED"'));
 assert.ok(proxy.includes("status: 403"));
 assert.ok(hcmHold.includes('pathname === "/api/hcm/salary-corrections/preview"'));
 assert.ok(!hcmHold.includes('pathname === "/api/hcm/documents"'));
 assert.ok(hcmHold.includes("return !isolatedSalaryPreviewProof"));
});
test("document and HCM POST refuse un-attributed legal-employer mutations before parsing or writing",()=>{
 const raw=staff.slice(staff.indexOf("export async function POST("));
 const admin=hcm.slice(hcm.indexOf("export async function POST("));
 const uploadGuard=raw.indexOf('if (criticalReleaseFlagEnabled("multiEntity"))');
 const uploadDenial=raw.indexOf('code: "DOCUMENT_UPLOAD_ENTITY_SCOPE_PENDING"');
 const formParsing=raw.indexOf("await request.formData()");
 assert.ok(uploadGuard>=0&&uploadDenial>uploadGuard&&formParsing>uploadDenial,
   "Un-attributed document uploads must be refused before multipart read and storage/SQL");
 const hcmGuard=admin.indexOf('if (criticalReleaseFlagEnabled("multiEntity"))');
 const hcmDenial=admin.indexOf('code: "HCM_DOCUMENT_MUTATION_ENTITY_SCOPE_PENDING"');
 const jsonParsing=admin.indexOf("await request.json()");
 assert.ok(hcmGuard>=0&&hcmDenial>hcmGuard&&jsonParsing>hcmDenial,
   "Un-attributed HCM policy mutation must be denied before actor-selected body/data/SQL reads");
 assert.ok(raw.includes('"Cache-Control": "private, no-store"'));
 assert.ok(admin.includes('"Cache-Control": "private, no-store"'));
});
test("all four changed route methods have zero current security proof credit",()=>{
 assertLiveTenantCounts(assert,manifest);
 for(const path of ["src/app/api/documents/route.ts","src/app/api/hcm/documents/route.ts"]){
   const row=manifest.allApiRouteFiles[path];
   assert.deepEqual(row.methods.map(m=>m.name),["GET","POST"]);
   assert.ok(row.methods.every(m=>m.status==="GAP"&&m.testedBy===null&&
     m.reviewedUncertified?.coverageCredits===0&&m.reviewedUncertified?.exactHeadPg16Http==="PENDING"));
 }
 assert.ok(manifest.acceptanceStatus.startsWith("NOT ACCEPTED: "+manifest.metrics.gap+" API methods"));
});
test("exact-head proof requires real own documents and same-parent/forged/revoked denial",()=>{
 for(const required of [
   "GITHUB_ACTIONS", "NEON_DATABASE_URL","NODE_ENV",
   'MULTI_ENTITY_ENABLED:"true"','EMPLOYEE_DOCUMENT_VAULT_ENABLED:"true"',
   "const ownA=await save(", "const ownB=await save(", "const ownVictim=await save(",
   "const sameParentForeign=await save(", "const unassigned=await save(",
   "realForeignSelectorDenials:blocked","hcmProxyEmbargoGet403:true",
   '"B attempts victim parent",list(victim),b.cookie',
   '"B query selects victim legal employer",list(b)',
   '"B header selects victim legal employer",list(b)',
   'for (const attacker of [a,b])', 'post(endpoint,attacker.cookie)',
   "revokedGrantDenied:true","deniedSqlUnchanged:true",
   "uploadMutation503:true","hcmProxyEmbargoPost403:true",
   "methodCredits:0","productionAccepted:false",
 ]) assert.ok(runner.includes(required),"missing synthetic proof boundary: "+required);
 assert.ok(workflow.includes("image: postgres:16"));
 assert.ok(workflow.includes("persist-credentials: false"));
 assert.ok(workflow.includes("node --import tsx scripts/qa/tenant-document-metadata-entity-http.mjs"));
 assert.ok(!workflow.includes("secrets."));
});
