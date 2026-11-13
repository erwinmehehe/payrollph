/**
 * Uncredited Form 2316 hydrated-browser + API + unsigned-PDF evidence.
 * No app/DB module may be imported before the disposable environment gate.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gitBlobSha, requireDisposable2316Env, verify2316Sources } from "./tenant-2316-ssr-transfer-contract.mjs";

// Literal localhost allows Chromium to retain production-style __Host- Secure cookies
// over an isolated HTTP test server. The environment gate still pins 127.0.0.1.
export const ORIGIN = "http://localhost:3000";
export const PAGE = "/workspace/2316";
export const API = "/api/year-end/2316-certificate";
export const CURRENT_SOURCE = Object.freeze({
  "src/app/api/year-end/2316-certificate/route.ts": "b33979302d7e9db18ba49a1bb7b4c8d7e5e09194",
  "src/components/workspace/certificate-2316-review.tsx": "8e384c18e4db3e5520c936343b1ede56a2bbfd4c",
  "src/lib/bir-2316-certificate-server.ts": "34c7be32a808b9a6835ef54e40c7a9fabc695e16",
  "src/lib/bir-2316-withholding-server.ts": "35219040fe695c461d028ecf06e4590eaa95b12f",
  "src/lib/bir-2316-withholding.ts": "e0246aad900d7dc95c49f4247a8d5f6ab1caf8dd",
  "src/lib/bir-2316-certificate.ts": "2ab2a208c9717e049566b84ab161d887b6e80900",
  "src/lib/bir-2316-source-digest.ts": "9b034acf173e894af4960bec326138f7c4127c90",
  "src/lib/bir-2316-pdf.ts": "8bd3bb593fd713ecab11c3cc5058a2dac654f1aa",
});

export function requireDisposableBrowserPdf(env = process.env) {
  requireDisposable2316Env(env);
  assert.equal(env.TENANT_2316_BROWSER_PDF_PROOF, "fictional-pg16-only",
    "2316 browser/PDF runner is restricted to the dedicated fictional PG16 job");
  assert.equal(env.NEXT_TELEMETRY_DISABLED, "1",
    "2316 browser/PDF runner requires NEXT_TELEMETRY_DISABLED=1");
  for (const key of [
    "DATABASE_URL_REPLICA", "NEON_DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "STRIPE_SECRET_KEY",
    "WORKER_TOKEN", "OPENAI_API_KEY", "PII_ENCRYPTION_KEY_PREVIOUS",
  ]) assert.ok(!env[key], "2316 browser/PDF runner refuses external credential " + key);
  return true;
}

export function verifyBrowserPdfSources() {
  verify2316Sources();
  for (const [path, expected] of Object.entries(CURRENT_SOURCE)) {
    assert.equal(gitBlobSha(readFileSync(path)), expected,
      "Form 2316 browser/PDF source changed: renew exact-source proof for " + path);
  }
  const api = readFileSync("src/app/api/year-end/2316-certificate/route.ts", "utf8");
  const component = readFileSync("src/components/workspace/certificate-2316-review.tsx", "utf8");
  const gate = api.indexOf("await assertOrganizationRole(");
  const entity = api.indexOf("await resolveMultiEntityContext(");
  const frozen = api.indexOf("frozenFinalPayLegalEntityId(frozen.snapshot)");
  const loaded = api.indexOf("await load2316CertificateSource(scope)");
  const lastGuard = api.indexOf("assertEntityResource(entityScope.context, source.legalEntityId)");
  const digest = api.indexOf("input.sourceDigest !== sourceDigest");
  const pdf = api.indexOf("await render2316CertificatePdf(source, review)");
  assert.ok(gate > 0 && entity > gate && frozen > entity &&
    loaded > frozen && lastGuard > loaded && digest > lastGuard && pdf > digest,
    "2316 API must authorize employer, recheck frozen/source entity and digest before PDF");
  for (const required of [
    'fetch(url(), { cache: "no-store" })',
    'fetch(url(), { method: "POST"',
    'Download unsigned PDF',
    'URL.createObjectURL(await response.blob())',
    'acknowledged: ack',
  ]) {
    assert.ok(component.includes(required),
      "Actual hydrated load, review, and download controls required: " + required);
  }
  assert.match(component, /sourceDigest, review: \{/);
  assert.match(component, /<form onSubmit=\{generate\}>/);
  assert.match(component, /<fieldset disabled=\{busy\}>/);
  const m = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json","utf8"));
  const page = m.scopedPages.find(x => x.path === "src/app/workspace/2316/page.tsx");
  assert.equal(page?.status,"GAP");
  assert.equal(page?.reviewedUncertified?.pageActionCredits,0);
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  return true;
}

export function certificateUrl(actor, worker = actor.worker, separation = actor.separation) {
  assert.ok(Number.isSafeInteger(actor.org.id) && actor.org.id > 0);
  return "?organizationId=" + actor.org.id + "&employeeId=" + worker.id +
    "&taxYear=2026&separationId=" + separation.id;
}

export function assertDeniedResult(result, subjects, label) {
  assert.ok([403, 404].includes(result.status),
    label + ": expected hard authorization refusal, got " + result.status);
  const text = decodeUnicode(result.text);
  assert.ok(!text.includes("Prepare an unsigned Form 2316") &&
    !text.includes("data-organization-id="),
    label + ": private 2316 shell exposed");
  assertNoProtectedMarkers(text, subjects, label);
}

export function decodeUnicode(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, hex) => String.fromCharCode(Number.parseInt(hex,16)));
}

export function assertNoProtectedMarkers(text, subjects, label) {
  const decoded = decodeUnicode(text);
  for (const subject of subjects) {
    for (const marker of [
      subject.org?.name, subject.worker?.employeeNo, subject.entity?.legalName,
      subject.marker,
    ]) if (marker) assert.ok(!decoded.includes(marker),
      label + ": protected fictional marker exposed");
  }
}

export async function assertUnsignedPdf(bytes, expectedEmployer) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.byteLength > 10000,
    "Real nonempty unsigned PDF required, not an error JSON or fixture stub");
  assert.equal(bytes.subarray(0,5).toString("latin1"), "%PDF-");
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1,"Use only the unchanged September 2021 BIR page");
  assert.equal(pdf.getPage(0).getWidth(),612);
  assert.equal(pdf.getPage(0).getHeight(),936);
  assert.equal(pdf.getForm().getFields().length,0,"Never create signature form fields");
  assert.match(pdf.getTitle() ?? "", /Unsigned BIR Form 2316/);
  let operations = "";
  const streams = pdf.getPage(0).node.Contents();
  assert.ok(streams && "size" in streams);
  for (let i=0;i<streams.size();i++) {
    const stream=pdf.context.lookup(streams.get(i));
    if (stream instanceof PDFRawStream)
      operations += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  }
  const containsPainted = value => operations.toUpperCase().includes(
    Buffer.from(value,"latin1").toString("hex").toUpperCase());
  for (const expected of [
    expectedEmployer, "10,000.00", "DRAFT - UNSIGNED",
    "PREPARER PREVIEW - REVIEW AND SIGNATURES REQUIRED - NOT FOR FILING",
  ]) assert.ok(containsPainted(expected),
    "Actual generated PDF must paint source-specific data or unsigned warning: " + expected);
  assert.ok(!containsPainted("SIGNED AND FILED"));
  return { pages:pdf.getPageCount(),unsigned:true,hasMappedNonzeroCompensation:true };
}
