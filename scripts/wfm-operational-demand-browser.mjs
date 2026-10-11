import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/wfm-operational-demand-browser.jsx"],
  bundle: true, platform: "browser", jsx: "automatic",
  outfile: "qa-artifacts/wfm-operational-demand-browser.js",
});
const bundle = await readFile("qa-artifacts/wfm-operational-demand-browser.js");
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
  await page.getByRole("heading", { name: "Compare staffing forecasts with reported business activity" }).waitFor();
  await page.getByText("25.0%").waitFor();
  assert.equal(await page.locator("[data-wfm-workload-forecasts] tbody tr").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Import aggregate counts" }).isDisabled(), true,
    "Unacknowledged aggregate demand must never enable submission.");
  assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === "POST"))).length, 0,
    "No consent must never submit any demand data.");
  await page.getByLabel("Aggregate CSV (Philippine time +08:00)").fill(
    "intervalStart,observedCount,quality,revision\n2026-10-10T09:00:00+08:00,24,complete,1"
  );
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Import aggregate counts" }).click();
  await page.getByText(/Recorded 1 aggregate interval revisions/).waitFor();
  assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === "POST"))).length, 1);

  await page.getByLabel("Aggregate CSV (Philippine time +08:00)").fill(
    "intervalStart,observedCount,quality,revision\n2026-10-10T09:00:00+08:00,24,complete,1,private-customer-id"
  );
  await page.getByRole("button", { name: "Import aggregate counts" }).click();
  await page.getByText(/four aggregate CSV columns/).waitFor();
  assert.equal((await page.evaluate(() => window.requests.filter(x => x.method === "POST"))).length, 1,
    "Unexpected customer fields must not be posted.");

  await page.getByLabel("Worksite").selectOption("6");
  await page.getByText(/Insufficient complete, recent matching weekday/).waitFor();
  assert.equal(await page.locator("[data-wfm-workload-forecasts] tbody tr").count(), 0);
  await page.evaluate(() => window.renderTenant(200));
  await page.getByRole("alert").getByText("Workforce manager access is required.").waitFor();
  assert.equal(await page.locator("[data-wfm-workload-forecasts] tbody tr").count(), 0);
  const requests = await page.evaluate(() => window.requests);
  assert.equal(requests.some(r => /payroll|payout|attendance|scheduling/.test(r.path ?? "")), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "qa-artifacts/wfm-operational-demand-375px.png", fullPage: true });
  console.log("Operational demand Chromium browser PASS: 375px, consent, CSV PII rejection, site/account switch and no payroll calls.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
