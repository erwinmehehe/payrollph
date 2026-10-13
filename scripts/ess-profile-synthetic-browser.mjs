/**
 * Screenshot real authenticated ESS screens in Chromium using fictional roles.
 * Credentials, cookies, and unmasked ID inputs are never saved as artifacts.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import sharp from "sharp";
import { generateTotp } from "../src/lib/totp.ts";

const BASE = "http://127.0.0.1:3000";
const DB = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.CI, "true");
assert.equal(process.env.ESS_PROFILE_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
assert.equal(DB.hostname, "127.0.0.1");
assert.equal(DB.pathname, "/app_db");
assert.equal(process.env.PII_LEGACY_READ_ENABLED, "false");
const fixture = JSON.parse(await readFile("/tmp/ess-profile-synthetic-fixture.json", "utf8"));
await mkdir("qa-artifacts/ess-profile", { recursive: true });

const browser = await chromium.launch({ headless: true });
const checks = [];
const pages = [];
async function authorizedState(role) {
  const context = await browser.newContext();
  const login = await context.request.post(BASE + "/api/auth/login", {
    headers: { origin: BASE, "sec-fetch-site": "same-origin" },
    data: {
      email: role + "@build-block.example.test",
      password: "Synthetic-Build-Block-Only-2026!",
      totpCode: generateTotp("JBSWY3DPEHPK3PXP"),
    },
  });
  assert.equal(login.status(), 200, role + " MFA login");
  const state = await context.storageState();
  assert.ok(state.cookies.some(cookie => cookie.name.includes("session")));
  await context.close();
  return state; // memory only: never saved
}
async function open(roleState, width) {
  const context = await browser.newContext({
    storageState: roleState,
    viewport: { width, height: 844 },
  });
  const page = await context.newPage();
  pages.push(page);
  return { context, page };
}
async function fit(page, label) {
  const rect = await page.evaluate(() => ({
    visibleWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (rect.scrollWidth > rect.visibleWidth + 1) {
    const offenders = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .map(node => {
        const box = node.getBoundingClientRect();
        return { tag: node.tagName.toLowerCase(),
          classes: typeof node.className === "string" ? node.className.slice(0, 100) : "",
          left: Math.round(box.left), right: Math.round(box.right),
          width: Math.round(box.width) };
      })
      .filter(box => box.width > 0 && box.right > window.innerWidth + 1 && box.left < window.innerWidth)
      .sort((a, b) => b.right - a.right).slice(0, 14));
const surfaces = await page.evaluate(() => [...document.querySelectorAll(
      "html, body, .app-shell, .topbar, .content-area, .people-layout, .card, .panel-disclosure, .data-table-wrap, .mobile-bottom-nav, .tabs, .topbar-actions"
    )].map(node => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        classes: typeof node.className === "string" ? node.className.slice(0, 80) : "",
        x: Math.round(box.x), right: Math.round(box.right), width: Math.round(box.width),
        client: node.clientWidth, scroll: node.scrollWidth, minWidth: style.minWidth,
        overflowX: style.overflowX, display: style.display
      };
    }).filter(item => item.width || item.scroll).slice(0, 55));
    console.error("ESS_MOBILE_OVERFLOW", JSON.stringify({ label, ...rect, offenders, surfaces }));
    await page.screenshot({ path: "qa-artifacts/ess-profile/overflow-diagnostic-390.png", fullPage: true });
  }
  assert.ok(rect.scrollWidth <= rect.visibleWidth + 1, label + " horizontal overflow");
  checks.push(label + " fits viewport");
}
async function employeeProfile(state, width) {
  const { page, context } = await open(state, width);
  await page.goto(BASE + "/app", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("button", { name: "Open profile" }).click();
  const profile = page.locator(".ess-profile-extensions");
  await profile.waitFor({ timeout: 60_000 });
  await page.getByRole("heading", { name: "Government ID numbers & credentials" }).waitFor();
  await page.locator(".ess-id-tile").filter({ hasText: "BIR TIN" }).getByRole("button", { name: "Request correction" }).waitFor();
  await fit(page, "Employee profile " + width);
  await profile.screenshot({ path: "qa-artifacts/ess-profile/employee-" + width + "-approved-empty-photo.png" });
  checks.push("Employee profile " + width + " existing approved ID and empty photo");
  await context.close();
}
async function peopleReview(state, width, pending = false) {
  const { page, context } = await open(state, width);
  await page.goto(BASE + "/app?organizationId=" + fixture.organizationA, {
    waitUntil: "domcontentloaded", timeout: 60_000,
  });
  if (width < 600) {
    await page.getByRole("navigation", { name: "Mobile workspace navigation" })
      .getByRole("button", { name: "Employees", exact: true }).click();
  } else {
    await page.locator('[data-nav-name="People"]:visible').first().click();
  }
  await page.locator('.app-shell[data-workspace-page="People"]').waitFor();
  const disclosure = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: "Government ID verification" }),
  }).first();
  await disclosure.waitFor({ timeout: 60_000 });
  if (!(await disclosure.getAttribute("open"))) await disclosure.locator("summary").click();
  const review = disclosure.locator(".ess-hr-review");
  await review.waitFor();
  if (pending) await review.getByText("Pending verification").first().waitFor({ timeout: 60_000 });
  else await review.getByText("No employee ID changes are awaiting verification.").waitFor({ timeout: 60_000 });
  await fit(page, "HR review " + width);
  await review.screenshot({
    path: "qa-artifacts/ess-profile/hr-" + width + (pending ? "-pending.png" : "-empty.png"),
  });
  checks.push("HR review " + width + (pending ? " pending" : " empty"));
  return { context, page, review };
}

try {
  const employeeState = await authorizedState("employee");
  const hrState = await authorizedState("hr");
  await employeeProfile(employeeState, 1440);
  await employeeProfile(employeeState, 390);
  await peopleReview(hrState, 1440, false).then(async ({ context }) => context.close());
  await peopleReview(hrState, 390, false).then(async ({ context }) => context.close());

  // Exercise the actual employee SSS correction form at phone size.
  const { page, context } = await open(employeeState, 390);
  await page.goto(BASE + "/app", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.getByRole("button", { name: "Open profile" }).click();
  await page.locator(".ess-id-tile").filter({ hasText: "SSS number" })
    .getByRole("button", { name: "Add ID number" }).click();
  const form = page.locator(".ess-id-form");
  await form.locator("#ess-id-value").fill("12");
  await form.getByRole("button", { name: "Send to HR for verification" }).click();
  await page.locator(".ess-profile-card").getByRole("alert").first().waitFor();
  await page.locator(".ess-profile-extensions").screenshot({
    path: "qa-artifacts/ess-profile/employee-390-invalid-id.png",
  });
  checks.push("390px ID validation error visible");
  await form.locator("#ess-id-value").fill("1234567890");
  const pending = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/self/identifiers" &&
    response.request().method() === "POST");
  await form.getByRole("button", { name: "Send to HR for verification" }).click();
  assert.equal((await pending).status(), 201);
  await page.getByText("Awaiting HR review").first().waitFor();
  await page.locator(".ess-profile-extensions").screenshot({
    path: "qa-artifacts/ess-profile/employee-390-pending.png",
  });
  checks.push("390px employee pending request posted");

  // Use a real uploaded PNG: the UI crops it and posts an encrypted JPEG.
  const portrait = await sharp({ create: {
    width: 120, height: 120, channels: 3, background: { r: 60, g: 130, b: 190 },
  } }).png().toBuffer();
  const uploaded = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/self/photo" &&
    response.request().method() === "POST");
  await page.getByLabel("Select profile picture").setInputFiles({
    name: "fictional.png", mimeType: "image/png", buffer: portrait,
  });
  assert.equal((await uploaded).status(), 200);
  await page.getByRole("status").filter({ hasText: "Profile picture updated." }).waitFor();
  await page.locator(".ess-profile-extensions").screenshot({
    path: "qa-artifacts/ess-profile/employee-390-uploaded.png",
  });
  const removed = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/self/photo" &&
    response.request().method() === "DELETE");
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  assert.equal((await removed).status(), 200);
  await page.getByRole("status").filter({ hasText: "Profile picture removed." }).waitFor();
  checks.push("390px employee photo upload and removal");
  await fit(page, "Employee pending+photo 390");
  await context.close();

  await peopleReview(hrState, 1440, true).then(async ({ context }) => context.close());
  const hr = await peopleReview(hrState, 390, true);
  await hr.review.getByRole("button", { name: "Review request" }).click();
  await hr.review.getByLabel("Full verified SSS number").fill("1234567890");
  await hr.review.getByRole("checkbox", {
    name: "I checked this number against an appropriate HR or agency record.",
  }).check();
  const reviewed = hr.page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/employee-identifier-requests" &&
    response.request().method() === "POST");
  await hr.review.getByRole("button", { name: "Verify & apply" }).click();
  assert.equal((await reviewed).status(), 200);
  await hr.review.getByText("Verified ID applied to the employee record.").waitFor();
  await hr.review.screenshot({ path: "qa-artifacts/ess-profile/hr-390-approved.png" });
  checks.push("390px HR verified ID and applied to employee record");
  await hr.context.close();

  // A fresh employee session sees the approved request; other tenant's
  // pre-existing photo is still available after A's upload and delete.
  const proof = await open(employeeState, 1440);
  const idResponse = await proof.context.request.get(BASE + "/api/self/identifiers");
  assert.equal(idResponse.status(), 200);
  const ids = await idResponse.json();
  assert.equal(ids.current.sssNo.hasValue, true);
  assert.ok(ids.requests.some(row => row.kind === "sssNo" && row.status === "approved"));
  await proof.context.close();

  await writeFile("qa-artifacts/ess-profile/browser-result.json", JSON.stringify({
    status: "PASS", syntheticOnly: true, desktop: 1440, mobile: 390,
    checks, productionAccepted: false, cookiesSaved: false,
  }, null, 2));
  console.log("ESS browser acceptance PASS:", checks.length, "checks.");
} catch (error) {
  console.error("ESS browser acceptance FAIL:", error instanceof Error ? error.message : "unknown");
  throw error;
} finally {
  await browser.close();
}
