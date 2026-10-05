import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { passwordIssues, validEmail } from "../src/lib/validation";
import { activeMailProvider, deliveryCapable } from "../src/lib/mail-provider";

const read = (path: string) => readFileSync(path, "utf8");

test("sign-in and workspace have dedicated routes so the product page always stays public", () => {
  assert.ok(existsSync("src/app/login/page.tsx"), "/login must exist");
  assert.ok(existsSync("src/app/app/page.tsx"), "/app must exist");
  assert.ok(existsSync("src/app/workspace/page.tsx"), "legacy /workspace redirect must exist");
  const root = read("src/app/page.tsx");
  const app = read("src/app/app/page.tsx");
  const workspaceRedirect = read("src/app/workspace/page.tsx");
  const authScreen = read("src/components/auth-screen.tsx");
  assert.ok(root.includes("<SoftwareHome />"), "root must render the product page");
  assert.ok(!root.includes("getSessionUser"), "root must not turn into the dashboard for signed-in visitors");
  assert.ok(app.includes("getSessionUser"), "app must enforce the authenticated session");
  assert.ok(app.includes('user.role === "employee"'), "employees must still reach self-service");
  assert.ok(workspaceRedirect.includes("permanentRedirect"), "legacy workspace route must redirect");
  assert.ok(authScreen.includes('window.location.href = "/app"'), "successful sign-in must enter the app route");
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

test("auth screen keeps a truthful user-facing rate-limit proof point", () => {
  const source = read("src/components/auth-screen.tsx");
  assert.ok(!source.includes("single-instance"), "auth screen still claims single-instance rate limiting");
  assert.ok(source.includes("Rate-limited sign in"), "auth screen should state that sign-in is rate limited without exposing infrastructure jargon");
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


test("employee self-service signs out with POST instead of navigating to the API route", () => {
  const selfService = read("src/components/self-service-portal.tsx");
  assert.ok(
    selfService.includes('fetch("/api/auth/logout", { method: "POST" })'),
    "employee sign out must call the POST-only logout endpoint",
  );
  assert.ok(
    selfService.includes('window.location.href = "/login"'),
    "successful employee sign out must return to login",
  );
  assert.ok(
    !selfService.includes('href="/api/auth/logout"'),
    "employee sign out must never navigate to the POST-only API route with GET",
  );
});
