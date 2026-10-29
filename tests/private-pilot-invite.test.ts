import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { privatePilotInviteReady, validPrivatePilotInvite } from "../src/lib/private-pilot-invite";
import { signupMode, signupRateLimitResponse } from "../src/lib/saas-launch-config";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const code = "a".repeat(48);
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://payrollsoftware.ph",
  PUBLIC_SIGNUP_MODE: "pilot",
  PRIVATE_PILOT_INVITE_ENABLED: "true",
  PRIVATE_PILOT_INVITE_EMAIL_SHA256: digest("invited@example.test"),
  PRIVATE_PILOT_INVITE_CODE_SHA256: digest(code),
  PRIVATE_PILOT_INVITE_EXPIRES_AT: "2099-12-31T23:59:59Z",
};

test("private pilot invitation is explicitly enabled, scoped to one email and expires", () => {
  assert.equal(privatePilotInviteReady(env), true);
  assert.equal(validPrivatePilotInvite(" invited@example.test ", code, env), true);
  assert.equal(validPrivatePilotInvite("INVITED@EXAMPLE.TEST", code, env), true);
  assert.equal(validPrivatePilotInvite("attacker@example.test", code, env), false);
  assert.equal(validPrivatePilotInvite("invited@example.test", "b".repeat(48), env), false);
  assert.equal(validPrivatePilotInvite("invited@example.test", "weak", env), false);
  assert.equal(validPrivatePilotInvite("invited@example.test", code.slice(1), env), false);
  assert.equal(privatePilotInviteReady({ ...env, PRIVATE_PILOT_INVITE_ENABLED: "false" }), false);
  assert.equal(privatePilotInviteReady({ ...env, PRIVATE_PILOT_INVITE_EXPIRES_AT: "2001-01-01T00:00:00Z" }), false);
  assert.equal(privatePilotInviteReady({ ...env, PRIVATE_PILOT_INVITE_CODE_SHA256: "not a hash" }), false);
  assert.equal(validPrivatePilotInvite("invited@example.test", code, {
    ...env, PRIVATE_PILOT_INVITE_EXPIRES_AT: "2001-01-01T00:00:00Z",
  }), false);
});

test("pilot can open with an unexpired private code even without an email sender", () => {
  assert.equal(signupMode(env), "pilot");
  assert.equal(signupMode({ ...env, PRIVATE_PILOT_INVITE_ENABLED: "false" }), "disabled");
  assert.equal(signupMode({ ...env, PRIVATE_PILOT_INVITE_EXPIRES_AT: "2001-01-01T00:00:00Z" }), "disabled");
  assert.equal(signupMode({ ...env, APP_BASE_URL: "http://localhost:3000" }), "disabled");
  assert.equal(signupMode({ ...env, PUBLIC_SIGNUP_MODE: "paid" }), "disabled");
  assert.equal(signupMode({ ...env, PUBLIC_SIGNUP_MODE: "paid",
    XENDIT_BILLING_ENABLED: "true", SELF_SERVE_SIGNUP_ENABLED: "true",
    XENDIT_SECRET_KEY: "fake", XENDIT_CALLBACK_TOKEN: "fake", XENDIT_BUSINESS_ID: "fake" }), "disabled");
});

test("registration refuses per-process rate-limit fallback at all three gates", async () => {
  assert.equal(signupRateLimitResponse({ allowed: true, mode: "distributed-postgres" }), null);
  const throttled = signupRateLimitResponse({ allowed: false, mode: "distributed-postgres" });
  assert.equal(throttled?.status, 429);
  assert.equal(throttled?.headers.get("Cache-Control"), "no-store");
  for (const allowed of [true, false]) {
    const unavailable = signupRateLimitResponse({ allowed, mode: "single-instance" });
    assert.equal(unavailable?.status, 503);
    assert.equal(unavailable?.headers.get("Cache-Control"), "no-store");
    assert.match((await unavailable!.json()).error, /temporarily unavailable/);
  }
  const api = readFileSync("src/app/api/signup/route.ts", "utf8");
  assert.equal((api.match(/signupRateLimitResponse\(/g) ?? []).length, 3,
    "IP, email-domain and email quota must all use the fail-closed decision");
});

test("one guarded signup endpoint never grants a public applicant unverified access", () => {
  const api = readFileSync("src/app/api/signup/route.ts", "utf8");
  const page = readFileSync("src/app/signup/page.tsx", "utf8");
  const ui = readFileSync("src/components/marketing/self-serve-signup-form.tsx", "utf8");
  assert.ok(api.includes("validPrivatePilotInvite(email, inviteCode)"));
  assert.ok(api.includes("if (isPilot && !deliveryCapable() && !invitedPilot)"));
  assert.ok(api.includes("active: invitedPilot"));
  assert.ok(api.includes("if (token)"));
  assert.ok(api.includes("emailVerified: false"));
  assert.ok(api.includes('status: isPilot ? "trialing" : "pending_payment"'));
  assert.ok(api.includes('amountCents: 0'));
  assert.ok(api.includes('enforceSameOriginMutation'));
  assert.ok(api.includes('enforceIntakeProof'));
  assert.ok(api.includes('rateLimitDistributed'));
  assert.ok(!api.includes("process.env.PRIVATE_PILOT_INVITE_CODE"));
  assert.ok(page.includes("privateInviteEnabled={privateInviteEnabled}"));
  assert.ok(ui.includes("required={!emailDeliveryAvailable}"));
  assert.ok(ui.includes('fetch("/api/signup"'));
  const proofClient = readFileSync("src/lib/public-intake-proof-client.ts", "utf8");
  assert.ok(proofClient.includes('fetch("/api/intake-challenge"'), "client must ask the authoritative server whether proof is required");
  assert.ok(!proofClient.includes('process.env.NEXT_PUBLIC_PUBLIC_INTAKE_PROOF_ENABLED'), "a stale build-time flag must not skip an enabled server gate");
  assert.ok(ui.includes('fetch("/api/signup/resend"'));
  assert.ok(ui.includes("Your private pilot account is ready"));
  assert.ok(ui.includes("setPrivatePilotInviteCode(\"\")"));
  assert.ok(readFileSync("src/app/register/page.tsx", "utf8").includes('redirect("/signup")'));
  assert.ok(readFileSync("src/app/trial/page.tsx", "utf8").includes('redirect("/signup")'));
});
