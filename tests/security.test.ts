import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "../src/lib/crypto";
import { rateLimit } from "../src/lib/rate-limit-memory";
import { generateTotp, verifyTotp } from "../src/lib/totp";
import { isForbiddenIp } from "../src/lib/security-network";
import { decryptTotpSecret, encryptTotpSecret } from "../src/lib/security-secret";
import { passwordIssues } from "../src/lib/validation";
import { biometricDeviceCredential, verifyBiometricDeviceCredential } from "../src/lib/biometric-auth";
import { malwareScannerConfigured, scanUpload } from "../src/lib/storage";
import { isPublicDemoIdentity } from "../src/lib/demo-security";

// RFC 6238 Appendix B test vector (SHA1, 8 digits originally; we verify 6-digit mode with known secret)
// Using the standard secret "12345678901234567890" encoded in base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("scrypt password hash verifies with timing-safe compare", () => {
  const hash = hashPassword("LinawDemo2026!");
  assert.match(hash, /^scrypt\$v2\$65536\$8\$2\$/);
  assert.equal(passwordNeedsRehash(hash), false);
  assert.equal(verifyPassword("LinawDemo2026!", hash), true);
  assert.equal(verifyPassword("wrong-password", hash), false);

  const legacy = "scrypt$0123456789abcdef0123456789abcdef$9564d5a180593f4f60ac8b2db7e8966b37a1d6fc22b396d69f4f71972c1820f80cec190209c19b5603fae554eee5a6318a4cadcbc5b3892fd40e2d8df24c3997";
  assert.equal(passwordNeedsRehash(legacy), true);
});

test("TOTP generates and verifies within the current window", () => {
  const now = Date.UTC(2026, 2, 16, 8, 0, 0);
  const code = generateTotp(RFC_SECRET, undefined, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(code, RFC_SECRET, { now }), true);
  assert.equal(verifyTotp("000000", RFC_SECRET, { now }), false);
});

test("TOTP remains valid across a ±1 step window", () => {
  const now = Date.UTC(2026, 2, 16, 8, 0, 0);
  const previous = generateTotp(RFC_SECRET, Math.floor(now / 1000 / 30) - 1);
  assert.equal(verifyTotp(previous, RFC_SECRET, { now, window: 1 }), true);
});

test("single-instance rate limiter blocks after the configured threshold", () => {
  const key = `test-${Date.now()}-${Math.random()}`;
  for (let i = 0; i < 3; i += 1) {
    const result = rateLimit(key, { limit: 3, windowMs: 60_000 });
    assert.equal(result.allowed, true);
    assert.equal(result.mode, "single-instance");
  }
  const blocked = rateLimit(key, { limit: 3, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
});


test("webhook network guard blocks private and metadata ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.5",
    "::1",
    "::ffff:7f00:1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fec0::1",
  ]) {
    assert.equal(isForbiddenIp(address), true, `${address} must be blocked`);
  }
  assert.equal(isForbiddenIp("8.8.8.8"), false);
  assert.equal(isForbiddenIp("1.1.1.1"), false);
});

test("public health check cannot execute scheduler work", () => {
  const source = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.ok(!source.includes("tickScheduler"), "health route must not execute scheduler work");
});

test("anonymous health checks cannot create monitoring snapshots", () => {
  const source = readFileSync("src/app/api/health/route.ts", "utf8");
  assert.ok(source.includes("constantTimeSecretEqual"));
  assert.ok(source.includes("recordSnapshot"));
  assert.ok(source.includes("if (recordSnapshot)"));
  assert.ok(source.includes("HEALTH_TOKEN"));
});

