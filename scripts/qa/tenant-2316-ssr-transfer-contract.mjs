/**
 * Form 2316 selected-worker SSR proof contract.
 * This is a new, uncredited synthetic-PG16 proof; historical receipts are immutable.
 * No application/database import may happen before the environment and source checks.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { verifySixPageCredits, selectedTargets } from "./tenant-six-scoped-page-credit.mjs";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/workspace/2316";
export const SOURCE_PINS = Object.freeze({
  "src/app/workspace/2316/page.tsx": "f4badb3f1782812aab672665340e967911cff2cb",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
  "src/lib/bir-2316-employer.ts": "ffe0a3d3b9be43be9befd4e1607d942249eaf7e3",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from("blob " + value.length + "\0"))
    .update(value).digest("hex");
}

export function requireDisposable2316Env(env = process.env) {
  const required = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_2316_SSR_TRANSFER_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN,
    SECURITY_SMOKE_URL: ORIGIN, DEMO_MODE: "false",
    REQUIRE_PRIVILEGED_MFA: "true",
    BIR_2316_CERTIFICATE_DRAFT_ENABLED: "true",
    BIR_2316_RECONCILIATION_ENABLED: "true",
    BIR_2316_WITHHOLDING_EVIDENCE_ENABLED: "true",
    YEAR_END_PRIOR_EVIDENCE_ENABLED: "true",
    MULTI_ENTITY_ENABLED: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  };
  for (const [key, expected] of Object.entries(required)) {
    assert.equal(env[key], expected, "TENANT_2316_REFUSED: unsafe " + key);
  }
  for (const key of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "XENDIT_CALLBACK_TOKEN", "STRIPE_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
    "CRON_SECRET", "WORKER_TOKEN", "OPENAI_API_KEY",
  ]) {
    assert.ok(!env[key], "TENANT_2316_REFUSED: provider/worker secret " + key);
  }
  return true;
}

export function verify2316Sources() {
  for (const [path, sha] of Object.entries(SOURCE_PINS)) {
    assert.equal(gitBlobSha(readFileSync(path)), sha,
      "TENANT_2316_REFUSED: unreviewed source drift " + path);
  }
  const source = readFileSync("src/app/workspace/2316/page.tsx", "utf8");
  const role = source.indexOf("await assertOrganizationRole(");
  const entity = source.indexOf("await resolveMultiEntityContext(");
  const worker = source.indexOf("const [worker] = await db.select(");
  const currentGuard = source.indexOf("assertEntityResource(entityScope.context, worker.legalEntityId)");
  const separation = source.indexOf("const [separation] = await db.select(");
  const historicalGuard = source.indexOf("frozenFinalPayLegalEntityId(separation.snapshot)");
  const mount = source.indexOf("<Certificate2316Review");
  assert.ok(role >= 0 && entity > role && worker > entity &&
    currentGuard > worker && separation > currentGuard &&
    historicalGuard > separation && mount > historicalGuard,
    "TENANT_2316_REFUSED: current and frozen employer gates must precede private UI");
  const manifest = JSON.parse(readFileSync(
    "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
  const entry = manifest.scopedPages.find(item =>
    item.path === "src/app/workspace/2316/page.tsx");
  assert.equal(entry?.blob, SOURCE_PINS["src/app/workspace/2316/page.tsx"]);
  // Do not weaken the original GAP refusal. A COVERED candidate must have
  // the stricter six-page evidence ledger and current source, never a
  // synthetic-only proof whose status was hand-edited.
  if (entry?.status === "GAP") {
    assert.equal(entry.testedBy, undefined, "No receipt for a historical GAP");
  } else {
    assert.equal(entry?.status, "COVERED", "No unreviewed classification");
    assert.equal(verifySixPageCredits(manifest), selectedTargets().length,
      "Certificate credit requires the complete source-pinned six-page ledger");
    assert.equal(entry.testedBy?.file, "scripts/qa/tenant-2316-ssr-transfer-http.mjs");
    assert.equal(entry.testedBy?.sourcePageBlobSha, SOURCE_PINS["src/app/workspace/2316/page.tsx"]);
    assert.equal(entry.testedBy?.evidenceLabel, "SOLO_VERIFIED_DEV_RECOVERY");
    assert.equal(entry.testedBy?.independentlyAccepted, false);
    assert.equal(entry.testedBy?.productionCertified, false);
  }
  assert.equal(entry?.reviewedUncertified?.pageActionCredits, 0);
  assert.match(manifest.acceptanceStatus, /NOT ACCEPTED/);
  return true;
}

export function noForeignMarkers(text, subjects, label) {
  for (const subject of subjects) {
    for (const marker of [subject.org.name, subject.worker.employeeNo, subject.marker]) {
      if (marker) assert.ok(!text.includes(marker),
        label + ": leaked protected employer/worker marker");
    }
  }
}

export function assertOwn2316(result, actor, subjects, mode) {
  assert.equal(result.status, 200, mode + ": actual owned 2316 SSR must return 200");
  assert.match(result.headers.get("content-type") ?? "", /text\/html/);
  if (mode === "released") {
    assert.ok(result.text.includes("Prepare an unsigned Form 2316"),
      "Released historic source must mount the nonempty 2316 review");
    assert.ok(result.text.includes('data-organization-id="' + actor.org.id + '"'),
      "SSR must bind the actual authenticated employer");
    assert.ok(result.text.includes('value="' + actor.worker.id + '"'),
      "SSR must reflect the persisted authorized worker");
  } else {
    assert.ok(result.text.includes("Select a released final-pay separation"),
      "Worker-only multi-entity guidance must not pretend to be a certificate");
    assert.ok(!result.text.includes("Prepare an unsigned Form 2316"),
      "Worker-only guidance must not mount the private tax client");
    assert.ok(!result.text.includes('data-organization-id="'),
      "Worker-only guidance must not mount a private employer context");
  }
  noForeignMarkers(result.text, subjects.filter(s => s.org.id !== actor.org.id),
    "owned " + mode);
}

export function assertDenied2316(result, subjects, label) {
  assert.equal(result.status, 404, label + ": hard 404 required");
  assert.ok(!result.text.includes("Prepare an unsigned Form 2316"),
    label + ": private tax review mounted on a denied request");
  assert.ok(!result.text.includes('data-organization-id="'),
    label + ": unauthorized employer context mounted");
  noForeignMarkers(result.text, subjects, label);
}
