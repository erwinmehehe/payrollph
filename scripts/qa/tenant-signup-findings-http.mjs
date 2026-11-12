/** #1898 findings: SOLO_VERIFIED_DEV_RECOVERY, fictional PG16 and loopback mailbox only. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { requireDisposablePrelogin, clientAddresses, mailedTokens, solveIntakeProof,
  assertNoSession, sessionCookieOf } from "./tenant-prelogin-contract.mjs";
import { startPreloginSmtpSink } from "./tenant-prelogin-smtp-sink.mjs";

const mode = process.env.SIGNUP_FINDINGS_MODE;
const revision = process.env.GITHUB_HEAD_REVISION;
const baseline = revision === "baseline";
const BASELINE = "efd875a246bb38345ef805ea64363472af72414f";
const INVITED_EMAIL = "signup-invited-recovery@example.invalid";
const INVITED_CODE = "fictional-loopback-invite-for-signup-findings-2026-only";
const digest = value => createHash("sha256").update(value).digest("hex");
assert.ok(["normal", "invited"].includes(mode), "SIGNUP_PROOF_REFUSED_MODE");
assert.ok(["baseline", "current"].includes(revision), "SIGNUP_PROOF_REFUSED_REVISION");
for (const name of ["FINAL_PAY_SIGNED_REVIEW_ENABLED", "EXACT_THIRTEENTH_CENTAVOS_ENABLED",
  "PAYROLL_CALCULATION_HISTORY_ENABLED", "NEXT_CSP_ENABLED"]) {
  assert.equal(process.env[name], "false", "SIGNUP_PROOF_REFUSED_RELEASE_FLAG");
}
if (mode === "invited") {
  requireDisposablePrelogin({ ...process.env, PRIVATE_PILOT_INVITE_ENABLED: "false" });
  assert.equal(process.env.PRIVATE_PILOT_INVITE_ENABLED, "true");
  assert.equal(process.env.PRIVATE_PILOT_INVITE_EMAIL_SHA256, digest(INVITED_EMAIL));
  assert.equal(process.env.PRIVATE_PILOT_INVITE_CODE_SHA256, digest(INVITED_CODE));
  const expiry = Date.parse(process.env.PRIVATE_PILOT_INVITE_EXPIRES_AT ?? "");
  assert.ok(expiry > Date.now() && expiry <= Date.now() + 2 * 60 * 60_000, "SIGNUP_PROOF_REFUSED_INVITE_EXPIRY");
} else requireDisposablePrelogin();
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(head, baseline ? BASELINE : process.env.GITHUB_HEAD_SHA, "SIGNUP_PROOF_REFUSED_SOURCE_HEAD");
// No application/DB import or network operation precedes the safety checks above.
const [{ db, pool }, { users }, { saasSignupVerifications }, { eq }, { verifyPassword }] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("../../src/lib/saas-billing-schema.ts"), import("drizzle-orm"), import("../../src/lib/crypto.ts"),
]);
const BASE = "http://127.0.0.1:3000";
const PASS = "Fictional-Owner-Password-2026-X9";
const OTHER_PASS = "Fictional-Stranger-Password-2026-W8";
const inbox = [], results = [], httpEvidence = [];
const nextIp = clientAddresses();
const sink = await startPreloginSmtpSink(inbox);
const suffix = randomUUID().slice(0, 8);
const address = key => "signup-" + key + "-" + suffix + "@example.invalid";
const bodyFor = (email, extra = {}) => ({ name: "Fictional Owner", company: "Fictional Employer", email,
  password: PASS, acceptTerms: true, ...extra });
const userByEmail = async email => (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
const counts = async () => (await pool.query(`SELECT
  (SELECT count(*)::int FROM users) AS users,
  (SELECT count(*)::int FROM organizations) AS organizations,
  (SELECT count(*)::int FROM subscriptions) AS subscriptions,
  (SELECT count(*)::int FROM user_organizations) AS memberships`)).rows[0];

async function req(path, { body, ip = nextIp(), method = "POST", cookie } = {}) {
  const headers = { origin: BASE, "sec-fetch-site": "same-origin", "x-forwarded-for": ip, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const start = performance.now();
  const response = await fetch(BASE + path, { method, headers, redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(15_000), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch { /* refusal need not be JSON */ }
  return { status: response.status, text, json, headers: response.headers, durationMs: performance.now() - start };
}
async function proofFor(email) {
  const boundary = 300_000 - Date.now() % 300_000;
  if (boundary < 15_000) await new Promise(resolve => setTimeout(resolve, boundary + 500));
  const response = await req("/api/intake-challenge", { body: { email } });
  assert.equal(response.status, 200, "CHALLENGE_NOT_ISSUED");
  assert.equal(response.json?.enabled, true);
  return { token: response.json.token, nonce: solveIntakeProof(response.json.token) };
}
async function signup(email, extra = {}) {
  return req("/api/signup", { body: bodyFor(email, { intakeProof: await proofFor(email), ...extra }) });
}
const headersOf = response => [...response.headers.entries()].filter(([key]) => key !== "date").sort(([a], [b]) => a.localeCompare(b));
const timingClass = response => response.durationMs < 400 ? "fast" : response.durationMs < 3000 ? "bounded" : "slow";
function publicSummary(response) {
  return { status: response.status, bodySha256: digest(response.text), bodyKeys: Object.keys(response.json ?? {}).sort(),
    headerSha256: digest(JSON.stringify(headersOf(response))), timingClass: timingClass(response),
    durationMs: Math.round(response.durationMs), hasSetCookie: response.headers.has("set-cookie") };
}
function finding(condition, code) {
  if (!condition) { const error = new Error(code); error.findingCode = code; throw error; }
}
function compareAnswers(a, b, code) {
  assertNoSession(a, "signup A"); assertNoSession(b, "signup B");
  const parts = { status: a.status === b.status, body: a.text === b.text,
    headers: JSON.stringify(headersOf(a)) === JSON.stringify(headersOf(b)), timingClass: timingClass(a) === timingClass(b) };
  httpEvidence.push({ code, first: publicSummary(a), second: publicSummary(b), equal: parts });
  finding(Object.values(parts).every(Boolean), code);
}
async function check(id, fn) {
  try { await fn(); results.push({ id, passed: true }); }
  catch (error) {
    // Never print assertion diffs, SQL parameters, credentials, mailbox contents or session tokens.
    const code = typeof error?.findingCode === "string" ? error.findingCode : "UNEXPECTED_REGRESSION";
    const location = String(error?.stack ?? "").match(/tenant-signup-findings-http\.mjs:\d+:\d+/)?.[0] ?? "unknown";
    results.push({ id, passed: false, code, location });
  }
  console.log("SIGNUP_PROOF " + revision + " " + id + " " + (results.at(-1).passed ? "PASS" : "FAIL:" + results.at(-1).code));
}
async function expireFixture(owner, keepTokenTimeValid = false) {
  const [record] = await db.select().from(saasSignupVerifications).where(eq(saasSignupVerifications.userId, owner.id)).limit(1);
  assert.ok(record && !record.verifiedAt && !owner.active, "ONLY_FICTIONAL_UNVERIFIED_ROW_MAY_BE_AGED");
  await db.update(saasSignupVerifications).set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000),
    expiresAt: new Date(Date.now() + (keepTokenTimeValid ? 60 * 60_000 : -60 * 60_000)) })
    .where(eq(saasSignupVerifications.id, record.id));
}
async function verify(token) { return req("/api/signup/verify", { body: { token } }); }
let infrastructureOK = false;
try {
  assert.equal(Math.floor(Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num) / 10000), 16);
  assert.deepEqual(await counts(), { users: 0, organizations: 0, subscriptions: 0, memberships: 0 });
  const bootEmail = address("bootstrap");
  const setup = await req("/api/setup", { body: { companyName: "Fictional Bootstrap", name: "Fictional Bootstrap Owner",
    email: bootEmail, password: PASS, setupToken: process.env.SETUP_TOKEN } });
  assert.equal(setup.status, 201, "BOOTSTRAP_SETUP_FAILED");
  const bootBefore = await userByEmail(bootEmail);
  infrastructureOK = true;

  await check("enumeration-normal", async () => {
    const email = address("new");
    const fresh = await signup(email), existing = await signup(bootEmail);
    assert.equal(fresh.status, 202); assert.equal(existing.status, 202);
    compareAnswers(fresh, existing, "ENUMERATION_NORMAL");
    assert.equal(mailedTokens(inbox, email).length, 1);
    assert.equal(mailedTokens(inbox, bootEmail).length, 0);
    assert.deepEqual(await userByEmail(bootEmail), bootBefore);
  });
  await check("squatting-expiry", async () => {
    const email = address("squat");
    assert.equal((await signup(email, { password: OTHER_PASS })).status, 202);
    const before = await userByEmail(email), firstToken = mailedTokens(inbox, email)[0];
    assert.ok(before && !before.active && firstToken);
    const mailCount = inbox.length;
    const duplicate = await signup(email, { password: PASS, company: "Fictional Mailbox Owner" });
    assert.equal(duplicate.status, 202); assertNoSession(duplicate, "pending duplicate");
    assert.equal(inbox.length, mailCount, "PENDING_DUPLICATE_MUST_NOT_MAIL");
    assert.deepEqual(await userByEmail(email), before, "PENDING_DUPLICATE_MUST_NOT_MUTATE_OWNER");
    await expireFixture(before);
    const expiredOriginal = await verify(firstToken);
    assert.equal(expiredOriginal.status, 422); assertNoSession(expiredOriginal, "expired original token");
    const recovered = await signup(email, { password: PASS, company: "Fictional Mailbox Owner" });
    assert.equal(recovered.status, 202); assertNoSession(recovered, "expired recovery");
    const owner = await userByEmail(email);
    finding(owner && owner.id !== before.id, "SQUATTING_EXPIRED");
    assert.equal(owner.active, false);
    const [retired] = await db.select().from(users).where(eq(users.id, before.id)).limit(1);
    assert.ok(retired && !retired.active && retired.email !== email);
    const tokens = mailedTokens(inbox, email); assert.equal(tokens.length, 2);
    const old = await verify(firstToken); assert.equal(old.status, 422); assertNoSession(old, "old token");
    const activated = await verify(tokens[1]); assert.equal(activated.status, 200);
    const cookie = sessionCookieOf(activated, "mailbox owner recovery");
    assert.equal((await req("/api/auth/me", { method: "GET", cookie })).json?.user?.email, email);
    assert.equal((await userByEmail(email)).active, true);
    assert.equal(verifyPassword(PASS, owner.passwordHash), true);
    assert.equal(verifyPassword(OTHER_PASS, owner.passwordHash), false);
    const wrongLogin = await req("/api/auth/login", { body: { email, password: OTHER_PASS } });
    assert.equal(wrongLogin.status, 401); assertNoSession(wrongLogin, "stranger password");
    const replay = await verify(tokens[1]); assert.equal(replay.status, 422); assertNoSession(replay, "one-use replay");
  });

  if (!baseline) {
    await check("verified-and-disabled-verified-protected", async () => {
      const email = address("verified");
      assert.equal((await signup(email)).status, 202);
      assert.equal((await verify(mailedTokens(inbox, email)[0])).status, 200);
      const owner = await userByEmail(email), beforeMail = inbox.length;
      assert.equal((await signup(email, { password: OTHER_PASS })).status, 202);
      assert.deepEqual(await userByEmail(email), owner);
      assert.equal(inbox.length, beforeMail);
      await db.update(users).set({ active: false }).where(eq(users.id, owner.id));
      await db.update(saasSignupVerifications).set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
        .where(eq(saasSignupVerifications.userId, owner.id));
      const disabled = await userByEmail(email);
      assert.equal((await signup(email, { password: OTHER_PASS })).status, 202);
      assert.deepEqual(await userByEmail(email), disabled, "VERIFIED_HISTORY_CANNOT_BE_RECLAIMED");
      assert.equal(inbox.length, beforeMail);
    });
    await check("absolute-expiry-and-no-resend-extension", async () => {
      const email = address("expired");
      assert.equal((await signup(email)).status, 202);
      const token = mailedTokens(inbox, email)[0];
      await expireFixture(await userByEmail(email), true);
      const beforeMail = inbox.length;
      assert.equal((await req("/api/signup/resend", { body: { email } })).status, 200);
      assert.equal(inbox.length, beforeMail, "EXPIRED_PENDING_MUST_NOT_BE_MAILED");
      const expired = await verify(token); assert.equal(expired.status, 422); assertNoSession(expired, "absolute expiry");
      assert.equal((await userByEmail(email)).active, false);
    });
    await check("resend-rotation-and-token-single-use", async () => {
      const email = address("resend");
      assert.equal((await signup(email)).status, 202);
      const old = mailedTokens(inbox, email)[0];
      assert.equal((await req("/api/signup/resend", { body: { email } })).status, 200);
      const tokens = mailedTokens(inbox, email); assert.equal(tokens.length, 2);
      assert.ok(tokens[1] !== old, "RESEND_MUST_ROTATE_TOKEN");
      const stale = await verify(old); assert.equal(stale.status, 422); assertNoSession(stale, "superseded");
      assert.equal((await verify(tokens[1])).status, 200);
      const replay = await verify(tokens[1]); assert.equal(replay.status, 422); assertNoSession(replay, "reused");
      const beforeMail = inbox.length;
      assert.equal((await req("/api/signup/resend", { body: { email } })).status, 200);
      assert.equal(inbox.length, beforeMail);
    });
    for (const expired of [false, true]) await check(expired ? "concurrent-expired-recovery" : "concurrent-new-registration", async () => {
      const email = address(expired ? "race-expired" : "race-new");
      let retired;
      if (expired) {
        assert.equal((await signup(email, { password: OTHER_PASS })).status, 202);
        retired = await userByEmail(email); await expireFixture(retired, true);
      }
      const before = await counts(), beforeMail = inbox.length;
      const [p1, p2] = await Promise.all([proofFor(email), proofFor(email)]);
      const [a, b] = await Promise.all([req("/api/signup", { body: bodyFor(email, { intakeProof: p1 }) }),
        req("/api/signup", { body: bodyFor(email, { intakeProof: p2, password: OTHER_PASS }) })]);
      assert.equal(a.status, 202); assert.equal(b.status, 202); compareAnswers(a, b, "CONCURRENT_RESPONSE_PARITY");
      const after = await counts();
      for (const key of Object.keys(before)) assert.equal(after[key], before[key] + 1, "ONE_COMMITTED_SIGNUP_ONLY");
      const owner = await userByEmail(email); assert.ok(owner && !owner.active);
      if (retired) assert.ok(owner.id !== retired.id);
      assert.equal(inbox.length, beforeMail + 1, "RACE_MUST_MAIL_ONE_REGISTRATION_ONLY");
      const invalid = await verify("0".repeat(48)); assert.equal(invalid.status, 422); assertNoSession(invalid, "no token");
    });
    await check("verification-versus-duplicate-signup", async () => {
      const email = address("race-verify");
      assert.equal((await signup(email)).status, 202);
      const before = await userByEmail(email), token = mailedTokens(inbox, email)[0], beforeMail = inbox.length;
      const proof = await proofFor(email);
      const [activated, duplicate] = await Promise.all([verify(token), req("/api/signup", {
        body: bodyFor(email, { password: OTHER_PASS, intakeProof: proof }) })]);
      assert.equal(activated.status, 200); assert.equal(duplicate.status, 202); assertNoSession(duplicate, "duplicate");
      const owner = await userByEmail(email);
      assert.equal(owner.id, before.id); assert.equal(owner.passwordHash, before.passwordHash); assert.equal(owner.active, true);
      assert.equal(inbox.length, beforeMail);
    });
  }
  if (mode === "invited") {
    if (!baseline) await check("invitation-recipient-and-code-bound", async () => {
      const wrong = address("wrong-invite"), beforeMail = inbox.length;
      assert.equal((await signup(wrong, { privatePilotInviteCode: INVITED_CODE })).status, 422);
      assert.equal(await userByEmail(wrong), undefined);
      assert.equal((await signup(INVITED_EMAIL, { privatePilotInviteCode: "wrong-code-" + "x".repeat(48) })).status, 422);
      assert.equal(await userByEmail(INVITED_EMAIL), undefined); assert.equal(inbox.length, beforeMail);
    });
    await check("enumeration-invited", async () => {
      const beforeMail = inbox.length;
      const fresh = await signup(INVITED_EMAIL, { privatePilotInviteCode: INVITED_CODE });
      assert.ok([201, 202].includes(fresh.status));
      const owner = await userByEmail(INVITED_EMAIL); assert.ok(owner?.active);
      const duplicate = await signup(INVITED_EMAIL, { password: OTHER_PASS, privatePilotInviteCode: INVITED_CODE });
      assert.equal(duplicate.status, 202);
      compareAnswers(fresh, duplicate, "ENUMERATION_INVITED");
      assert.deepEqual(await userByEmail(INVITED_EMAIL), owner);
      assert.equal(inbox.length, beforeMail, "INVITED_BYPASS_MAILS_NOBODY");
      assert.equal((await db.select().from(saasSignupVerifications).where(eq(saasSignupVerifications.userId, owner.id))).length, 0);
    });
  }
  assert.deepEqual(await userByEmail(bootEmail), bootBefore, "BOOTSTRAP_OWNER_UNCHANGED");
} catch {
  infrastructureOK = false;
  console.error("SIGNUP_PROOF_INFRASTRUCTURE_OR_FIXTURE_FAILURE");
} finally {
  const expected = { "enumeration-normal": "ENUMERATION_NORMAL", "squatting-expiry": "SQUATTING_EXPIRED",
    ...(mode === "invited" ? { "enumeration-invited": "ENUMERATION_INVITED" } : {}) };
  const passed = infrastructureOK && (baseline
    ? results.length === Object.keys(expected).length && results.every(row => !row.passed && row.code === expected[row.id])
    : results.length >= 8 && results.every(row => row.passed));
  const paths = ["src/app/api/signup/route.ts", "src/app/api/signup/resend/route.ts", "src/app/api/signup/verify/route.ts",
    "src/lib/signup-pending-recovery.ts", "scripts/qa/tenant-prelogin-http.mjs", "scripts/qa/tenant-signup-findings-http.mjs"];
  const pins = Object.fromEntries(paths.filter(existsSync).map(path => [path, execFileSync("git", ["hash-object", path], { encoding: "utf8" }).trim()]));
  const report = { evidenceLabel: "SOLO_VERIFIED_DEV_RECOVERY", revision, mode, sourceHead: head,
    result: passed ? (baseline ? "EXPECTED_RED" : "PASS") : "FAIL", infrastructureOK, tests: results, httpEvidence, sourcePins: pins,
    coverageCredits: 0, productionCertified: false, externalProviderCalled: false, paidEnrollmentExercised: false,
    realEmailDeliveryTested: false, headerSpoofingBeyondOneTrustedProxyTested: false };
  writeFileSync("/tmp/signup-findings-" + mode + "-" + revision + ".json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (!passed) process.exitCode = 1;
  await new Promise(resolve => sink.close(resolve));
  await pool.end();
}