test("production worker endpoints require a strong operational worker token", () => {
  for (const path of ["src/app/api/jobs/tick/route.ts", "src/app/api/webhooks/drain/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes('process.env.NODE_ENV === "production"'));
    assert.ok(source.includes('operationalSecret("worker")'));
    assert.ok(source.includes("constantTimeSecretEqual"));
    assert.ok(source.includes("status: 503"));
  }
});

test("demo login never returns a generated TOTP code", () => {
  const source = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  assert.ok(!source.includes("demoTotpCode"));
  assert.ok(!source.includes("generateTotp(user.totpSecret)"));
});

test("public demo cannot inherit the production host allow-list implicitly", () => {
  const source = readFileSync("src/app/api/auth/demo-switch/route.ts", "utf8");
  assert.ok(source.includes("rateLimitDistributed"));
  assert.ok(!source.includes("productionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL"));
  assert.ok(source.includes('DEMO_MODE && process.env.NODE_ENV !== "production"'));
});

test("developer webhooks are SSRF-guarded and demo identities cannot mint credentials", () => {
  const developer = readFileSync("src/app/api/developer/route.ts", "utf8");
  const webhooks = readFileSync("src/lib/webhooks.ts", "utf8");
  assert.ok(developer.includes("validateWebhookTarget"));
  assert.ok(developer.includes("publicDemoMutationDenied"));
  assert.ok(webhooks.includes("postValidatedWebhook"));
  const network = readFileSync("src/lib/security-network.ts", "utf8");
  assert.ok(network.includes("resolveWebhookTarget"));
  assert.ok(network.includes("pinned.address"));
  assert.ok(network.includes("servername: target.hostname"));
});

test("first-run production setup is token protected and serialized", () => {
  const source = readFileSync("src/app/api/setup/route.ts", "utf8");
  assert.ok(source.includes("SETUP_TOKEN"));
  assert.ok(source.includes("constantTimeSecretEqual"));
  assert.ok(source.includes("pg_advisory_xact_lock"));
});

test("password reset uses the shared password policy and rotates old links", () => {
  const reset = readFileSync("src/app/api/auth/reset-password/route.ts", "utf8");
  const forgot = readFileSync("src/app/api/auth/forgot-password/route.ts", "utf8");
  assert.ok(reset.includes("passwordIssues(password)"));
  assert.ok(forgot.includes("isNull(passwordResetTokens.usedAt)"));
});

test("baseline browser hardening headers are configured", () => {
  const source = readFileSync("next.config.ts", "utf8");
  for (const header of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Strict-Transport-Security",
  ]) {
    assert.ok(source.includes(header), `${header} must be configured`);
  }
});


