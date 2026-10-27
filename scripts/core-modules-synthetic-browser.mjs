import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { generateTotp } from "../src/lib/totp.ts";

assert.equal(process.env.CI, "true");
assert.equal(process.env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");
const fixture = JSON.parse(await readFile("/tmp/build-block-fixture.json", "utf8"));
await mkdir("qa-artifacts/core-modules", { recursive: true });
const browser = await chromium.launch({ headless: true });
const checkpoints = [];
// One real MFA login per role AND per flag-on/flag-off server, then reuse it
// across viewports. Different local origins are independently authenticated;
// a cookie issued on :3001 must not be relied upon for :3000's role-denial proof.
// Two sign-ins per role (8 total) stay below the real 10/minute IP limit.
const roleAuthState = new Map();
let page;
try {
  for (const role of ["owner", "hr", "manager", "employee"]) {
    for (const width of [1280, 390]) {
      for (const [state, port] of [["before", 3001], ["after", 3000]]) {
        const authKey = `${role}:${state}`;
        const savedAuthState = roleAuthState.get(authKey);
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          ...(savedAuthState ? { storageState: savedAuthState } : {}),
        });
        page = await context.newPage();
        const base = `http://127.0.0.1:${port}`;
        if (!savedAuthState) {
          // Exercise the actual rate limiter, never disable it. Two Next.js
          // instances share this fixture's PostgreSQL/IP login counter, so
          // a previous screenshot may temporarily exhaust the 60s window.
          // Retry at most once, only for a server-advertised bounded window.
          let login;
          for (let attempt = 0; attempt < 2; attempt++) {
            login = await context.request.post(base + "/api/auth/login", {
              headers: { origin: base, "sec-fetch-site": "same-origin" },
              data: {
                email: role + "@build-block.example.test",
                password: "Synthetic-Build-Block-Only-2026!",
                totpCode: generateTotp("JBSWY3DPEHPK3PXP"),
              },
            });
            if (login.status() !== 429 || attempt === 1) break;
            const limited = await login.json().catch(() => ({}));
            const waitMs = Number(limited.retryAfterMs);
            // An account lockout has no bounded retryAfterMs: fail closed.
            if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 60_000) break;
            await new Promise(resolve => setTimeout(resolve, Math.max(250, Math.ceil(waitMs) + 250)));
          }
          assert.equal(login.status(), 200, "Synthetic MFA sign-in must pass for role: " + role);
          roleAuthState.set(authKey, await context.storageState());
        }
        await page.goto(base + "/app?organizationId=" + fixture.organizationId, { waitUntil: "domcontentloaded" });
        // A 401 is not evidence of authorization denial. Confirm that the
        // actual session belongs to this role on this exact origin, even
        // after the app page has rendered, before testing role-based 403.
        // The production-mode test app sets a Secure, HttpOnly session cookie.
        // Use the real browser's same-origin fetch (not Playwright's separate
        // Node API client) for authenticated HTTP checks on loopback HTTP.
        assert.equal(new URL(page.url()).origin, base, "Browser must remain on the expected local server");
        const session = await page.evaluate(async () => {
          const response = await fetch("/api/auth/me", {
            credentials: "same-origin", cache: "no-store",
          });
          return { status: response.status, body: await response.json() };
        });
        assert.equal(session.status, 200, role + " session probe must respond");
        assert.equal(session.body.user?.role, role, role + " must remain signed in on " + state + " server");
        assert.equal(session.body.user?.email, role + "@build-block.example.test",
          role + " must be the exact seeded principal on " + state + " server");
        if (role === "owner" && state === "after") {
          const more = page.locator('[data-nav-name="More modules"]:visible').first();
          // CSS keeps the sidebar present in the DOM while translated offscreen on phones.
          // Open the real mobile drawer instead of relying on :visible/count().
          const openNav = page.getByRole("button", { name: "Open navigation", exact: true });
          if (await openNav.isVisible()) {
            await openNav.click();
            await page.locator(".app-shell.drawer-open").waitFor();
          }
          await more.waitFor({ timeout: 60000 });
          await more.click();
          const panel = page.getByRole("region", { name: "More modules" });
          await panel.waitFor();
          const spend = panel.getByLabel("Enable Spend and benefits", { exact: true });
          async function setSpend(enabled) {
            if (await spend.isChecked() === enabled) return;
            const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/tenant-modules" && response.request().method() === "PATCH");
            await spend.click();
            assert.equal((await saved).status(), 200, "Module mutation must persist");
            await page.waitForFunction(expected => {
              const input = [...document.querySelectorAll("label")].find(label => label.textContent.includes("Enable Spend and benefits"))?.querySelector("input");
              return input && !input.disabled && input.checked === expected;
            }, enabled);
          }
          await setSpend(false);
          await panel.screenshot({ path: `qa-artifacts/core-modules/owner-${width}-empty.png` });
          await setSpend(true);
          assert.equal(await spend.isChecked(), true);
          await panel.screenshot({ path: `qa-artifacts/core-modules/owner-${width}-enabled.png` });
          const bounds = await panel.evaluate(el => ({ right: el.getBoundingClientRect().right, width: window.innerWidth }));
          assert.ok(bounds.right <= bounds.width + 1, "Module screen fits phone width");
          await setSpend(false);
        } else {
          assert.equal(await page.locator('[data-nav-name="More modules"]').count(), 0);
          if (state === "after") {
            // Browser fetch carries the real production-mode Secure session,
            // so an unauthenticated 401 can never satisfy this 403 role check.
            const deniedStatus = await page.evaluate(async organizationId => {
              const response = await fetch("/api/tenant-modules", {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ organizationId, moduleId: "spend", enabled: true }),
              });
              return response.status;
            }, fixture.organizationId);
            assert.equal(deniedStatus, 403, role + " cannot enable modules");
          }
        }
        await page.screenshot({ path: `qa-artifacts/core-modules/${role}-${width}-${state}.png`, fullPage: true });
        if (role === "owner") {
          await page.goto(base + "/app?organizationId=" + fixture.existingId, { waitUntil: "domcontentloaded" });
          await page.locator('[data-nav-name="Overview"]').first().waitFor({ timeout: 60000 });
          assert.equal(await page.locator('[data-nav-name="More modules"]').count(), 0, "Existing employer remains legacy");
          await page.screenshot({ path: `qa-artifacts/core-modules/existing-${width}-${state}.png`, fullPage: true });
        }
        checkpoints.push({ role, width, state });
        await context.close();
      }
    }
  }
  await writeFile("qa-artifacts/core-modules/result.json", JSON.stringify({ result: "PASS", sourceSha: process.env.GITHUB_SHA, checkpoints, syntheticOnly: true, productionAccepted: false }, null, 2));
} catch (error) {
  await page?.screenshot({ path: "qa-artifacts/core-modules/failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
