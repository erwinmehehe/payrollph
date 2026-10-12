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
        if (["owner", "hr"].includes(role)) {
          await page.locator('[data-nav-name="People"]:visible').first().click();
          const administration = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "Employee administration" }) }).first();
          await administration.waitFor({ timeout: 60000 });
          if (!(await administration.getAttribute("open"))) await administration.locator("summary").click();
          if (state === "before") {
            await page.getByRole("heading", { name: "Import employees from a spreadsheet" }).waitFor();
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
            const denied = await context.request.post(base + "/api/employees/import", { headers: { origin: base }, data: { organizationId: fixture.organizationId, action: "preview", csv: importFixtureCsv() } });
            assert.equal(denied.status(), 403, role + " cannot import");
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