test("shared public demo cannot mutate credentials or trigger real external side effects", () => {
  for (const path of [
    "src/app/api/account/email/route.ts",
    "src/app/api/account/password/route.ts",
    "src/app/api/account/profile/route.ts",
    "src/app/api/account/sessions/route.ts",
    "src/app/api/auth/totp/setup/route.ts",
    "src/app/api/invitations/route.ts",
    "src/app/api/billing/route.ts",
    "src/app/api/organizations/route.ts",
    "src/app/api/developer/route.ts",
    "src/app/api/delegations/route.ts",
    "src/app/api/payroll-runs/[id]/exports/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("publicDemoMutationDenied"), `${path} must guard shared demo mutations`);
  }
});


test("production can never seed fixed demo credentials even when DEMO_MODE is set", () => {
  const seed = readFileSync("src/db/seed.ts", "utf8");
  assert.ok(seed.includes('process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true"'));
});

test("public demo password resets stay generic and do not create reset side effects", () => {
  const forgot = readFileSync("src/app/api/auth/forgot-password/route.ts", "utf8");
  assert.ok(forgot.includes("isPublicDemoIdentity(user.email)"));
  assert.ok(forgot.indexOf("isPublicDemoIdentity(user.email)") < forgot.indexOf("const token = randomToken"));
});

test("public demo payroll release suppresses email and webhook side effects", () => {
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  assert.ok(release.includes("isPublicDemoIdentity(user.email)"));
  assert.ok(release.includes("sharedDemo ? [] : staff"));
  assert.ok(release.includes("sharedDemo ? [] : await dispatchWebhook"));
});


test("all six public demo identities stay inside the side-effect guard", () => {
  for (const email of [
    "owner.demo@linaw.ph",
    "hr.demo@linaw.ph",
    "payroll.demo@linaw.ph",
    "checker.demo@linaw.ph",
    "bookkeeper.demo@linaw.ph",
    "jonas.reyes@linaw.ph",
  ]) {
    assert.equal(isPublicDemoIdentity(email), true, `${email} must be recognized as a public demo identity`);
  }
});

test("synthetic bank destinations are restricted to the public demo export path", () => {
  const route = readFileSync("src/app/api/payroll-runs/[id]/exports/route.ts", "utf8");
  const exporter = readFileSync("src/lib/exporters.ts", "utf8");
  assert.ok(route.includes("allowSyntheticDemoDestinations: isPublicDemoIdentity(user.email)"));
  assert.ok(route.includes('publicDemoMutationDenied(user.email, "Live payroll disbursement")'));
  assert.ok(exporter.includes("allowSyntheticDemoDestinations?: boolean"));
  assert.ok(exporter.includes('options.allowSyntheticDemoDestinations ? "demo-" : ""'));
  assert.ok(exporter.includes('syntheticDemoDestinations: options.allowSyntheticDemoDestinations === true'));
});


test("redacted demo can traverse review and release without weakening real payout checks", () => {
  const submit = readFileSync("src/app/api/payroll-runs/[id]/submit-review/route.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const checklist = readFileSync("src/lib/payroll-release-checklist.ts", "utf8");

  assert.ok(submit.includes("allowRedactedDemoPayout: sharedDemo"));
  assert.ok(submit.includes('sharedDemo && finding.code === "MISSING_BANK_DETAILS"'));
  assert.ok(release.includes("allowRedactedDemoPayout: sharedDemo"));
  assert.ok(release.includes('sharedDemo && finding.code === "MISSING_BANK_DETAILS"'));
  assert.ok(checklist.includes("allowRedactedDemoPayout?: boolean"));
  assert.ok(checklist.includes("Boolean(options.allowRedactedDemoPayout)"));
  assert.ok(checklist.includes("live disbursement remains disabled"));
});


test("password policy caps oversized inputs", () => {
  assert.ok(passwordIssues("A".repeat(257) + "a1").some((issue) => issue.includes("256")));
});

test("TOTP seeds encrypt with AES-GCM when an encryption key is configured", () => {
  const previous = process.env.TOTP_ENCRYPTION_KEY;
  process.env.TOTP_ENCRYPTION_KEY = "11".repeat(32);
  try {
    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP", { required: true });
    assert.match(encrypted, /^enc:v1:/);
    assert.notEqual(encrypted, "JBSWY3DPEHPK3PXP");
    assert.equal(decryptTotpSecret(encrypted), "JBSWY3DPEHPK3PXP");
  } finally {
    if (previous === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = previous;
  }
});

test("sensitive cookie-authenticated mutations use the shared same-origin guard", () => {
  for (const path of [
    "src/app/api/account/email/route.ts",
    "src/app/api/account/password/route.ts",
    "src/app/api/account/profile/route.ts",
    "src/app/api/account/sessions/route.ts",
    "src/app/api/auth/login/route.ts",
    "src/app/api/auth/forgot-password/route.ts",
    "src/app/api/auth/reset-password/route.ts",
    "src/app/api/auth/totp/setup/route.ts",
    "src/app/api/billing/route.ts",
    "src/app/api/developer/route.ts",
    "src/app/api/delegations/route.ts",
    "src/app/api/invitations/route.ts",
    "src/app/api/organizations/route.ts",
    "src/app/api/payroll-runs/[id]/release/route.ts",
    "src/app/api/setup/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("enforceSameOriginMutation"), `${path} must guard browser mutations`);
  }
});

test("high-risk administrative actions require MFA in production", () => {
  for (const path of [
    "src/app/api/billing/route.ts",
    "src/app/api/developer/route.ts",
    "src/app/api/delegations/route.ts",
    "src/app/api/invitations/route.ts",
    "src/app/api/organizations/route.ts",
    "src/app/api/payroll-runs/[id]/release/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("requireSensitiveActionMfa"), `${path} must require privileged MFA`);
  }
});

test("security-sensitive links use the canonical configured app origin", () => {
  for (const path of [
    "src/app/api/auth/forgot-password/route.ts",
    "src/app/api/invitations/route.ts",
    "src/app/api/billing/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("canonicalAppOrigin"), `${path} must not trust the request Host for sensitive links`);
  }
});

test("production session cookie uses host prefix and idle expiry", () => {
  const source = readFileSync("src/lib/auth.ts", "utf8");
  assert.ok(source.includes("__Host-linaw_session"));
  assert.ok(source.includes("SESSION_IDLE_TIMEOUT_MS"));
  assert.ok(source.includes('priority: "high"'));
});

test("expanded browser hardening policy is configured", () => {
  const source = readFileSync("next.config.ts", "utf8");
  for (const directive of [
    "default-src 'self'",
    "form-action 'self'",
    "Cross-Origin-Opener-Policy",
    "X-Permitted-Cross-Domain-Policies",
    "no-store, max-age=0",
  ]) {
    assert.ok(source.includes(directive), `${directive} must be configured`);
  }
});


function apiRouteFiles(dir = "src/app/api"): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...apiRouteFiles(path));
    else if (entry.isFile() && entry.name === "route.ts") files.push(path);
  }
  return files;
}

test("every cookie-authenticated API mutation is protected by same-origin enforcement", () => {
  const mutationPattern = /export async function (?:POST|PUT|PATCH|DELETE)\b/;
  for (const path of apiRouteFiles()) {
    const source = readFileSync(path, "utf8");
    if (!source.includes("getSessionUser(") || !mutationPattern.test(source)) continue;
    assert.ok(
      source.includes("enforceSameOriginMutation"),
      `${path} has a cookie-authenticated mutation without same-origin enforcement`,
    );
  }
});

test("framework security patch floors cannot regress", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.next, "16.3.8");
  assert.equal(pkg.devDependencies?.["eslint-config-next"], "16.3.8");
  assert.equal(pkg.devDependencies?.postcss, "8.5.28");
});


test("production readiness diagnostics are token protected and verify known passwords correctly", () => {
  const source = readFileSync("src/app/api/readiness/route.ts", "utf8");
  assert.ok(source.includes("READINESS_TOKEN"));
  assert.ok(source.includes("constantTimeSecretEqual"));
  assert.ok(source.includes('verifyPassword("LinawDemo2026!"'));
  assert.ok(!source.includes('hashPassword("LinawDemo2026!"'));
});


test("same-origin enforcement never trusts auth-looking headers by presence alone", () => {
  const source = readFileSync("src/lib/security-request.ts", "utf8");
  for (const headerLookup of [
    'request.headers.get("authorization")',
    'request.headers.get("x-api-key")',
    'request.headers.get("x-worker-token")',
    'request.headers.get("x-setup-token")',
  ]) {
    assert.ok(!source.includes(headerLookup), `${headerLookup} must not bypass CSRF checks globally`);
  }
});

test("privileged MFA is proven by the current session, not only enabled on the account", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const auth = readFileSync("src/lib/auth.ts", "utf8");
  const login = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  const securityRequest = readFileSync("src/lib/security-request.ts", "utf8");
  const totpSetup = readFileSync("src/app/api/auth/totp/setup/route.ts", "utf8");

  assert.ok(schema.includes('mfaVerifiedAt: timestamp("mfa_verified_at"'));
  assert.ok(auth.includes("mfaVerifiedAt: options.mfaVerifiedAt ?? null"));
  assert.ok(auth.includes("mfaVerifiedAt: row.session.mfaVerifiedAt ?? null"));
  assert.ok(login.includes("mfaVerifiedAt: user.totpEnabled ? new Date() : null"));
  assert.ok(securityRequest.includes("PRIVILEGED_MFA_MAX_AGE_HOURS"));
  assert.ok(securityRequest.includes("user.mfaVerifiedAt"));
  assert.ok(totpSetup.includes("mfaVerifiedAt: verifiedAt"));
});

