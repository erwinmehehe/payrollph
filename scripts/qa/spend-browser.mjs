import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({ entryPoints: ["tests/fixtures/spend-reimbursement-browser.jsx"], bundle: true,
  platform: "browser", jsx: "automatic", outfile: "qa-artifacts/spend-browser.js" });
const bundle = await readFile("qa-artifacts/spend-browser.js");
const styles = (await Promise.all((await readdir(".next/static/chunks")).filter(name => name.endsWith(".css"))
  .map(name => readFile(".next/static/chunks/" + name, "utf8")))).join("\n");
const server = createServer((request, response) => {
  const mode = new URL(request.url, "http://localhost").searchParams.get("mode") ?? "checker";
  response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? bundle : '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>' + styles + '</style><div id="root"></div><script>window.fixtureMode='
    + JSON.stringify(["checker", "maker", "employee", "off"].includes(mode) ? mode : "checker")
    + '</script><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ headless: true,
  ...(process.env.QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.QA_CHROMIUM_EXECUTABLE } : {}) });
const report = { result: "FAIL", sourceSha: process.env.PR_HEAD_SHA ?? "local", widths: [1440,390], checks: [],
  boundary: "Actual ExpensesPanel and application CSS with fictional API responses; component coverage, not authenticated app E2E. Actual route/DB security is tested separately." };
try {
  for (const width of report.widths) for (const mode of ["checker", "maker", "employee", "off"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Manila" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let fail = false, empty = false, delay = false, approved = false;
    await page.route("**/api/employees?*", route => route.fulfill({ json: [{ id: 2, firstName: "Fictional", lastName: "Claimant" }] }));
    await page.route("**/api/expenses**", async route => {
      const request = route.request();
      if (request.method() === "PATCH") {
        assert.equal(mode, "checker"); assert.equal(request.postDataJSON().approvedAmount, "450.01");
        approved = true; return route.fulfill({ json: { id: 10, status: "approved" } });
      }
      if (delay) await new Promise(resolve => setTimeout(resolve, 600));
      if (fail) return route.fulfill({ status: 503, json: { error: "Synthetic failure" } });
      const claims = [10,11].map(id => ({ id, employeeId: 2, category: "Travel", description: "Fictional claim " + id,
        amount: "500.00", status: approved && id === 10 ? "approved" : "pending", payrollRunId: null,
        inExpenseReport: false, ...(mode !== "off" ? { canDecide: mode === "checker",
          receiptSha256: id === 10 ? "a".repeat(64) : null,
          receiptVerifiedAt: id === 10 ? "2026-09-08T00:00:00Z" : null } : {}) }));
      return route.fulfill({ json: { claims: empty ? [] : claims, ...(mode !== "off" ? {
        employees: [{ id: 2, firstName: "Fictional", lastName: "Claimant" }],
        reimbursementReviewEnabled: true, receiptUploadsEnabled: true, reviewedCategories: ["Travel"] } : {}) } });
    });
    delay = mode !== "off";
    await page.goto(base + "/?mode=" + mode);
    if (mode !== "off") await page.getByText("Loading expense claims…", { exact: true }).waitFor();
    await page.getByText("Fictional claim 10", { exact: true }).waitFor(); delay = false;
    assert.equal(await page.getByLabel("Approved amount for claim 10").count(), mode === "checker" ? 1 : 0);
    if (mode === "checker") {
      await page.getByLabel("Approved amount for claim 10").fill("450.01");
      assert.equal(await page.getByRole("button", { name: "Approve claim 11", exact: true }).isDisabled(), true);
    }
    if (mode === "maker" || mode === "employee") assert.equal(await page.getByRole("button", { name: /Approve claim/ }).count(), 0);
    if (mode === "off") {
      assert.equal(await page.getByText("Upload receipt", { exact: true }).count(), 0);
      assert.equal(await page.getByText("View scanned receipt", { exact: true }).count(), 0);
    }
    if (mode !== "off") await page.getByRole("region", { name: "Expense claims register" }).evaluate(element => { element.scrollLeft = 0; });
    await page.screenshot({ path: `qa-artifacts/spend-${mode}-${width}.png`, fullPage: true });
    if (mode !== "off") assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, mode + " page overflow at " + width);
    if (mode === "checker") {
      await page.getByRole("button", { name: "Approve claim 10", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "approved" }).waitFor();
      fail = true; await page.reload();
      const retry = page.getByRole("button", { name: "Retry claims" });
      await retry.waitFor();
      assert.equal(await page.getByText("No claims yet.", { exact: true }).count(), 0,
        "a failed reviewed-claims request must not masquerade as an empty successful response");
      await page.screenshot({ path: `qa-artifacts/spend-error-${width}.png`, fullPage: true });
      fail = false; empty = true; await retry.click();
      await retry.waitFor({ state: "hidden" });
      const emptyMessage = page.getByText("No claims yet.", { exact: true });
      await emptyMessage.waitFor();
      assert.equal(await page.getByRole("alert").count(), 0,
        "successful retry must clear the error instead of retaining stale failure UI");
      const emptyTextVisible = await emptyMessage.evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1;
      });
      assert.equal(emptyTextVisible, true,
        "successful empty-state message must be readable without horizontal table scrolling at " + width);
      await page.screenshot({ path: `qa-artifacts/spend-empty-${width}.png`, fullPage: true });
      report.checks.push("Loading, exact approval, receipt-required disabled state, error/retry and empty state at " + width);
    }
    assert.deepEqual(errors, []); report.checks.push(mode + " component controls and layout at " + width);
    await context.close();
  }
  report.result = "PASS";
} finally {
  await writeFile("qa-artifacts/spend-browser-report.json", JSON.stringify(report, null, 2));
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
