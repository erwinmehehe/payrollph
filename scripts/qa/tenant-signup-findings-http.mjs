/**
 * #1898 findings 1/2: independent fictional PG16 HTTP evidence (SOLO_VERIFIED_DEV_RECOVERY).
 * No real SMTP or money. Email tokens come from the single-recipient loopback mailbox only.
 * Must be run under the dedicated guarded CI workflow on a FRESH disposable database.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { requireDisposablePrelogin, clientAddresses, mailedTokens, solveIntakeProof, assertNoSession } from "./tenant-prelogin-contract.mjs";
import { startPreloginSmtpSink } from "./tenant-prelogin-smtp-sink.mjs";

export const INVITED_EMAIL = "signup-invited-recovery@example.invalid";
export const INVITED_CODE = "fictional-loopback-invite-for-signup-findings-2026-only";
const mode = process.env.SIGNUP_FINDINGS_MODE;
if (!["normal", "invited"].includes(mode)) throw new Error("SIGNUP_FINDINGS_REFUSED: explicit normal or invited mode required");
if (mode === "invited") {
  // The original #1898 harness forbids invitations by design. This separate, narrowly
  // guarded mode runs ONLY the fixed fictional email/code pair against the same loopback app.
  requireDisposablePrelogin({ ...process.env, PRIVATE_PILOT_INVITE_ENABLED: "false" });
  const sha = (input) => createHash("sha256").update(input).digest("hex");
  assert.equal(process.env.PRIVATE_PILOT_INVITE_ENABLED, "true", "invite fixture must be explicitly enabled");
  assert.equal(process.env.PRIVATE_PILOT_INVITE_EMAIL_SHA256, sha(INVITED_EMAIL), "fictional recipient bound");
  assert.equal(process.env.PRIVATE_PILOT_INVITE_CODE_SHA256, sha(INVITED_CODE), "fictional invitation bound");
  assert.ok(Date.parse(process.env.PRIVATE_PILOT_INVITE_EXPIRES_AT ?? "") > Date.now(), "invite must be current");
} else {
  requireDisposablePrelogin();
  assert.notEqual(process.env.PRIVATE_PILOT_INVITE_ENABLED, "true");
}
// Safety guard above MUST precede DB/application imports.
const [{ db, pool }, { users }, { saasSignupVerifications }, { eq }] = await Promise.all([
  import("../../src/db/index.ts"),
  import("../../src/db/schema.ts"),
  import("../../src/lib/saas-billing-schema.ts"),
  import("drizzle-orm"),
]);
const BASE = "http://127.0.0.1:3000";
const PASS = "Fictional-Only-Password-2026-X9";
const inbox = [];
const nextIp = clientAddresses();
const sink = await startPreloginSmtpSink(inbox);
const observations = [];

async function req(path, { body, ip = nextIp(), method = "POST" } = {}) {
  const start = performance.now();
  const response = await fetch(BASE + path, {
    method, redirect: "manual", cache: "no-store",
    headers: { origin: BASE, "sec-fetch-site": "same-origin", "x-forwarded-for": ip, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const durationMs = performance.now() - start;
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json, headers: response.headers, durationMs };
}
const signupBody = (email, extra = {}) => ({
  name: "Fictional Signup Owner", company: "Fictional Signup Employer", email, password: PASS,
  acceptTerms: true, ...extra,
});
async function proofFor(email) {
  const boundary = 300_000 - Date.now() % 300_000;
  if (boundary < 15_000) await new Promise(resolve => setTimeout(resolve, boundary + 500));
  const response = await req("/api/intake-challenge", { body: { email } });
  assert.equal(response.status, 200, "intake proof issued");
  assert.equal(response.json?.enabled, true);
  return { token: response.json.token, nonce: solveIntakeProof(response.json.token) };
}
async function signup(email, extra = {}) {
  return req("/api/signup", { body: signupBody(email, { intakeProof: await proofFor(email), ...extra }) });
}
function stableHttpShape(r) {
  return {
    status: r.status, body: r.text,
    headers: [...r.headers.entries()].filter(([name]) => !["date"].includes(name)).sort(([a], [b]) => a.localeCompare(b)),
  };
}
function timingClass(r) {
  return r.durationMs < 400 ? "fast" : r.durationMs < 5000 ? "bounded" : "slow";
}
function assertSamePublicAnswer(a, b, label) {
  assert.deepEqual(stableHttpShape(a), stableHttpShape(b), label + ": status/body/headers must be indistinguishable");
  assert.equal(timingClass(a), timingClass(b), label + ": timing class must match");
  assertNoSession(a, label + " new");
  assertNoSession(b, label + " existing");
}
async function userByEmail(email) {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user ?? null;
}
async function check(name, fn) {
  try {
    await fn();
    observations.push({ name, passed: true });
    console.log("PASS signup-finding: " + name);
  } catch (error) {
    observations.push({ name, passed: false, error: error instanceof Error ? error.message.slice(0, 400) : String(error) });
    console.error("FAIL signup-finding: " + name + " - " + observations.at(-1).error);
  }
}
try {
  assert.equal((await db.select().from(users)).length, 0, "fresh fictional PG16 only");
  const suffix = randomUUID().slice(0, 8);
  const bootEmail = "signup-boot-" + suffix + "@example.invalid";
  const setup = await req("/api/setup", {
    body: { companyName: "Fictional Bootstrap Employer", name: "Fictional Bootstrap Owner",
      email: bootEmail, password: PASS, setupToken: process.env.SETUP_TOKEN },
  });
  assert.equal(setup.status, 201, "safe bootstrap setup");

  await check("normal registered-versus-new status/body/headers/timing", async () => {
    const email = "signup-new-" + suffix + "@example.invalid";
    const bootBefore = await userByEmail(bootEmail);
    const fresh = await signup(email);
    const existing = await signup(bootEmail);
    assert.equal(fresh.status, 202);
    assert.equal(existing.status, 202);
    assertSamePublicAnswer(fresh, existing, "normal signup");
    assert.equal(mailedTokens(inbox, email).length, 1, "mail only to applicant");
    assert.equal(mailedTokens(inbox, bootEmail).length, 0, "no mail to verified foreign address");
    assert.equal((await userByEmail(bootEmail)).passwordHash, bootBefore.passwordHash, "verified account password unchanged");
  });
  await check("expired unverified squatting has bounded recovery, no pending takeover", async () => {
    const email = "signup-squat-" + suffix + "@example.invalid";
    const first = await signup(email);
    assert.equal(first.status, 202);
    const before = await userByEmail(email);
    assert.ok(before && before.active === false);
    const firstTokens = mailedTokens(inbox, email);
    assert.equal(firstTokens.length, 1);

    const mailCount = inbox.length;
    const duplicate = await signup(email, { company: "Hostile Pending Reregistration", password: "Hostile-Only-Password-2026-W8" });
    assert.equal(duplicate.status, 202);
    assertNoSession(duplicate, "unexpired pending duplicate");
    assert.equal(inbox.length, mailCount, "never send mail on a duplicate while pending and unexpired");
    const still = await userByEmail(email);
    assert.equal(still.id, before.id, "a pending account stays owned by the original registration");
    assert.equal(still.passwordHash, before.passwordHash, "a stranger cannot set pending password");

    // Move ONLY fictional, newly-created proof row's clock into the past in this disposable PG16.
    const [verification] = await db.select().from(saasSignupVerifications)
      .where(eq(saasSignupVerifications.userId, before.id)).limit(1);
    assert.ok(verification);
    await db.update(saasSignupVerifications).set({
      createdAt: new Date(Date.now() - 25 * 60 * 60_000),
      expiresAt: new Date(Date.now() - 24 * 60 * 60_000),
    }).where(eq(saasSignupVerifications.id, verification.id));
    const recovered = await signup(email, { company: "Fictional Actual Mailbox Owner" });
    assert.equal(recovered.status, 202);
    const after = await userByEmail(email);
    assert.ok(after && after.id !== before.id, "expired squatted registration must release the address");
    const oldRow = await db.select().from(users).where(eq(users.id, before.id)).limit(1);
    assert.equal(oldRow[0].active, false);
    assert.notEqual(oldRow[0].email, email, "expired user is preserved but can no longer block the email");
    const tokens = mailedTokens(inbox, email);
    assert.equal(tokens.length, 2, "fresh applicant alone receives a new token");
    const oldVerify = await req("/api/signup/verify", { body: { token: firstTokens[0] } });
    assert.equal(oldVerify.status, 422, "expired token must be rejected");
    assertNoSession(oldVerify, "expired token");
    const verified = await req("/api/signup/verify", { body: { token: tokens[1] } });
    assert.equal(verified.status, 200, "mailbox owner can verify recovered account");
    const activated = await userByEmail(email);
    assert.equal(activated.active, true);
    const replay = await req("/api/signup/verify", { body: { token: tokens[1] } });
    assert.equal(replay.status, 422, "one-use token cannot activate twice");
    assertNoSession(replay, "token replay");
    assert.equal((await userByEmail(email)).id, after.id, "verified account cannot be replaced by token replay");
    assert.equal(mailedTokens(inbox, email).length, 2, "no unexpected email after verification");
  });
  await check("expired pending resend cannot prolong the 24-hour account hold", async () => {
    const email = "signup-resend-expired-" + suffix + "@example.invalid";
    const first = await signup(email);
    assert.equal(first.status, 202);
    const owner = await userByEmail(email);
    assert.ok(owner && !owner.active);
    const [verification] = await db.select().from(saasSignupVerifications)
      .where(eq(saasSignupVerifications.userId, owner.id)).limit(1);
    assert.ok(verification);
    await db.update(saasSignupVerifications).set({
      createdAt: new Date(Date.now() - 25 * 60 * 60_000),
      expiresAt: new Date(Date.now() - 24 * 60 * 60_000),
    }).where(eq(saasSignupVerifications.id, verification.id));
    const beforeMail = inbox.length;
    const resend = await req("/api/signup/resend", { body: { email } });
    assert.equal(resend.status, 200);
    assert.equal(inbox.length, beforeMail, "expired pending signup must not be revived or mailed");
  });
  await check("resend rotates an unexpired pending token only once", async () => {
    const email = "signup-resend-" + suffix + "@example.invalid";
    const first = await signup(email);
    assert.equal(first.status, 202);
    const firstToken = mailedTokens(inbox, email)[0];
    assert.ok(firstToken);
    const res = await req("/api/signup/resend", { body: { email } });
    assert.equal(res.status, 200);
    const nextTokens = mailedTokens(inbox, email);
    assert.equal(nextTokens.length, 2);
    assert.notEqual(nextTokens[0], nextTokens[1]);
    const invalid = await req("/api/signup/verify", { body: { token: firstToken } });
    assert.equal(invalid.status, 422);
    assertNoSession(invalid, "superseded token");
    const current = await req("/api/signup/verify", { body: { token: nextTokens[1] } });
    assert.equal(current.status, 200);
    const mailed = inbox.length;
    const verifiedResend = await req("/api/signup/resend", { body: { email } });
    assert.equal(verifiedResend.status, 200);
    assert.equal(inbox.length, mailed, "verified account never receives resend mail");
  });
  await check("concurrent registrations cannot create two active email owners", async () => {
    const email = "signup-race-" + suffix + "@example.invalid";
    const [p1, p2] = await Promise.all([proofFor(email), proofFor(email)]);
    const [a, b] = await Promise.all([
      req("/api/signup", { body: signupBody(email, { intakeProof: p1 }) }),
      req("/api/signup", { body: signupBody(email, { intakeProof: p2 }) }),
    ]);
    assertSamePublicAnswer(a, b, "concurrent registration race");
    const user = await userByEmail(email);
    assert.ok(user && !user.active);
    assert.equal(mailedTokens(inbox, email).length, 1, "unique-email race sends one email only");
  });
  if (mode === "invited") {
    await check("invited-pilot new-versus-existing status/body/headers/timing", async () => {
      const count = inbox.length;
      const first = await signup(INVITED_EMAIL, { privatePilotInviteCode: INVITED_CODE });
      assert.equal((await userByEmail(INVITED_EMAIL))?.active, true, "invitation still creates activated test account");
      const repeat = await signup(INVITED_EMAIL, { privatePilotInviteCode: INVITED_CODE });
      assertSamePublicAnswer(first, repeat, "invited pilot");
      assert.equal(inbox.length, count, "no email on invitation-bypass path");
      assert.equal((await userByEmail(INVITED_EMAIL))?.active, true);
    });
  }
  console.log(JSON.stringify({ evidence: "SOLO_VERIFIED_DEV_RECOVERY", mode,
    tests: observations.map(({ name, passed }) => ({ name, passed })),
    externalProviderCalled: false, paidEnrollmentExercised: false, realEmailDeliveryTested: false,
    trustedProxyHopsBeyondOneTested: false, productionDatabaseUsed: false }));
  assert.ok(observations.every(item => item.passed), "signup findings proof failed: " + observations.filter(item => !item.passed).map(item => item.name).join("; "));
} finally {
  await new Promise(resolve => sink.close(resolve));
  await pool.end();
}