test("mixed biometric auth never falls back from a bad bearer token to a browser session", () => {
  const source = readFileSync("src/app/api/biometrics/sync/route.ts", "utf8");
  const post = source.slice(source.indexOf("export async function POST"));
  assert.ok(post.includes('const authorization = request.headers.get("authorization")'));
  assert.ok(post.includes("if (!authorization)"));
  assert.ok(post.includes("if (authorization)"));
  assert.ok(post.includes('error: "A valid biometric ingest credential is required."'));
  assert.ok(post.includes("verifyBiometricDeviceCredential"));
  assert.ok(post.includes("biometric-sync:device:"));
});

test("biometric gateway credentials are bound to organization and device serial", () => {
  const master = "a".repeat(48);
  const token = biometricDeviceCredential(master, 7, " ZK-001 ");
  assert.ok(token.startsWith("bio_"));
  assert.equal(verifyBiometricDeviceCredential(token, master, 7, "zk-001"), true);
  assert.equal(verifyBiometricDeviceCredential(token, master, 8, "zk-001"), false);
  assert.equal(verifyBiometricDeviceCredential(token, master, 7, "zk-002"), false);
  assert.equal(verifyBiometricDeviceCredential(master, master, 7, "zk-001"), false);
});

test("CI blocks runtime dependency vulnerabilities and still reports development advisories", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(source.includes("npm audit --omit=dev --audit-level=high"));
  assert.ok(source.includes("npm audit --include=dev --audit-level=high"));
  assert.ok(source.includes("continue-on-error: true"));
});


