import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { signupMode } from "../src/lib/saas-launch-config";

const read = (path: string) => readFileSync(path, "utf8");

test("only one canonical signup destination exists for marketing, trial and register", () => {
  const register = read("src/app/register/page.tsx");
  const trial = read("src/app/trial/page.tsx");
  const nav = read("src/components/marketing/site-chrome.tsx");
  const signup = read("src/app/signup/page.tsx");
  assert.ok(register.includes('redirect("/signup")'));
  assert.ok(trial.includes('redirect("/signup")'));
  assert.ok(nav.includes('<Link href="/signup">Sign up</Link>'));
  assert.ok(nav.includes('<Link href="/signup">Create an account</Link>'));
  assert.ok(!signup.includes("AccessRequestForm"));
  assert.ok(signup.includes("<SelfServeSignupForm"));
  assert.ok(signup.includes('mode={mode}'));
  assert.ok(!signup.includes("Request trial access"));
});

test("pilot registration is independently gated by email delivery and HTTPS base URL", () => {
  const base = { NODE_ENV: "production", APP_BASE_URL: "https://payrollsoftware.ph", RESEND_API_KEY: "test" } as const;
  assert.equal(signupMode({ ...base, PUBLIC_SIGNUP_MODE: "pilot" }), "pilot");
  assert.equal(signupMode({ ...base, PUBLIC_SIGNUP_MODE: "paid" }), "disabled");
  assert.equal(signupMode({ ...base, PUBLIC_SIGNUP_MODE: "unknown" }), "disabled");
  assert.equal(signupMode({ ...base, APP_BASE_URL: "http://localhost:3000", PUBLIC_SIGNUP_MODE: "pilot" }), "disabled");
  assert.equal(signupMode({ NODE_ENV: "production", APP_BASE_URL: "https://payrollsoftware.ph", PUBLIC_SIGNUP_MODE: "pilot" }), "disabled");
  const billed = { ...base, PUBLIC_SIGNUP_MODE: "paid", XENDIT_BILLING_ENABLED: "true",
    XENDIT_SECRET_KEY: "test", XENDIT_CALLBACK_TOKEN: "test", XENDIT_BUSINESS_ID: "test" } as const;
  assert.equal(signupMode(billed), "disabled", "Xendit alone cannot bypass signed-off self-service launch");
  assert.equal(signupMode({ ...billed, SELF_SERVE_SIGNUP_ENABLED: "true" }), "paid");
});

test("pilot API creates trial entitlements and ignores user-submitted billing prices", () => {
  const api = read("src/app/api/signup/route.ts");
  assert.ok(api.includes("const mode = signupMode()"));
  assert.ok(api.includes("const plan = isPilot ? \"Core\" : body.plan;"));
  assert.ok(api.includes("const seats = isPilot ? 10 : safeSeats(body.seats);"));
  assert.ok(api.includes('quote = { plan: "Core", seats: 10, amountCents: 0 }'));
  assert.ok(api.includes('status: isPilot ? "trialing" : "pending_payment"'));
  assert.ok(api.includes('provider: isPilot ? "pilot" : null'));
  assert.ok(api.includes("trialEndsAt"));
  assert.ok(api.includes("enforceSameOriginMutation"));
  assert.ok(api.includes("enforceIntakeProof"));
  assert.ok(api.includes("saasSignupVerifications"));
  assert.ok(api.includes("rateLimitDistributed"));
});

test("verification continues into workspace only for server-stored pilot accounts", () => {
  const verification = read("src/app/api/signup/verify/route.ts");
  assert.ok(verification.includes('subscription.provider === "pilot"'));
  assert.ok(verification.includes('redirectTo: verified.pilot ? "/app" : "/billing/setup"'));
  assert.ok(read("src/components/marketing/verify-signup-form.tsx").includes('window.location.assign(data.redirectTo || "/app")'));
  assert.ok(read("src/app/app/page.tsx").includes('billing.status === "pending_payment"'));
  assert.ok(read("src/lib/saas-workspace-access.ts").includes("requireSaasPaidWrites"));
});

test("login is resilient to unavailable setup status and points only to signup", () => {
  const login = read("src/app/login/page.tsx");
  const screen = read("src/components/auth-screen.tsx");
  assert.ok(login.includes("accountStatusUnavailable = true;"));
  assert.ok(login.includes("registrationAvailable={publicSignupReady()}"));
  assert.ok(login.includes("demoMode={DEMO_MODE}"));
  assert.ok(screen.includes('href="/signup"'));
  assert.ok(!screen.includes("Request access to a company account"));
  assert.ok(screen.includes("setUseBackupCode"));
  assert.ok(screen.includes("backupCode: useBackupCode"));
});

test("registration retains email resend and generic privacy-preserving responses", () => {
  const client = read("src/components/marketing/self-serve-signup-form.tsx");
  const resend = read("src/app/api/signup/resend/route.ts");
  assert.ok(client.includes('fetch("/api/signup/resend"'));
  assert.ok(client.includes("Resend verification email"));
  assert.ok(client.includes("deliveryConfirmed"));
  assert.ok(client.includes("No card required"));
  assert.ok(resend.includes("rateLimitDistributed"));
  assert.ok(resend.includes("const GENERIC"));
});
