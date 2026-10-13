/**
 * Authenticated fictional payroll-draft smoke, ONLY on disposable GitHub CI PG.
 * This creates a Draft but never calculates, approves, releases or pays.
 */
const dbUrl = new URL(process.env.DATABASE_URL || "https://invalid.example/");
if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.CI !== "true" ||
  process.env.DEMO_MODE !== "true" ||
  dbUrl.hostname !== "127.0.0.1" ||
  dbUrl.pathname !== "/app_db"
) {
  throw new Error("DEMO_DRAFT_TEST_REQUIRES_ISOLATED_GITHUB_LOOPBACK_DATABASE");
}

const origin = "http://127.0.0.1:3000";
const headers = { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" };
const login = await fetch(origin + "/api/auth/demo-switch", {
  method: "POST", headers, body: JSON.stringify({ role: "owner" }), redirect: "manual",
});
const loginResult = await login.json().catch(() => ({}));
if (login.status !== 200 || !loginResult.ok || loginResult.organizationId !== 1) {
  throw new Error("DEMO_OWNER_LOGIN_FAILED: HTTP " + login.status);
}
const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
if (!sessionCookie) throw new Error("DEMO_OWNER_SESSION_COOKIE_MISSING");

const response = await fetch(origin + "/api/payroll-runs", {
  method: "POST",
  headers: { ...headers, Cookie: sessionCookie },
  body: JSON.stringify({
    organizationId: 1,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-15",
    payDate: "2026-10-16",
    processNow: false, // Critical: do not calculate or queue this synthetic run
  }),
});
const result = await response.json().catch(() => ({}));
if (
  response.status !== 201 ||
  result.run?.status !== "Draft" ||
  result.run?.organizationId !== 1 ||
  !Number.isInteger(result.run?.legalEntityId) ||
  result.run.legalEntityId <= 0 ||
  result.queue != null ||
  result.processResult != null
) {
  throw new Error("DEMO_DRAFT_API_FAILED_OR_UNSAFE: HTTP " + response.status +
    " / " + (result.code || result.error || "unexpected response state"));
}
console.log("DEMO_DRAFT_VERIFY: PASS (owner authenticated, 201 Draft, assigned legal employer, no calculation/release)");
