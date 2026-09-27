import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { passwordIssues, validEmail } from "../src/lib/validation";
import { activeMailProvider, deliveryCapable } from "../src/lib/mail-provider";

const read = (path: string) => readFileSync(path, "utf8");

test("sign-in has its own route so the product page stays previewable", () => {
  assert.ok(existsSync("src/app/login/page.tsx"), "/login must exist");
  const root = read("src/app/page.tsx");
  assert.ok(root.includes("if (!user) return <SoftwareHome />"), "logged-out visitors must see the product page, not a login wall");
  assert.ok(root.includes('user.role === "employee"'), "employees must still reach self-service");
});

test("login screen never hardcodes demo credentials", () => {
  const source = read("src/components/auth-screen.tsx");
  // Credentials may exist only inside the demoMode-gated hint, never as form state.
  assert.ok(!source.includes('useState("celine@linaw.ph")'), "login screen must not pre-fill an email");
  assert.ok(!source.includes('useState("LinawDemo2026!")'), "login screen must not pre-fill a password");
  assert.ok(source.includes("{demoMode && ("), "credential hint must be inside a demoMode gate");

  // The credential hint may only render inside a demoMode-gated block, and the
  // gate must be supplied by the route that renders the login screen.
  const loginRoute = read("src/app/login/page.tsx");
  assert.ok(loginRoute.includes("demoMode={DEMO_MODE}"), "/login must pass the demo flag explicitly");
});

test("stale rate-limit claim is gone from the auth screen", () => {
  const source = read("src/components/auth-screen.tsx");
  assert.ok(!source.includes("single-instance"), "auth screen still claims single-instance rate limiting");
  assert.ok(source.includes("distributed"), "auth screen should state the real distributed limiter");
});

test("reset flow no longer depends on a token returned in the response", () => {
  const source = read("src/components/auth-screen.tsx");
  assert.ok(!source.includes("demoResetToken"), "client must not read a reset token out of the HTTP response");
});

test("email links point at routes that actually exist", () => {
  const forgot = read("src/app/api/auth/forgot-password/route.ts");
  const invitations = read("src/app/api/invitations/route.ts");

  assert.ok(forgot.includes("`${origin}/reset-password?token="), "reset email must link to /reset-password");
  assert.ok(invitations.includes("`${origin}/invite?token="), "invite email must link to /invite");

  // The pages those links point at must exist on disk.
  assert.ok(read("src/app/reset-password/page.tsx").length > 0);
  assert.ok(read("src/app/invite/page.tsx").length > 0);
});

test("reset and invite pages render the token-consuming form", () => {
  assert.ok(read("src/components/reset-password-form.tsx").includes("/api/auth/reset-password"));
  assert.ok(read("src/components/invite-accept-form.tsx").includes("/api/invitations/accept"));
});

test("password policy matches the server, so the UI cannot diverge", () => {
  assert.deepEqual(passwordIssues("Str0ngPassphrase"), []);
  assert.ok(passwordIssues("weak").length >= 2);
});

test("mail delivery is only claimed when a provider is configured", () => {
  const configured = activeMailProvider({ RESEND_API_KEY: "test" } as never);
  assert.equal(configured, "resend");
  assert.equal(deliveryCapable({} as never), false);
  assert.equal(activeMailProvider({} as never), "none");
});

test("employees can carry an email so payslip mail is addressable", () => {
  const schema = read("src/db/schema.ts");
  assert.ok(/employees = pgTable[\s\S]*?email: varchar\("email"/.test(schema));
});
