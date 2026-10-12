import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

/** Disposable DB + localhost only. Saves real Chromium evidence, never mockups. */
assert.equal(process.env.CI, "true");
assert.equal(process.env.HRIS_JOURNEY_ACCEPTANCE_MODE, "synthetic-postgres-only");
const base = process.env.HRIS_JOURNEY_ACCEPTANCE_URL;
assert.ok(["http://127.0.0.1:3000","http://127.0.0.1:3001"].includes(base));
assert.equal(new URL(base).hostname,"127.0.0.1");
const database = new URL(process.env.DATABASE_URL ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.equal(database.pathname, "/app_db");
assert.equal(process.env.OPENAI_API_KEY ?? "", "");
const mode = process.env.FIRST_PAYROLL_INLINE_CAPTURE_MODE;
assert.ok(["before", "after"].includes(mode), "Capture mode before or after required");
await mkdir("qa-artifacts", { recursive: true });
const browser = await chromium.launch({ headless: true });
const widths = [320, 375, 390, 430, 1440];
const report = {
  sha: process.env.GITHUB_SHA ?? "local",
  mode, acceptance: "synthetic-localhost-chromium-only",
  humanOperatorAccepted: false, physicalDeviceAccepted: false,
  realEmployerReconciliationAccepted: false,
  screenshotPaths: [], checkpoints: [], result: "FAIL",
};
try {
  for (const role of ["owner", "payroll"]) {
    const email = role === "owner"
      ? "first-payroll-owner@example.test"
      : "hcm-payroll@example.test";
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 812 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        const login = await context.request.post(base + "/api/auth/login", {
          headers: { origin: base, "sec-fetch-site": "same-origin" },
          data: { email, password: "Synthetic-HCM-QA-Password-Only-2026!" },
        });
        assert.equal(login.status(), 200, role + " login must succeed");
        await page.goto(base + "/app?organizationId=1",
          { waitUntil: "domcontentloaded" });
        const inline = page.getByRole("region", { name: "Inline first-payroll journey" });
        const legacy = page.getByRole("region", { name: "First payroll setup readiness" });
        if (mode === "before") {
          await legacy.waitFor({ timeout: 60000 });
          assert.equal(await inline.count(), 0);
          assert.equal(await legacy.getByRole("list", { name: "Guided first payroll journey" })
            .getByRole("listitem").count(), 7);
          const disabled = await page.evaluate(async () => {
            const response = await fetch("/api/first-payroll/progress?organizationId=1");
            return response.status;
          });
          assert.equal(disabled, 404, "Flag off must disable new endpoints");
        } else {
          await inline.waitFor({ timeout: 60000 });
          assert.equal(await legacy.count(), 0);
          const topSteps = inline.locator(":scope > ol > li");
          assert.equal(await topSteps.count(), 7);
          assert.ok((await topSteps.nth(4).innerText()).includes("Calculate and inspect payroll"));
          if (role === "owner") {
            assert.ok(await inline.getByRole("button", { name: /Send to hr/ }).count() >= 1);
          } else {
            assert.equal(await inline.getByRole("button", { name: /^Send to / }).count(), 0);
          }
          await topSteps.nth(4).getByRole("button", { name: "Open step" }).click();
          const payrollStep = inline.locator("#first-payroll-step-payroll");
          await payrollStep.getByRole("button", {
            name: "Preview employee payroll (no writes)",
          }).waitFor({ timeout: 30000 });
          await payrollStep.getByRole("button", { name: "Preview employee payroll (no writes)" }).click();
          const preview = payrollStep.getByRole("region", {
            name: "First payroll per-employee preview",
          });
          await preview.waitFor({ timeout: 60000 });
          assert.ok((await preview.innerText()).includes("blockers"));
          // Synthetic fixture contains a missing payout; actual draft/approval
          // must not be offered as if preview were a real payroll release.
          assert.equal(await payrollStep.getByRole("button", {
            name: "Create first payroll DRAFT (no release)",
          }).isEnabled(), false);
          assert.doesNotMatch(await preview.innerText(), /enc:v1:|BANK_DATA_ENCRYPTION_KEY/);
        }
        const bounds = await page.evaluate(() => ({
          viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        }));
        assert.ok(bounds.scrollWidth <= bounds.viewport + 2,
          mode + " " + role + " " + width + "px page-level horizontal overflow: "
            + JSON.stringify(bounds));
        const artifact = `qa-artifacts/first-payroll-inline-${mode}-${role}-${width}.png`;
        await page.screenshot({ path: artifact, fullPage: true });
        report.screenshotPaths.push(artifact);
        assert.deepEqual(errors, []);
        report.checkpoints.push({ role, width, state: mode, overflow: false });
      } finally {
        await context.close();
      }
    }
  }
  report.result = "PASS";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await writeFile("qa-artifacts/first-payroll-inline-" + mode + ".json",
    JSON.stringify(report, null, 2) + "\n");
  await browser.close();
}
