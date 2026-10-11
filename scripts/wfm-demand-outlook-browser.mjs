import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WFM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/wfm-demand-outlook-browser.jsx"],
  bundle: true, platform: "browser", jsx: "automatic",
  outfile: "qa-artifacts/wfm-demand-outlook-browser.js",
});
const bundle = await readFile("qa-artifacts/wfm-demand-outlook-browser.js");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle :
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: process.env.WFM_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByRole("heading", { name: "Preview staffing needs from past weekly patterns" }).waitFor();
  await page.getByText(/Historical staffing-plan consistency only|Read-only staffing-plan preview/).first().waitFor();
  await page.getByText("25.0%").waitFor();
  assert.equal(await page.locator("[data-wfm-demand-outlook-rows] tbody tr").count(), 2);
  await page.screenshot({ path: "qa-artifacts/wfm-demand-outlook-375px.png", fullPage: true });

  await page.getByLabel("Role filter").selectOption("3");
  assert.equal(await page.locator("[data-wfm-demand-outlook-rows] tbody tr").count(), 1);
  await page.getByLabel("Planning horizon").selectOption("14");
  await page.getByText("25.0%").waitFor();

  await page.getByLabel("Worksite").selectOption("6");
  await page.getByText("Not enough same-weekday historical staffing requirements.").waitFor();
  assert.equal(await page.locator("[data-wfm-demand-outlook-rows] tbody tr").count(), 0,
    "Switching sites must not retain a previous site's inferred headcount.");

  await page.evaluate(() => window.rerenderForEmployer(200));
  await page.getByRole("alert").getByText("Workforce manager access is required.").waitFor();
  assert.equal(await page.locator("[data-wfm-demand-outlook-rows] tbody tr").count(), 0,
    "Another employer's preview must disappear on account switch.");
  const calls = await page.evaluate(() => window.requests);
  assert.ok(calls.length >= 3);
  assert.ok(calls.every(c => c.method === "GET"));
  assert.deepEqual(errors, [], "No Chromium script errors are permitted.");
  console.log("WFM demand outlook Chromium QA PASS: 375px, role/site/horizon switching, insufficient source, cross-employer isolation, zero mutations.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
