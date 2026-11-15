/**
 * Public Careers page classification. The page is a published-only anonymous
 * destination, not a private tenant-grant API. This never certifies production,
 * employment/application privacy review, or a successful CI run.
 *
 * Historical page GAP and reviewed-unaccepted evidence are preserved exactly;
 * older private-page proof ratchets validate a reconstructed historical view.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const CAREERS_PAGE = "src/app/careers/page.tsx";
export const PAGE_SHA = "8e56412c909b7d70a5c33a21d3df52a79a693d4f";
export const ORIGINAL_GAP_REASON = "Still GAP: public Careers is deliberately anonymous and publication-only, not a private tenant grant. The SSR employer selector now rejects duplicate, coerced and noncanonical IDs before schema/SQL. A dedicated real localhost PG16 three-employer positive/negative proof is attached but unaccepted pending exact-head passing CI and independent security/privacy review. No page/action or API method coverage credits.";
export const ORIGINAL_REVIEW = {
  "kind": "public-careers-SSR-GET-PG16-canonical-selector-unaccepted",
  "originalPageBlobSha": "06cfcd7cd0d0458b4a9d8e9e61e03129396541e3",
  "pageBlobSha": "8e56412c909b7d70a5c33a21d3df52a79a693d4f",
  "proofFile": "scripts/qa/tenant-careers-page-public-boundary-http.mjs",
  "proofBlobSha": "6efef6eb6965d1deba1fe8d64446936a09553813",
  "workflowFile": ".github/workflows/tenant-edg01-careers-public-get-http.yml",
  "workflowBlobSha": "c9f89477a1e013d3ae4c7c50b1d737df1d257269",
  "pageActionCredits": 0,
  "methodCredits": 0,
  "independentlyAccepted": false,
  "productionCertified": false
};
export const PUBLIC_NOTE = " Public Careers page is classified PUBLIC-BY-DESIGN from the previously owner-approved recruiting boundary, not private COVERED. Exactly 20/21 pages remain provisionally COVERED and one public; zero page GAP labels, no added private credits, independent privacy/security acceptance and launch review PENDING.";
export const CLASSIFIED_REASON = "PUBLIC-BY-DESIGN (owner-approved recruiting boundary): anonymous Careers SSR accepts only a canonical explicit positive employer ID, then projects employer name and explicitly published requisitions (open/interviewing) linked to a same-employer open position with the five approved public job fields. Exact-source fictional PG16 HTTP proof must pass on this PR head. No private tenant entitlement, applicant/employee/payroll reads, new API method credit, production activation, or independent security/privacy acceptance.";
export const PUBLIC_BOUNDARY = Object.freeze({
  "kind": "public-careers-ssr-owner-approved-recruiting",
  "ownerApprovalDate": "2026-11-09",
  "ownerApprovedMethod": "GET /api/careers",
  "sourcePageBlobSha": "8e56412c909b7d70a5c33a21d3df52a79a693d4f",
  "proofFile": "scripts/qa/tenant-careers-page-public-boundary-http.mjs",
  "proofBlobSha": "6efef6eb6965d1deba1fe8d64446936a09553813",
  "workflowFile": ".github/workflows/tenant-edg01-careers-public-get-http.yml",
  "workflowBlobSha": "c9f89477a1e013d3ae4c7c50b1d737df1d257269",
  "predicateFile": "src/lib/careers-privacy-gates.ts",
  "predicateBlobSha": "f878db55d51c4f8a0a6ab4893ef8af5e80f4dff6",
  "clientFile": "src/components/careers-board.tsx",
  "clientBlobSha": "17abb6d811886a18891900a113f7b616f4c8b7d2",
  "publicJobFields": [
    "id",
    "title",
    "department",
    "description",
    "employmentType"
  ],
  "classificationOnly": true,
  "currentHeadProof": "EXACT_HEAD_PG16_REQUIRED",
  "privateCoverageCredits": 0,
  "apiMethodCredits": 0,
  "independentlyAccepted": false,
  "productionCertified": false
});

function blob(read, path) {
  const bytes = read(path);
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
function pageOf(manifest) {
  assert.equal(manifest.scopedPages.length, 21);
  const rows = manifest.scopedPages.filter(p => p.path === CAREERS_PAGE);
  assert.equal(rows.length, 1, "CAREERS_PUBLIC_REFUSED: expected one public Careers page");
  return rows[0];
}
export function publicCareersPage(original) {
  assert.equal(original.status, "GAP", "CAREERS_PUBLIC_REFUSED: exact historical GAP required");
  assert.equal(original.blob, PAGE_SHA);
  assert.equal(original.reason, ORIGINAL_GAP_REASON);
  assert.deepEqual(original.reviewedUncertified, ORIGINAL_REVIEW);
  assert.ok(!Object.hasOwn(original, "testedBy"), "Unaccepted private credit cannot be reused");
  return {
    ...structuredClone(original), status:"PUBLIC-BY-DESIGN",
    reason:CLASSIFIED_REASON, publicBoundary:structuredClone(PUBLIC_BOUNDARY),
  };
}
function checkApprovedGet(manifest) {
  const methods = manifest.allApiRouteFiles["src/app/api/careers/route.ts"]?.methods;
  assert.ok(Array.isArray(methods));
  for (const name of ["GET","POST"]) {
    const method=methods.find(x=>x.name===name);
    assert.equal(method?.status, "PUBLIC-BY-DESIGN", name + " remains publicly approved, not a private credit");
    assert.equal(method?.publicBoundary?.approvedOn, "2026-11-09");
    assert.equal(method?.publicBoundary?.fourPartMethodCredit, false);
    assert.equal(method?.testedBy, null);
  }
  const get=methods.find(x=>x.name==="GET");
  assert.deepEqual(get.publicBoundary.exposedFields,
    ["organization","jobs[].id","jobs[].title","jobs[].department","jobs[].description","jobs[].employmentType"]);
}
export function verifyCareersPublicPage(manifest, read=readFileSync) {
  const current=pageOf(manifest);
  assert.equal(current.status, "PUBLIC-BY-DESIGN",
    "CAREERS_PUBLIC_REFUSED: cannot mislabel anonymous page as private COVERED");
  const original=structuredClone(current);
  delete original.publicBoundary;
  original.status="GAP";
  original.reason=ORIGINAL_GAP_REASON;
  assert.deepEqual(current, publicCareersPage(original),
    "CAREERS_PUBLIC_REFUSED: only exact source-pinned public classification is allowed");
  assert.equal(blob(read,CAREERS_PAGE),PAGE_SHA,"CAREERS_PUBLIC_REFUSED: source page changed");
  assert.equal(blob(read,PUBLIC_BOUNDARY.proofFile),PUBLIC_BOUNDARY.proofBlobSha,
    "CAREERS_PUBLIC_REFUSED: real-HTTP fixture proof changed");
  assert.equal(blob(read,PUBLIC_BOUNDARY.workflowFile),PUBLIC_BOUNDARY.workflowBlobSha,
    "CAREERS_PUBLIC_REFUSED: PG16 workflow changed");
  assert.equal(blob(read,PUBLIC_BOUNDARY.predicateFile),PUBLIC_BOUNDARY.predicateBlobSha,
    "CAREERS_PUBLIC_REFUSED: published-only SQL predicate drifted");
  assert.equal(blob(read,PUBLIC_BOUNDARY.clientFile),PUBLIC_BOUNDARY.clientBlobSha,
    "CAREERS_PUBLIC_REFUSED: public React client fields/actions drifted");
  const predicate=String(read(PUBLIC_BOUNDARY.predicateFile));
  for (const marker of [
    "eq(jobRequisitions.organizationId, organizationId)",
    "careersPublishedSql} = true",
    "in ('open', 'interviewing')",
    "eligible_position.organization_id =",
    "eligible_position.status = 'open'",
  ]) assert.ok(predicate.includes(marker),"CAREERS_PUBLIC_REFUSED: missing private-boundary SQL predicate "+marker);
  const source=String(read(CAREERS_PAGE));
  const consent=source.indexOf("const notice = careersNoticeConfig();");
  const parse=source.indexOf('typeof raw !== "string"');
  const safe=source.indexOf("Number.isSafeInteger(organizationId)");
  const db=source.indexOf("await db.select(");
  const published=source.indexOf("publishedCareersPredicate(organizationId)");
  assert.ok(consent>=0 && parse>consent && safe>parse && db>safe && published>db);
  assert.doesNotMatch(source,/getSessionUser\(|db\.insert\(|db\.update\(|db\.delete\(/,
    "CAREERS_PUBLIC_REFUSED: public page cannot start a private session or mutation");
  checkApprovedGet(manifest);
  assert.equal(manifest.metrics.scopedPagesAndActions,21);
  assert.equal(manifest.scopedPages.filter(p=>p.status==="COVERED").length,20);
  assert.equal(manifest.scopedPages.filter(p=>p.status==="PUBLIC-BY-DESIGN").length,1);
  assert.equal(manifest.scopedPages.filter(p=>p.status==="GAP").length,0);
  assert.match(manifest.acceptanceStatus,
    new RegExp("^NOT ACCEPTED: " + manifest.metrics.gap + " API methods and 0 page/action GAPs remain"));
  assert.ok(manifest.acceptanceStatus.endsWith(PUBLIC_NOTE),
    "CAREERS_PUBLIC_REFUSED: public page acceptance note has drifted");
  return 1;
}
/**
 * A validation-only reconstruction for sealed historic five/six/four-page
 * proofs. Never persist this old GAP back into the current manifest.
 */
export function historicalCareersPageView(manifest, read=readFileSync) {
  const view=structuredClone(manifest);
  const page=pageOf(view);
  if(page.status==="GAP") {
    assert.equal(page.reason,ORIGINAL_GAP_REASON);
    assert.deepEqual(page.reviewedUncertified,ORIGINAL_REVIEW);
    return view;
  }
  verifyCareersPublicPage(manifest,read);
  page.status="GAP";
  page.reason=ORIGINAL_GAP_REASON;
  delete page.publicBoundary;
  assert.ok(view.acceptanceStatus.endsWith(PUBLIC_NOTE));
  view.acceptanceStatus=view.acceptanceStatus.slice(0, -PUBLIC_NOTE.length).replace(
    /^NOT ACCEPTED: (\d+) API methods and 0 page\/action GAPs remain/,
    "NOT ACCEPTED: $1 API methods and 1 page/action GAPs remain");
  return view;
}