test("invitation acceptance cannot overwrite an existing account credential", () => {
  const source = readFileSync("src/app/api/invitations/accept/route.ts", "utf8");
  assert.ok(source.includes("cannot set credentials for an existing Linaw account"));
  assert.ok(!source.includes("passwordHash: hashPassword(password) }).where(eq(users.id, existing.id))"));
  assert.ok(source.includes("db.transaction"));
  assert.ok(source.includes("isNull(invitations.acceptedAt)"));
  assert.ok(source.includes("gt(invitations.expiresAt, new Date())"));
  assert.ok(source.includes("backupCodes: []"));
});


test("TOTP enrollment requires password reauthentication and never reveals a seed on GET", () => {
  const route = readFileSync("src/app/api/auth/totp/setup/route.ts", "utf8");
  const panel = readFileSync("src/components/account-panel.tsx", "utf8");
  const getBlock = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.ok(!getBlock.includes("generateTotpSecret"));
  assert.ok(!getBlock.includes("totpSecret:"));
  assert.ok(route.includes("verifyPassword(currentPassword, user.passwordHash)"));
  assert.ok(route.includes('action === "begin"'));
  assert.ok(route.includes("const secret = generateTotpSecret()"));
  assert.ok(route.includes("backupCodes: []"));
  assert.ok(panel.includes('currentPassword'));
  assert.ok(panel.includes('action: "begin"'));
  assert.ok(panel.includes('action: "verify"'));
});


test("password recovery is enumeration resistant and reset tokens are consumed atomically", () => {
  const forgot = readFileSync("src/app/api/auth/forgot-password/route.ts", "utf8");
  const reset = readFileSync("src/app/api/auth/reset-password/route.ts", "utf8");

  assert.ok(!forgot.includes("delivery: {"));
  assert.ok(forgot.includes('process.env.NODE_ENV === "production" && !deliveryCapable()'));
  assert.ok(forgot.indexOf('process.env.NODE_ENV === "production" && !deliveryCapable()') < forgot.indexOf("const token = randomToken"));
  assert.ok(forgot.includes("return Response.json(generic);"));
  assert.ok(forgot.includes("catch {"));

  assert.ok(reset.includes("db.transaction"));
  assert.ok(reset.includes("returning({ userId: passwordResetTokens.userId })"));
  assert.ok(reset.includes("isNull(passwordResetTokens.usedAt)"));
  assert.ok(reset.includes("gt(passwordResetTokens.expiresAt, changedAt)"));
  assert.ok(reset.includes("if (!reset)"));
});


test("production invitations never return raw tokens and org units are tenant-bound", () => {
  const route = readFileSync("src/app/api/invitations/route.ts", "utf8");
  assert.ok(route.includes("eq(orgUnits.organizationId, organizationId)"));
  assert.ok(route.includes("Organization unit not found in this workspace."));
  assert.ok(route.includes('process.env.NODE_ENV === "production" && !deliveryCapable()'));
  assert.ok(route.includes('process.env.NODE_ENV !== "production" && !deliveryCapable() ? token : undefined'));
});


