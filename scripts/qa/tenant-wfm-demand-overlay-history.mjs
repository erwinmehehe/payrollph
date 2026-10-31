/**
 * #1637 compatibility check for earlier, source-pinned WFM GET/POST/PATCH
 * evidence. The only accepted new source is the reviewed exact-byte GET
 * permission overlay. An altered write handler, unrelated route byte, test
 * fixture or manifest claim MUST fail, not inherit an old proof.
 *
 * No application imports, database access or payroll operations.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PREFIX = "src/app/api/workforce/";
const IMPORT_BEFORE = 'import { getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";';
const IMPORT_AFTER = 'import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES, WORKFORCE_MANAGER_ROLES } from "@/lib/access";';
const K = "wfm-demand-reads-workforce-permission-overlay-unaccepted";
const PROOF_FILES = Object.freeze({
  "scripts/qa/tenant-wfm-demand-read-overlay-http.mjs": "595539e672a3dc121f709b44ce045f432d7d9d92",
  "tests/tenant-wfm-demand-read-overlay.test.mjs": "d03d2814cc989a3743ac520827d45b6a2b43b396",
  ".github/workflows/tenant-wfm-demand-read-overlay-http.yml": "a7b23d7680e9a36a35d1d736e7a8bd2b9d01ccfc",
});

const SPEC = Object.freeze({
  [PREFIX + "demand-observations/issued/route.ts"]: {
    before: "d9e6ae99e687b691ca428e58c6c34ff077769a41",
    after: "d552c6db5a54b346d8fb940edb5f0ceaaeff04a0",
    statuses: { GET: "COVERED", POST: "GAP" },
    oldGet: [
      '  if (!issuedDemandPilotAllowed(organizationId)) {',
      '    return Response.json({ error: "Issued workload forecasting is not enabled for this employer." }, { status: 404 });',
      '  }',
      '  const access = await getAccess(user.id, organizationId);',
      '  if (!access || !WORKFORCE_MANAGER_ROLES.some(role => role === access.role)) {',
      '    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });',
      '  }',
    ].join("\n"),
    newGet: [
      '  // Authorize the active employer, session policy and deny-only custom',
      '  // workforce permission BEFORE disclosing any tenant pilot configuration.',
      '  const roleDenied = await assertOrganizationRole(',
      '    user.id, organizationId, WORKFORCE_MANAGER_ROLES,',
      '    "Workforce manager access is required.",',
      '  );',
      '  if (roleDenied) return roleDenied;',
      '  const access = await getAccess(user.id, organizationId);',
      '  if (!access) {',
      '    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });',
      '  }',
      '  if (!issuedDemandPilotAllowed(organizationId)) {',
      '    return Response.json({ error: "Issued workload forecasting is not enabled for this employer." }, { status: 404 });',
      '  }',
    ].join("\n"),
  },
  [PREFIX + "demand-staffing/policies/route.ts"]: {
    before: "513975b118713becbf98caffa7d813a5b8c33c71",
    after: "e0ea8e23ffad6ca72edd5ef8da4dbe3a332d041c",
    statuses: { GET: "GAP", POST: "COVERED", PATCH: "COVERED" },
    oldGet: [
      '  if(!staffingPolicyPilotAllowed(organizationId,issuedDemandPilotAllowed(organizationId))){',
      '    return Response.json({error:"Demand staffing policies unavailable for employer."},{status:404,headers});',
      '  }',
      '  const access=await getAccess(user.id,organizationId);',
      '  if(!access||!WORKFORCE_MANAGER_ROLES.some(role=>role===access.role)||',
      '    (mode==="manage"&&(!access.companyWide||',
      '       !PEOPLE_ADMIN_ROLES.some(role=>role===access.role)))) {',
      '    return Response.json({error:"Workforce policy review requires scoped manager access."},{status:403,headers});',
      '  }',
    ].join("\n"),
    newGet: [
      '  // Deny a revoked session or a custom workforce permission restriction',
      '  // before inspecting tenant pilot flags, sites, roles or policy evidence.',
      '  const roleDenied=await assertOrganizationRole(',
      '    user.id,organizationId,WORKFORCE_MANAGER_ROLES,',
      '    "Workforce policy review requires scoped manager access.");',
      '  if(roleDenied)return roleDenied;',
      '  const access=await getAccess(user.id,organizationId);',
      '  if(!access||(mode==="manage"&&(!access.companyWide||',
      '       !PEOPLE_ADMIN_ROLES.some(role=>role===access.role)))) {',
      '    return Response.json({error:"Workforce policy review requires scoped manager access."},{status:403,headers});',
      '  }',
      '  if(!staffingPolicyPilotAllowed(organizationId,issuedDemandPilotAllowed(organizationId))){',
      '    return Response.json({error:"Demand staffing policies unavailable for employer."},{status:404,headers});',
      '  }',
    ].join("\n"),
  },
});

function gitBlobSha(source) {
  const bytes = Buffer.from(source, "utf8");
  return createHash("sha1").update(Buffer.from("blob " + bytes.length + "\0"))
    .update(bytes).digest("hex");
}

/**
 * Return the OLD Git blob SHA only if the current source is identical to
 * that original OR an exact reviewed GET-only replacement on that original.
 * Every old proof continues to identify OLD source, never the patched GET.
 */
