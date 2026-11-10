/**
 * Source-pinned candidate for prior-employer worker SSR. Zero coverage credits.
 * No DB/app imports; only fictional PG16 localhost may run the HTTP fixture.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const ORIGIN = "http://127.0.0.1:3000";
export const PAGE = "/workspace/prior-employer";
export const SOURCE_PINS = Object.freeze({
  "src/app/workspace/prior-employer/page.tsx": "e55809f26075c142240675826a0c353d403a20e6",
  "src/lib/tenant-prior-review-worker.ts": "3d5cf7b07b0970a9912e4ed6fcee31290449bc1e",
  "src/lib/multi-entity-server.ts": "f38a8bb77a5026d581d4a92b22533fc879ea7e00",
  "src/lib/multi-entity-policy.ts": "9aacd6cd3c7147d383608d162e89be7e822cc044",
  "src/lib/year-end-prior-evidence-server.ts": "c900ac326fc1836fd51602952ce966beeaf8c084",
  "scripts/qa/tenant-table-http.mjs": "31894982d768e34c1653be7c4335194f60233c6e",
});

export function gitBlobSha(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha1").update(Buffer.from("blob " + value.length + "\0"))
    .update(value).digest("hex");
}

export function requireDisposablePriorWorkerEnv(env = process.env) {
  for (const [key, expected] of Object.entries({
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    BUILD_BLOCK_ACCEPTANCE_MODE: "synthetic-postgres-only",
    TENANT_PRIOR_WORKER_PROOF: "fictional-pg16-only",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
    APP_BASE_URL: ORIGIN, TRUSTED_APP_ORIGINS: ORIGIN, SECURITY_SMOKE_URL: ORIGIN,
    YEAR_END_PRIOR_EVIDENCE_ENABLED: "true", MULTI_ENTITY_ENABLED: "true",
    DEMO_MODE: "false", REQUIRE_PRIVILEGED_MFA: "true",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false",
  })) assert.equal(env[key], expected, "PRIOR_WORKER_REFUSED: unsafe " + key);
  for (const name of [
    "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET", "XENDIT_SECRET_KEY",
    "XENDIT_PAYOUT_SECRET_KEY", "STRIPE_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "SMTP_URL", "SMTP_PASSWORD",
    "WORKER_TOKEN", "CRON_SECRET", "OPENAI_API_KEY",
  ]) assert.ok(!env[name], "PRIOR_WORKER_REFUSED: external credential " + name);
  return true;
}

export function verifyPriorWorkerSource() {
  for (const [path, sha] of Object.entries(SOURCE_PINS))
    assert.equal(gitBlobSha(readFileSync(path)), sha,
      "PRIOR_WORKER_REFUSED: source changed " + path);
  const page = readFileSync("src/app/workspace/prior-employer/page.tsx", "utf8");
  const role = page.indexOf("await assertOrganizationRole(");
  const access = page.indexOf("await getAccess(");
  const multi = page.indexOf("await resolveMultiEntityContext(");
  const parse = page.indexOf("canonicalPriorReviewWorkerId(employeeId)");
  const lookup = page.indexOf("const [worker] = await db.select");
  const bound = page.indexOf("assertEntityResource(entityScope.context, worker.legalEntityId)");
  const mount = page.indexOf("<YearEndPriorReview");
  assert.ok(role >= 0 && access > role && multi > access &&
    parse > multi && lookup > parse && bound > lookup && mount > bound,
  "PRIOR_WORKER_REFUSED: employer and worker boundary before private UI");
  for (const token of [
    "if (denied || !access?.companyWide) notFound()",
    "eq(employees.organizationId, organizationId)",
    "eq(employees.id, selectedWorkerId)",
    "if (selectedWorkerId === false) notFound()",
    "if (!entityScope.ok || (entityScope.context.enabled && entityScope.context.group)) notFound()",
    "assertEntityResource(entityScope.context, worker.legalEntityId)",
  ]) assert.ok(page.includes(token), "PRIOR_WORKER_REFUSED: missing " + token);
  assert.ok(!page.slice(lookup, mount).includes("catch"),
    "PRIOR_WORKER_REFUSED: SQL fault must not render private shell");
  const api = readFileSync("src/lib/year-end-prior-evidence-server.ts", "utf8");
  for (const token of [
    "eq(employees.id, scope.employeeId)",
    "eq(employees.organizationId, scope.organizationId)",
    "assertEntityResource(entityScope.context, employeeScope.legalEntityId)",
  ]) assert.ok(api.includes(token), "PRIOR_WORKER_REFUSED: API source drift");
  return true;
}

export function noForeignPriorMarkers(html, subjects, label) {
  for (const subject of subjects) {
    for (const marker of [subject.marker, subject.worker.employeeNo, subject.org.name]) {
      assert.ok(!html.includes(marker), label + ": foreign employer/worker marker in SSR");
    }
  }
}
export function assertPriorOwnPage(response, actor, worker, subjects) {
  assert.equal(response.status, 200, "Real owned worker SSR must succeed");
  assert.match(response.headers.get("content-type") || "", /text\/html/);
  assert.ok(response.text.includes("Previous employer"), "Empty/alternate page not proof");
  assert.ok(response.text.includes('data-organization-id="' + actor.org.id + '"'),
    "Employer context must be bound");
  assert.ok(response.text.includes('value="' + worker.id + '"'),
    "Worker input must reflect actual owned worker, not blank fallback");
  noForeignPriorMarkers(response.text, subjects.filter(s => s.org.id !== actor.org.id), "owned page");
}
export function assertPriorDeniedPage(response, subjects, label) {
  assert.equal(response.status, 404, label + ": hard 404 required");
  assert.ok(!response.text.includes("Previous employer &amp; PERA review"),
    label + ": private review form must not mount");
  assert.ok(!response.text.includes('data-organization-id="'),
    label + ": private employer context mounted on denial");
  noForeignPriorMarkers(response.text, subjects, label);
}