test("privileged external-side-effect routes are rate limited", () => {
  const cases = [
    ["src/app/api/developer/route.ts", "developer-mutation:", "randomBytes(32)"],
    ["src/app/api/billing/route.ts", "billing-checkout:", "rateLimitDistributed"],
    ["src/app/api/invitations/route.ts", "invite-create:", "rateLimitDistributed"],
  ] as const;

  for (const [path, bucket, marker] of cases) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes("rateLimitDistributed"), `${path} must use distributed throttling`);
    assert.ok(source.includes(bucket), `${path} must have a dedicated security rate-limit bucket`);
    assert.ok(source.includes(marker), `${path} is missing the expected hardening marker`);
  }
});


test("sensitive one-time links are redacted from the persistent mail outbox", () => {
  const mailer = readFileSync("src/lib/mailer.ts", "utf8");
  const emailChange = readFileSync("src/app/api/account/email/route.ts", "utf8");
  for (const purpose of ["password-reset", "invitation", "email-change-verification"]) {
    assert.ok(mailer.includes(`"${purpose}"`), `${purpose} must be treated as sensitive`);
  }
  assert.ok(mailer.includes("storedBodyAfterAttempt"));
  assert.ok(mailer.includes("sensitive one-time link removed"));
  assert.ok(emailChange.includes('process.env.NODE_ENV === "production" && !deliveryCapable()'));
});

test("successful login upgrades legacy password hashes", () => {
  const source = readFileSync("src/app/api/auth/login/route.ts", "utf8");
  assert.ok(source.includes("passwordNeedsRehash(user.passwordHash)"));
  assert.ok(source.includes("passwordHash: hashPassword(password)"));
});

test("XLSX migration parsing has decompression-bomb ceilings", () => {
  const source = readFileSync("src/lib/xlsx-import.ts", "utf8");
  for (const marker of [
    "MAX_ZIP_ENTRIES",
    "MAX_ENTRY_UNCOMPRESSED_BYTES",
    "MAX_TOTAL_UNCOMPRESSED_BYTES",
    "MAX_COMPRESSION_RATIO",
    "maxOutputLength",
  ]) {
    assert.ok(source.includes(marker), `${marker} must protect spreadsheet imports`);
  }
});

test("API keys use 256-bit material and distributed per-key throttling", () => {
  const keys = readFileSync("src/lib/api-keys.ts", "utf8");
  const auth = readFileSync("src/lib/api-auth.ts", "utf8");
  assert.ok(keys.includes("randomToken(32)"));
  assert.ok(auth.includes("api-key:${row.id}"));
  assert.ok(auth.includes("{ limit: 120, windowMs: 60_000 }"));
});


test("webhook delivery pins the validated public address against DNS rebinding", () => {
  const network = readFileSync("src/lib/security-network.ts", "utf8");
  const webhooks = readFileSync("src/lib/webhooks.ts", "utf8");
  assert.ok(network.includes("postValidatedWebhook"));
  assert.ok(network.includes("lookup:"));
  assert.ok(network.includes("pinned.address"));
  assert.ok(network.includes("servername: target.hostname"));
  assert.ok(webhooks.includes("postValidatedWebhook"));
  assert.ok(!webhooks.includes("await fetch(targetUrl"));
});

test("API employee resources are fetched inside the API key tenant boundary", () => {
  const source = readFileSync("src/app/api/v1/employees/[id]/route.ts", "utf8");
  const tenantBoundLookup = "eq(employees.organizationId, gate.auth!.organizationId)";
  assert.ok(
    source.split(tenantBoundLookup).length - 1 >= 3,
    "GET, PATCH and DELETE employee lookups must all include the authenticated API key organization",
  );
});


