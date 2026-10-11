import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/wfm-issued-demand-browser.jsx"],
  bundle: true, platform: "browser", jsx: "automatic",
  outfile: "qa-artifacts/wfm-issued-demand-browser.js",
});
const bundle = await readFile("qa-artifacts/wfm-issued-demand-browser.js");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle :
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", err => errors.push(err.message));
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByRole("heading", { name: "Issue forecasts now. Score against later actuals." }).waitFor();
  await page.getByText("Awaiting future actuals").waitFor();
  assert.equal(await page.locator("[data-wfm-issued-demand-records] tbody tr").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Issue future forecast" }).isDisabled(), true,
    "No explicit acknowledgment must never permit issue.");
  assert.equal(await page.getByRole("button", { name: "Finalize score" }).isDisabled(), true);
  await page.screenshot({ path: "qa-artifacts/wfm-issued-demand-375px.png", fullPage: true });

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Issue future forecast" }).click();
  await page.getByText(/Forecast #88 issued/).waitFor();
  await page.getByRole("button", { name: "Finalize score" }).click();
  await page.getByText(/Missing: 1/).waitFor();
  assert.equal((await page.evaluate(() => window.requests.filter(x => x.action === "score"))).length, 1,
    "Unsettled score must not silently retry or finalize.");

  await page.evaluate(() => { window.readyToScore = true; });
  await page.getByRole("button", { name: "Finalize score" }).click();
  await page.getByText("Frozen evidence").waitFor();
  await page.getByText(/25.0% WAPE/).waitFor();

  await page.getByLabel("Worksite").selectOption("6");
  await page.getByText(/No issued forecasts for this worksite/).waitFor();
  assert.equal(await page.locator("[data-wfm-issued-demand-records] tbody tr").count(), 0);
  await page.evaluate(() => window.renderTenant(200));
  await page.getByRole("alert").getByText("Workforce manager access is required.").waitFor();
  assert.equal(await page.locator("[data-wfm-issued-demand-records] tbody tr").count(), 0);
  const requests = await page.evaluate(() => window.requests);
  assert.ok(requests.every(x => !/payroll|payout|attendance|schedule-override/.test(x.path || "")));
  assert.deepEqual(errors, [], "Chromium should have no uncaught UI exceptions.");
  console.log("Issued future demand Chromium PASS: 375px, consent, pending actuals, final score, cross-site and cross-tenant isolation, no roster/payroll writes.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
