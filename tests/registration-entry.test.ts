import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("registration uses one destination for /signup and /register", () => {
  const register = read("src/app/register/page.tsx");
  assert.ok(register.includes('redirect("/signup")'));

  const nav = read("src/components/marketing/site-chrome.tsx");
  assert.ok(nav.includes('<Link href="/signup">Sign up</Link>'));
  assert.ok(nav.includes('href="/signup">Sign up / request access</Link>'));
});

test("signup preserves gated tenant creation and does not promise an instant account in invitation mode", () => {
  const signup = read("src/app/signup/page.tsx");
  const api = read("src/app/api/signup/route.ts");
  const request = read("src/components/marketing/access-request-form.tsx");
  assert.ok(signup.includes("publicSelfServeReady()"));
  assert.ok(api.includes("if (!publicSelfServeReady())"));
  assert.ok(api.includes("enforceIntakeProof"));
  assert.ok(api.includes("saasSignupVerifications"));
  assert.ok(request.includes("This is an access request, not an instant account."));
  assert.ok(request.includes("No user account or company workspace has been created yet."));
});

test("the login page does not fail entirely when the setup-status database query fails", () => {
  const login = read("src/app/login/page.tsx");
  assert.ok(login.includes("accountStatusUnavailable = true;"));
  assert.ok(login.includes("registrationAvailable={publicSelfServeReady()}"));
  assert.ok(login.includes("demoMode={DEMO_MODE}"));
});

test("sign-in has an accessible second-factor backup-code path", () => {
  const screen = read("src/components/auth-screen.tsx");
  const api = read("src/app/api/auth/login/route.ts");
  assert.ok(screen.includes("setUseBackupCode"));
  assert.ok(screen.includes("backupCode: useBackupCode"));
  assert.ok(screen.includes("Use a saved recovery code instead"));
  assert.ok(api.includes("body.backupCode"));
  assert.ok(api.includes("findMatchingBackupCode"));
});

test("verification email retry uses the server's rate-limited resend endpoint", () => {
  const signup = read("src/components/marketing/self-serve-signup-form.tsx");
  const resend = read("src/app/api/signup/resend/route.ts");
  assert.ok(signup.includes('fetch("/api/signup/resend"'));
  assert.ok(signup.includes("Resend verification email"));
  assert.ok(signup.includes("deliveryConfirmed"));
  assert.ok(resend.includes("rateLimitDistributed"));
  assert.ok(resend.includes("const GENERIC"));
});