test("malware scanner client fails closed and distinguishes infected files", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousUrl = env.MALWARE_SCAN_URL;
  const previousToken = env.MALWARE_SCAN_TOKEN;
  const previousNodeEnv = env.NODE_ENV;

  env.NODE_ENV = "production";
  env.MALWARE_SCAN_URL = "https://scanner.example.test/scan";
  env.MALWARE_SCAN_TOKEN = "test-scanner-token";

  try {
    assert.equal(malwareScannerConfigured(), true);

    const cleanFetch = (async () =>
      new Response(JSON.stringify({ clean: true, engine: "test-av" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const clean = await scanUpload(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
      fileName: "sample.pdf",
      mime: "application/pdf",
    }, { fetchImpl: cleanFetch, timeoutMs: 1000 });
    assert.equal(clean.scannedClean, true);
    assert.equal(clean.engine, "test-av");

    const infectedFetch = (async () =>
      new Response(JSON.stringify({ clean: false, engine: "test-av", threat: "EICAR-Test-Signature" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const infected = await scanUpload(new Uint8Array([1, 2, 3]), {
      fileName: "sample.pdf",
      mime: "application/pdf",
    }, { fetchImpl: infectedFetch, timeoutMs: 1000 });
    assert.equal(infected.scannedClean, false);
    assert.equal(infected.unavailable, undefined);
    assert.equal(infected.threat, "EICAR-Test-Signature");

    const unavailableFetch = (async () =>
      new Response("upstream down", { status: 503 })) as typeof fetch;
    const unavailable = await scanUpload(new Uint8Array([1, 2, 3]), {
      fileName: "sample.pdf",
      mime: "application/pdf",
    }, { fetchImpl: unavailableFetch, timeoutMs: 1000 });
    assert.equal(unavailable.scannedClean, false);
    assert.equal(unavailable.unavailable, true);
  } finally {
    if (previousUrl === undefined) delete env.MALWARE_SCAN_URL;
    else env.MALWARE_SCAN_URL = previousUrl;
    if (previousToken === undefined) delete env.MALWARE_SCAN_TOKEN;
    else env.MALWARE_SCAN_TOKEN = previousToken;
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
  }
});

test("production malware scanner configuration requires authenticated HTTPS", () => {
  const env = process.env as Record<string, string | undefined>;
  const previousUrl = env.MALWARE_SCAN_URL;
  const previousToken = env.MALWARE_SCAN_TOKEN;
  const previousNodeEnv = env.NODE_ENV;

  env.NODE_ENV = "production";
  try {
    env.MALWARE_SCAN_URL = "http://scanner.example.test/scan";
    env.MALWARE_SCAN_TOKEN = "token";
    assert.equal(malwareScannerConfigured(), false);

    env.MALWARE_SCAN_URL = "https://scanner.example.test/scan";
    delete env.MALWARE_SCAN_TOKEN;
    assert.equal(malwareScannerConfigured(), false);

    env.MALWARE_SCAN_TOKEN = "token";
    assert.equal(malwareScannerConfigured(), true);
  } finally {
    if (previousUrl === undefined) delete env.MALWARE_SCAN_URL;
    else env.MALWARE_SCAN_URL = previousUrl;
    if (previousToken === undefined) delete env.MALWARE_SCAN_TOKEN;
    else env.MALWARE_SCAN_TOKEN = previousToken;
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
  }
});


test("privileged payroll money actions use distributed sensitive-action rate limits", async () => {
  const { readFileSync } = await import("node:fs");
  const helper = readFileSync("src/lib/security-request.ts", "utf8");
  const release = readFileSync("src/app/api/payroll-runs/[id]/release/route.ts", "utf8");
  const payout = readFileSync("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts", "utf8");
  const employees = readFileSync("src/app/api/employees/route.ts", "utf8");

  assert.ok(helper.includes("rateLimitDistributed"));
  assert.ok(helper.includes("SENSITIVE_ACTION_RATE_LIMITED"));
  assert.ok(helper.includes('"Retry-After"'));
  assert.ok(release.includes('action: "payroll-release"'));
  assert.ok(payout.includes('action: "payout-reconciliation"'));
  assert.ok(employees.includes('action: "employee-payout-destination-change"'));
});
