import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessChain, DATABASE, PROJECT, ROLES, requireLiveOperator,
  validateDatabaseUrl,
} from "../scripts/qa/post-cutover-smoke-contract.mjs";

const SHA = "a".repeat(40);
const livePin = Object.freeze({
  CI: "false", GITHUB_ACTIONS: "false",
  EXPECTED_PRODUCTION_DATABASE_NAME: DATABASE,
  EXPECTED_PRODUCTION_NEON_PROJECT_ID: PROJECT,
  EXPECTED_PRODUCTION_NEON_BRANCH_ID: "br-test-clean-branch",
  EXPECTED_PRODUCTION_NEON_ENDPOINT_ID: "ep-test-endpoint-id",
  EXPECTED_PRODUCTION_RUNTIME_DB_ROLE: ROLES.app,
  EXPECTED_PRODUCTION_COMMIT_SHA: SHA,
});

test("live mode is owner-only, read-only, pinned to a reviewed SHA and protected Neon identity", () => {
  assert.doesNotThrow(() => requireLiveOperator(livePin, []));
  for (const key of ["CI", "GITHUB_ACTIONS"]) {
    assert.throws(() => requireLiveOperator({ ...livePin, [key]: "true" }, []),
      /LIVE_OPERATOR_ONLY_NOT_IN_CI/);
  }
  assert.throws(() => requireLiveOperator(
    { ...livePin, EXPECTED_PRODUCTION_DATABASE_NAME: "neondb" }, []),
  /PIN_DATABASE_MUST_BE_CLEAN_BASELINE/);
  assert.throws(() => requireLiveOperator(
    { ...livePin, EXPECTED_PRODUCTION_NEON_PROJECT_ID: "another-project" }, []),
  /PIN_PROJECT_MISMATCH/);
  assert.throws(() => requireLiveOperator(
    { ...livePin, EXPECTED_PRODUCTION_NEON_BRANCH_ID: "br-lucky-sound-b79i56jw" }, []),
  /PIN_FORBIDDEN_BRANCH/);
  assert.throws(() => requireLiveOperator(
    { ...livePin, EXPECTED_PRODUCTION_RUNTIME_DB_ROLE: "neondb_owner" }, []),
  /PIN_RUNTIME_ROLE_MUST_BE_RESTRICTED_APP/);
  assert.throws(() => requireLiveOperator(
    { ...livePin, EXPECTED_PRODUCTION_COMMIT_SHA: "b".repeat(39) }, []),
  /PIN_REVIEWED_COMMIT_REQUIRED/);
  for (const arg of ["--write", "--fictional-write", "--confirm"]) {
    assert.throws(() => requireLiveOperator(livePin, [arg]),
      /LIVE_WRITES_NOT_IMPLEMENTED_REFUSED/);
  }
});

test("live URL validator fails closed before a network connection can be created", () => {
  assert.throws(() => validateDatabaseUrl("not-a-url", ROLES.app, livePin),
    /DATABASE_URL_INVALID/);
  assert.throws(() => validateDatabaseUrl("https://example.invalid", ROLES.app, livePin),
    /DATABASE_SCHEME_INVALID/);
  assert.throws(() => validateDatabaseUrl(
    "postgresql://payrollph_app@not-neon.invalid/payrollph_clean_baseline", ROLES.app, livePin),
  /DATABASE_AUTH_REQUIRED/);
});

const hash = n => String(n).repeat(64);
const genesis = "0".repeat(64);
function chain() {
  return [
    { organization_id: 9, id: 1, chain_seq: "1", prev_hash: genesis,
      row_hash: hash(1), expected_hash: hash(1) },
    { organization_id: 9, id: 2, chain_seq: "2", prev_hash: hash(1),
      row_hash: hash(2), expected_hash: hash(2) },
  ];
}
const head = [{ chain_key: 9, last_seq: "2", last_hash: hash(2) }];