export function assertHistoricalDemandSourceCompatible(path, record,
  read = file => readFileSync(file, "utf8")) {
  const spec = SPEC[path];
  assert.ok(spec, "Unreviewed WFM demand route has no historical receipt compatibility");
  assert.equal(record?.gitBlobSha, gitBlobSha(read(path)),
    "Manifest must pin the exact current WFM demand route");
  if (record.gitBlobSha === spec.before) return spec.before;
  assert.equal(record.gitBlobSha, spec.after,
    "Changed WFM demand source requires new independent CI review");
  assert.deepEqual(record.methods.map(m => m.name), Object.keys(spec.statuses),
    "WFM demand methods changed; no old receipt may be reused");
  for (const method of record.methods) {
    assert.equal(method.status, spec.statuses[method.name],
      "WFM overlay cannot upgrade or downgrade any method credit");
    if (method.status === "GAP") assert.equal(method.testedBy, null);
    else assert.equal(method.testedBy?.routeBlobSha, spec.before,
      "Historical method proof must remain on the original route");
    const review = method.reviewedUncertified;
    assert.equal(review?.kind, K);
    assert.equal(review.previousRouteBlobSha, spec.before);
    assert.equal(review.routeBlobSha, spec.after);
    assert.equal(review.onlyReadHandlerChanged, true);
    assert.equal(review.changedMethod, "GET");
    assert.equal(review.statusBefore, method.status);
    assert.equal(review.methodCredits, 0);
    assert.equal(review.independentlyAccepted, false);
    assert.equal(review.productionCertified, false);
    assert.equal(review.runnerBlobSha, PROOF_FILES["scripts/qa/tenant-wfm-demand-read-overlay-http.mjs"]);
    assert.equal(review.contractBlobSha, PROOF_FILES["tests/tenant-wfm-demand-read-overlay.test.mjs"]);
    assert.equal(review.workflowBlobSha, PROOF_FILES[".github/workflows/tenant-wfm-demand-read-overlay-http.yml"]);
  }
  for (const [file, pinned] of Object.entries(PROOF_FILES)) {
    assert.equal(gitBlobSha(read(file)), pinned,
      "Reviewed WFM synthetic proof changed without renewed security review: " + file);
  }
  const source = read(path);
  assert.equal(source.split(IMPORT_AFTER).length, 2,
    "Reviewed GET permission import must occur exactly once");
  assert.equal(source.split(spec.newGet).length, 2,
    "Reviewed GET authorization block must occur exactly once");
  const reconstructed = source.replace(IMPORT_AFTER, IMPORT_BEFORE)
    .replace(spec.newGet, spec.oldGet);
  assert.equal(gitBlobSha(reconstructed), spec.before,
    "Old source must reconstruct exactly: POST/PATCH and unrelated bytes cannot change");
  return spec.before;
}
