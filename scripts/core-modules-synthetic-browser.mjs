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
let page;
try {
  for (const role of ["owner", "hr", "manager", "employee"]) {
    for (const width of [1280, 390]) {
      for (const [state, port] of [["before", 3001], ["after", 3000]]) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        page = await context.newPage();
        const base = `http://127.0.0.1:${port}`;
        const login = await context.request.post(base + "/api/auth/login", {
          headers: { origin: base, "sec-fetch-site": "same-origin" },
          data: { email: role + "@build-block.example.test", password: "Synthetic-Build-Block-Only-2026!", totpCode: generateTotp("JBSWY3DPEHPK3PXP") },
        });
        assert.equal(login.status(), 200, "Synthetic MFA sign-in must pass");
        await page.goto(base + "/app?organizationId=" + fixture.organizationId, { waitUntil: "domcontentloaded" });
        if (role === "owner" && state === "after") {
          const more = page.locator('[data-nav-name="More modules"]:visible').first();
          if (width === 390 && !(await more.count())) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
          await more.waitFor({ timeout: 60000 });
          await more.click();
          const panel = page.getByRole("region", { name: "More modules" });
          await panel.waitFor();
          const spend = panel.getByLabel("Enable Spend and benefits", { exact: true });
          if (await spend.isChecked()) await spend.uncheck();
          await page.waitForFunction(() => [...document.querySelectorAll('input[type="checkbox"]')].every(el => !el.disabled));
          await panel.screenshot({ path: `qa-artifacts/core-modules/owner-${width}-empty.png` });
          await spend.check();
          await page.waitForFunction(() => [...document.querySelectorAll('input[type="checkbox"]')].every(el => !el.disabled));
          assert.equal(await spend.isChecked(), true);
          await panel.screenshot({ path: `qa-artifacts/core-modules/owner-${width}-enabled.png` });
          const bounds = await panel.evaluate(el => ({ right: el.getBoundingClientRect().right, width: window.innerWidth }));
          assert.ok(bounds.right <= bounds.width + 1, "Module screen fits phone width");
          await spend.uncheck();
          await page.waitForFunction(() => [...document.querySelectorAll('input[type="checkbox"]')].every(el => !el.disabled));
        } else {
          assert.equal(await page.locator('[data-nav-name="More modules"]').count(), 0);
          if (state === "after") {
            const denied = await context.request.patch(base + "/api/tenant-modules", { headers: { origin: base }, data: { organizationId: fixture.organizationId, moduleId: "spend", enabled: true } });
            assert.equal(denied.status(), 403, role + " cannot enable modules");
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