test("row alteration, missing persisted head and deleted sealed tail are detected", () => {
  const good = assessChain(chain(), head);
  assert.equal(good.verified, true);
  assert.equal(good.pendingEvents, 0);
  const altered = chain();
  altered[0].expected_hash = hash(8);
  assert.ok(assessChain(altered, head).breaks.includes("row_altered"));
  assert.ok(assessChain(chain(), []).breaks.includes("head_missing"));
  assert.ok(assessChain(chain().slice(0, 1), head).breaks.includes("head_mismatch"));
  const gap = chain().slice(1);
  assert.ok(assessChain(gap, head).breaks.includes("sequence_gap"));
  const pending = [{ organization_id: 9, id: 3, chain_seq: null,
    prev_hash: hash(2), row_hash: null, expected_hash: null }];
  assert.ok(assessChain([...chain(), ...pending], head).breaks.includes("pending_evidence"));
});

test("exact protected runner, app UPDATE audit denial, restart proof and sanitized reports are all wired", () => {
  const ci = readFileSync("scripts/qa/post-cutover-ci-smoke.mjs", "utf8");
  const live = readFileSync("scripts/qa/post-cutover-live-smoke.mjs", "utf8");
  const flow = readFileSync(".github/workflows/post-cutover-real-role-smoke.yml", "utf8");
  assert.match(ci, /UPDATE public.audit_events SET actor='tamper'/);
  assert.match(ci, /assert\.ok\(code === "42501"/);
  assert.match(ci, /ROLE_DENIAL_/);
  assert.match(ci, /MISSING_TAIL_WAS_NOT_DETECTED/);
  assert.match(ci, /dispatchAuditSealing/);
  assert.match(ci, /kind=bank&dryRun=true/);
  assert.doesNotMatch(ci, /dryRun=false|PayMongo\(|xenditPayroll\(/);
  assert.match(live, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.doesNotMatch(live, /INSERT INTO|UPDATE public\.|CREATE TABLE|DELETE FROM|TRUNCATE public\./);
  assert.match(live, /requireLiveOperator/);
  assert.match(flow, /run-clean-baseline-cutover\.mjs --apply/);
  assert.match(flow, /node_modules\/next\/dist\/bin\/next start/);
  assert.match(flow, /post-cutover-restart-smoke\.mjs/);
  assert.match(flow, /actions\/upload-artifact/);
  assert.doesNotMatch(flow.split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n"), /environment:\s*production|PRODUCTION_CUTOVER_OWNER_DATABASE_URL|secrets\.\w/);
});

test("successful password sign-in records a scoped real append-only audit before issuing a cookie", () => {
  const route = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  const writer = readFileSync("src/lib/audit.ts", "utf8");
  const session = route.indexOf("const session = await createSession(");
  const audited = route.indexOf("await recordSuccessfulLocalLogin({");
  const delivered = route.indexOf("jar.set(SESSION_COOKIE, session.token");
  assert.ok(session > 0 && audited > session && delivered > audited,
    "An HTTP login must append the audit after authentication but before cookie issuance");
  assert.match(route, /await revokeSession\(session\.token\)\.catch\(\(\) => \{\}\)/,
    "Audit failure must revoke the undelivered session; never fail open");
  assert.match(writer, /eq\(userOrganizations\.active, true\)/,
    "Never attribute login to a revoked or arbitrary employer membership");
  assert.match(writer, /return db\.transaction\(async \(tx\) => \{/,
    "Multi-tenant audit receipts must commit atomically");
  assert.match(writer, /await tx\.insert\(auditEvents\)\.values\(memberships\.map\(/,
    "Use actual PostgreSQL audit INSERTs, not a fabricated test-only receipt");
  const metadata = writer.slice(writer.indexOf("action: \"Successful local password sign-in\""));
  assert.match(metadata, /authMethod: "local"/);
  assert.match(metadata, /mfaVerified: input\.mfaVerified/);
  assert.doesNotMatch(metadata.slice(0, metadata.indexOf("return memberships.length")),
    /password:|token:|cookie:|totpCode:|backupCode:|ip:/,
    "Audit metadata may never retain passwords, session tokens, TOTP/backup codes or IPs");
});
