/**
 * Review-only source pins for the last non-session API GAP candidates.
 *
 * This check deliberately grants ZERO tenant-private method credits and does
 * not execute runtime routes, providers, cron, PostgreSQL or production code.
 * Public/operations classifications require a separate owner-approved change.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const CANDIDATES = Object.freeze([
  Object.freeze({
    verb: "GET", route: "setup",
    path: "src/app/api/setup/route.ts",
    blob: "9cf444640842e4bcdf0d8b6ad9912a5f68f34eaf",
    proposedClass: "PUBLIC-BY-DESIGN",
    decision: "Review whether anonymous global first-run status disclosure is intended.",
  }),
  Object.freeze({
    verb: "POST", route: "intake-challenge",
    path: "src/app/api/intake-challenge/route.ts",
    blob: "7462f3e97e77b0862a0d6163e64857cbe13a950f",
    proposedClass: "PUBLIC-BY-DESIGN",
    decision: "Approve public email-bound challenge and no tenant-selected response.",
  }),
  Object.freeze({
    verb: "POST", route: "hcm/work-items/escalate",
    path: "src/app/api/hcm/work-items/escalate/route.ts",
    blob: "b432d1331dac5c3da0c6a8bbc2b4c7ebe95ceb9a",
    proposedClass: "PRIVILEGED-OPERATIONS-TOKEN-ONLY",
    decision: "Approve global scheduler classification, not a tenant-session proof.",
  }),
]);

const INTAKE_HELPER = "src/lib/public-intake-proof.ts";
const INTAKE_HELPER_SHA = "7bb440c1151a7b43f3d713acf68db1cc6f6233a3";
const getText = (reader, path) => String(reader(path));
const gitBlobSha = input => {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return createHash("sha1")
    .update(Buffer.from("blob " + data.length + "\0"))
    .update(data).digest("hex");
};

export function reviewExistingNonSessionGapCandidates(
  manifest,
  read = path => readFileSync(path),
) {
  assert.equal(manifest?.schema, "payrollph-tenant-isolation-method-coverage-v1");
  assert.equal(manifest?.metrics?.methods, 498);
  const candidateStatuses = [];
  for (const item of CANDIDATES) {
    const entry = manifest.allApiRouteFiles?.[item.path];
    assert.equal(entry?.route, item.route, item.verb + " route identity drift");
    assert.equal(entry.gitBlobSha, item.blob, item.route + ": ledger source pin drift");
    assert.equal(gitBlobSha(read(item.path)), item.blob,
      item.route + ": handler source changed; renew review first");
    const method = entry.methods?.find(m => m.name === item.verb);
    assert.equal(method?.status, "GAP",
      item.verb + " " + item.route + ": no unapproved reclassification");
    assert.equal(method.testedBy, null,
      item.verb + " " + item.route + ": source-only evidence is NOT tenant HTTP proof");
    candidateStatuses.push(item.verb + " " + item.route);
  }

  const setup = getText(read, CANDIDATES[0].path);
  assert.match(setup, /from\(users\)/);
  assert.match(setup, /export async function needsSetup\(\)/);
  const get = setup.split("export async function GET() {")[1]
    ?.split("export async function POST(")[0];
  assert.ok(get, "GET setup method must still be independent from setup POST");
  assert.match(get, /needsSetup: await needsSetup\(\)/);
  assert.match(get, /setupProtected: process\.env\.NODE_ENV === "production"/);
  assert.doesNotMatch(get, /organizationId|employeeId|user\.email|passwordHash|db\.insert|db\.update|request\.url/,
    "Public setup GET must not read or project private employer/user data");

  const intake = getText(read, CANDIDATES[1].path);
  assert.match(intake, /enforceSameOriginMutation\(request\)/);
  assert.match(intake, /criticalReleaseFlagEnabled\("publicIntakeProof"\)/);
  assert.equal(intake.split('mode !== "distributed-postgres"').length - 1, 2,
    "Both anonymous challenge limits must refuse non-distributed mode");
  assert.match(intake, /issueIntakeProof\(email, process\.env\)/);
  assert.doesNotMatch(intake, /@\/db|organizationId|employeeId|payrollRuns/,
    "Public challenge cannot select or import tenant business rows");
  assert.equal(gitBlobSha(read(INTAKE_HELPER)), INTAKE_HELPER_SHA,
    "Intake email-hash/HMAC implementation changed without review");
  const helper = getText(read, INTAKE_HELPER);
  assert.match(helper, /createHmac\("sha256"/);
  assert.match(helper, /email: digest\(email\.trim\(\)\.toLowerCase\(\)\)/);
  assert.doesNotMatch(helper, /organizationId|employeeId|payrollRuns/);

  const cron = getText(read, CANDIDATES[2].path);
  assert.match(cron, /HCM_SLA_CRON_SECRET/);
  assert.match(cron, /timingSafeEqual\(a, b\)/);
  assert.ok(cron.indexOf("if (!authorized(request))") >= 0 &&
    cron.indexOf("if (!authorized(request))") < cron.indexOf("pool.connect()"),
    "Global worker credential must be checked before SQL access");
  for (const marker of ["c.organization_id", "item.organization_id",
    "uo.organization_id=$1", '"hcm-sla:" + item.organization_id']) {
    assert.ok(cron.includes(marker), "Scheduler employer attribution changed: " + marker);
  }
  assert.doesNotMatch(cron, /getSessionUser\(|assertOrganizationRole\(/,
    "Global sweep must not be mislabeled a tenant-session endpoint");
  return candidateStatuses;
}
