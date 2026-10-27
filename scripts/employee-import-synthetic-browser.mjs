import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { generateTotp } from "../src/lib/totp.ts";
import { importFixtureCsv } from "../tests/fixtures/employee-import-500.ts";

assert.equal(process.env.CI, "true");
assert.equal(process.env.BUILD_BLOCK_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL).pathname, "/app_db");
const fixture = JSON.parse(await readFile("/tmp/build-block-fixture.json", "utf8"));
await mkdir("qa-artifacts/employee-import", { recursive: true });
const browser = await chromium.launch({ headless: true });
const checkpoints = [];
// Each role has its own genuine MFA session for each flag-on/flag-off server.
// Keep those authenticated cookies isolated by role and server, then reuse them
// only for desktop/phone views. Eight sign-ins stay below the real IP rate limit.
const authenticatedStates = new Map();
let page;
try {
  for (const role of ["owner", "hr", "manager", "employee"]) {
    for (const width of [1280, 390]) {
      for (const [state, port] of [["before", 3001], ["after", 3000]]) {
        const authKey = `${role}:${state}`;
        const priorState = authenticatedStates.get(authKey);
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          ...(priorState ? { storageState: priorState } : {}),
        });
        page = await context.newPage();
        const base = `http://127.0.0.1:${port}`;
        if (!priorState) {
          // Preserve the actual login limiter: retry only once for a bounded
          // server-advertised 429 window, never for credentials or MFA failures.
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
            if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > 60_000) break;
            await new Promise(resolve => setTimeout(resolve, Math.max(250, Math.ceil(waitMs) + 250)));
          }
          assert.equal(login.status(), 200, "Synthetic MFA sign-in must pass for " + authKey);
          const signedInState = await context.storageState();
          assert.ok(signedInState.cookies.some(cookie => cookie.name.includes("session")), "MFA session cookie must exist");
          authenticatedStates.set(authKey, signedInState);
        }
        await page.goto(base + "/app?organizationId=" + fixture.organizationId, { waitUntil: "domcontentloaded" });
        // The employee-import denial must be a genuine role-denial, not an
        // unauthenticated 401 caused by a separate Node API cookie jar.
        // Confirm the precise signed-in principal on the active browser origin.
        assert.equal(new URL(page.url()).origin, base, "Browser must remain on the selected flag server");
        const session = await page.evaluate(async () => {
          const response = await fetch("/api/auth/me", {
            credentials: "same-origin", cache: "no-store",
          });
          return { status: response.status, body: await response.json() };
        });
        assert.equal(session.status, 200, role + " session probe must respond");
        assert.equal(session.body.user?.role, role, role + " must be signed in on " + state + " server");
        assert.equal(session.body.user?.email, role + "@build-block.example.test",
          role + " must be the exact fictional principal on " + state + " server");
        if (["owner", "hr"].includes(role)) {
          // On phone layouts the sidebar remains in the DOM but is translated off-screen.
          // Playwright :visible still matches it, so open the actual mobile drawer first.
          const openNav = page.getByRole("button", { name: "Open navigation", exact: true });
          if (await openNav.isVisible()) {
            await openNav.click();
            await page.locator(".app-shell.drawer-open").waitFor();
          }
          await page.locator('[data-nav-name="People"]:visible').first().click();
          const administration = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Employee administration" }) }).first();
          await administration.waitFor({ timeout: 60000 });
          if (!(await administration.getAttribute("open"))) await administration.locator("summary").click();
          if (state === "before") {
            // Flag-off preserves the existing employer CSV upload and validation
            // workflow. The opt-in atomic preview remains separately gated.
            const legacy = page.getByRole("heading", { name: "Import employees from a spreadsheet" });
            await legacy.waitFor();
            const container = legacy.locator("xpath=ancestor::article[1]");
            await container.getByRole("link", { name: /Template/i }).waitFor();
            await container.getByRole("button", { name: "Import CSV" }).click();
            await container.getByRole("button", { name: "Validate only" }).waitFor();
            await container.getByRole("button", { name: "Import employees", exact: true }).waitFor();
            assert.equal(await page.getByRole("region", { name: "Employee CSV import preview" }).count(), 0);
          } else {
            const panel = page.getByRole("region", { name: "Employee CSV import preview" });
            await panel.waitFor();
            await panel.screenshot({ path: `qa-artifacts/employee-import/${role}-${width}-empty.png` });
            await panel.getByLabel("CSV file").setInputFiles({ name: "500-synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(importFixtureCsv()) });
            const previewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/employees/import" && response.request().method() === "POST");
            await panel.getByRole("button", { name: "Preview upload" }).click();
            assert.equal((await previewResponse).status(), 200, "Entitled synthetic tenant must receive a preview");
            await panel.getByRole("status").filter({ hasText: "500 rows" }).waitFor();
            assert.match(await panel.innerText(), /500 rows · 20 errors · 0 warnings/);
            assert.equal(await panel.getByRole("button", { name: "Commit selected rows" }).isDisabled(), true);
            await panel.getByLabel("Filter results").selectOption("error");
            assert.equal(await panel.locator("tbody tr").count(), 20);
            const csvLink = await panel.getByRole("link", { name: "Download error CSV" }).getAttribute("href");
            assert.equal(decodeURIComponent(csvLink.split(",").slice(1).join(",")).split("\n").length, 21);
            await panel.getByRole("button", { name: "Skip all error rows" }).click();
            assert.equal(await panel.getByRole("button", { name: "Commit selected rows" }).isDisabled(), true);
            const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/employees/import" && response.request().method() === "POST");
            await panel.getByRole("button", { name: "Refresh preview" }).click();
            assert.equal((await refreshed).status(), 200);
            await panel.getByRole("button", { name: "Commit selected rows" }).waitFor();
            await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(b => b.textContent === "Commit selected rows")?.disabled);
            const bounds = await panel.evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: window.innerWidth }));
            assert.ok(bounds.left >= -1 && bounds.right <= bounds.width + 1, "Panel fits phone width");
            await panel.screenshot({ path: `qa-artifacts/employee-import/${role}-${width}-preview.png` });
          }
        } else {
          assert.equal(await page.getByRole("region", { name: "Employee CSV import preview" }).count(), 0);
          if (state === "after") {
            // Use the real browser's same-origin session for the POST, never
            // the separate Playwright Node request client with Secure cookies.
            const deniedStatus = await page.evaluate(async ({ organizationId, csv }) => {
              const response = await fetch("/api/employees/import", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ organizationId, action: "preview", csv }),
              });
              return response.status;
            }, { organizationId: fixture.organizationId, csv: importFixtureCsv() });
            assert.equal(deniedStatus, 403, role + " cannot import");
          }
        }
        await page.screenshot({ path: `qa-artifacts/employee-import/${role}-${width}-${state}.png`, fullPage: true });
        checkpoints.push({ role, width, state });
        await context.close();
      }
    }
  }
  await writeFile("qa-artifacts/employee-import/result.json", JSON.stringify({ result: "PASS", sourceSha: process.env.GITHUB_SHA, checkpoints, syntheticOnly: true, productionAccepted: false }, null, 2));
} catch (error) {
  await page?.screenshot({ path: "qa-artifacts/employee-import/failure.png", fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
