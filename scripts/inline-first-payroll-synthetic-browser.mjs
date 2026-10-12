import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import pg from "pg";
import { generateTotp } from "../src/lib/totp.ts";
assert.equal(process.env.CI, "true");
assert.equal(process.env.INLINE_FIRST_PAYROLL_ACCEPTANCE_MODE, "synthetic-postgres-only");
const base = "http://127.0.0.1:3000";
const address = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(address.hostname));
assert.equal(address.pathname, "/app_db");
const fixture = JSON.parse(await readFile("qa-artifacts/inline-first-payroll-fixture.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const report = { result: "FAIL", checkpoints: [], syntheticOnly: true };
let page;
async function login(role) {
  const context = await browser.newContext();
  const response = await context.request.post(base + "/api/auth/login", { headers: { origin: base }, data: { email: `inline-${role}@example.test`, password: "Synthetic-Inline-QA-Only-2026!" } });
  assert.equal(response.status(), 200, await response.text());
  const p = await context.newPage();
  await p.goto(base + `/app?organizationId=${fixture.organizationId}`);
  const journey = p.getByRole("region", { name: "Inline first payroll journey" });
  await journey.waitFor();
  // Enroll the fictional member through the same inline account controls.
  // Production MFA stays enabled throughout this acceptance journey.
  await journey.getByText("Account security (MFA)", { exact: true }).click();
  await journey.getByLabel("Confirm current password", { exact: true }).fill("Synthetic-Inline-QA-Only-2026!");
  const [begin] = await Promise.all([
    p.waitForResponse(r => r.url().includes("/api/auth/totp/setup") && r.request().method() === "POST"),
    journey.getByRole("button", { name: "Enable two-factor", exact: true }).click(),
  ]);
  assert.ok(begin.ok());
  const enrollment = await begin.json();
  await journey.getByLabel("Authenticator code", { exact: true }).fill(generateTotp(enrollment.secret));
  const [verified] = await Promise.all([
    p.waitForResponse(r => r.url().includes("/api/auth/totp/setup") && r.request().method() === "POST"),
    journey.getByRole("button", { name: "Verify & enable", exact: true }).click(),
  ]);
  assert.ok(verified.ok());
  await journey.getByText("Account security (MFA)", { exact: true }).click();
  return { context, page: p };
}
async function mutateAndWait(button, path, method) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes(path) && r.request().method() === method),
    button.click(),
  ]);
  assert.ok(response.ok(), await response.text());
}
async function snapshot() {
  return (await client.query(`SELECT
    (SELECT count(*) FROM payroll_runs) AS runs,
    (SELECT count(*) FROM payroll_entries) AS entries,
    (SELECT count(*) FROM payslips) AS payslips,
    (SELECT count(*) FROM payroll_jobs) AS jobs,
    (SELECT count(*) FROM compensation_events) AS ledger,
    (SELECT count(*) FROM audit_events) AS audit,
    (SELECT jsonb_agg(to_jsonb(s)) FROM sessions s) AS sessions,
    (SELECT jsonb_agg(to_jsonb(p)) FROM first_payroll_journey_progress p) AS progress`)).rows;
}
try {
  const owner = await login("owner"); page = owner.page;
  const startUrl = page.url();
  const journey = page.getByRole("region", { name: "Inline first payroll journey" });
  await journey.getByRole("button", { name: "Review company", exact: true }).click();
  const company = page.getByRole("region", { name: "Confirm employer setup", exact: true });
  await company.getByLabel("Company name", { exact: true }).fill("Synthetic Inline Employer");
  await company.getByLabel("Legal employer name").fill("Synthetic Inline Employer Inc.");
  await company.getByLabel("Employer TIN").fill("123456789");
  await company.getByLabel("Cutoff start").fill("2026-10-01");
  await company.getByLabel("Cutoff end").fill("2026-10-15");
  await company.getByLabel("Pay date").fill("2026-10-15");
  await mutateAndWait(company.getByRole("button", { name: "Save company and pay schedule" }), "/api/first-payroll-journey", "PATCH");
  await mutateAndWait(journey.getByRole("button", { name: "Send to hr", exact: true }).first(), "/api/first-payroll-journey", "PATCH");
  assert.equal(page.url(), startUrl);
  await owner.context.close();
  report.checkpoints.push("Owner saves employer and schedule inline, then hands roster to HR");
  const hr = await login("hr"); page = hr.page;
  const hrUrl = page.url();
  const people = page.getByRole("region", { name: "Add people and payout details", exact: true });
  await people.waitFor();
  await people.getByRole("button", { name: /Add employee/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add employee", exact: true });
  await dialog.getByLabel("First name", { exact: true }).fill("Synthetic");
  await dialog.getByLabel("Last name", { exact: true }).fill("Worker");
  await dialog.getByLabel("TIN", { exact: true }).fill("123456789");
  await dialog.getByLabel("Bank / payout code").fill("BDO");
  await dialog.getByLabel("Account number").fill("1234567890");
  await dialog.getByLabel("Monthly rate").fill("30000");
  await dialog.getByLabel("Start date").fill("2026-10-01");
  await dialog.getByLabel(/^Rest day/).selectOption("Sunday");
  await dialog.getByRole("button", { name: "Create & onboard" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Review attendance", exact: true }).click();
  const time = page.getByRole("region", { name: "Review attendance and period inputs", exact: true });
  await mutateAndWait(time.getByRole("button", { name: "Lock payroll cutoff", exact: true }).last(), "/api/workforce/attendance-locks", "POST");
  assert.equal(page.url(), hrUrl);
  await mutateAndWait(page.getByRole("button", { name: "Send to payroll", exact: true }), "/api/first-payroll-journey", "PATCH");
  await hr.context.close();
  report.checkpoints.push("Second member resumes stored handoff, adds first worker and reviews cutoff inline");
  const finance = await login("payroll"); page = finance.page;
  const payroll = page.getByRole("region", { name: "Calculate and inspect payroll", exact: true });
  await payroll.waitFor();
  await page.waitForLoadState("networkidle");
  await client.query("UPDATE sessions s SET last_seen_at = now() - interval '10 minutes' FROM users u WHERE u.id = s.user_id AND u.email = 'inline-payroll@example.test'");
  const before = await snapshot();
  await payroll.getByRole("button", { name: "Calculate read-only preview" }).click();
  await payroll.getByRole("status").filter({ hasText: "Preview ready" }).waitFor();
  assert.equal(await payroll.getByRole("row").count() >= 2, true);
  assert.deepEqual(await snapshot(), before, "Preview request cannot write even session last-seen data");
  const denied = await page.evaluate(async organizationId => {
    const response = await fetch(`/api/first-payroll-journey/preview?organizationId=${organizationId}`, { credentials: "same-origin" });
    return response.status;
  }, fixture.foreignOrganizationId);
  assert.equal(denied, 403);
  const checker = await login("checker");
  const wrongRole = await checker.page.evaluate(async organizationId => {
    const response = await fetch(`/api/first-payroll-journey/preview?organizationId=${organizationId}`, { credentials: "same-origin" });
    return response.status;
  }, fixture.organizationId);
  assert.equal(wrongRole, 403);
  await checker.context.close(); await finance.context.close();
  report.checkpoints.push("Finance resumes, reaches preview ready, database stays unchanged and foreign tenant/checker are denied");
  report.result = "PASS";
} catch (error) {
  await page?.screenshot({ path: "qa-artifacts/inline-first-payroll-failed.png", fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile("qa-artifacts/inline-first-payroll-browser.json", JSON.stringify(report, null, 2));
  await client.end(); await browser.close();
}
