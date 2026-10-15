import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WFM_BROWSER_PLAYWRIGHT_MODULE ?? "playwright");
await mkdir("qa-artifacts", { recursive: true });
await build({
  entryPoints: ["tests/fixtures/wfm-employee-receipts-browser.jsx"],
  bundle: true, platform: "browser", jsx: "automatic",
  outfile: "qa-artifacts/wfm-employee-receipts-browser.js",
  // Keep the new unrelated employee preference panel OFF in this receipts-only
  // browser fixture. Otherwise its unexpanded process.env read crashes Chromium.
  define: {
    "process.env.NEXT_PUBLIC_WFM_SCHEDULE_RECEIPTS_ENABLED": '"true"',
    "process.env.NEXT_PUBLIC_WFM_EMPLOYEE_AVAILABILITY_ENABLED": '"false"',
  },
});
const bundle = await readFile("qa-artifacts/wfm-employee-receipts-browser.js");
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? bundle :
    '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  executablePath: process.env.WFM_BROWSER_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 375, height: 812 },
  reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.getByRole("heading", { name: "Review current schedule changes" }).waitFor();
  await page.getByText(/0 acknowledged · 1 awaiting acknowledgment/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Review schedule" }).count(), 1);
  await page.getByRole("button", { name: "Review schedule" }).click();
  await page.getByRole("checkbox", { name: "I have seen the schedule snapshot displayed above." }).check();
  await page.getByRole("button", { name: "Acknowledge this snapshot" }).click();
  await page.getByText("Schedule receipt recorded. Attendance and payroll were not changed.").waitFor();
  await page.getByText(/1 acknowledged · 0 awaiting acknowledgment/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Review schedule" }).count(), 0);
  let posts = await page.evaluate(() => window.posts);
  assert.equal(posts.length, 1);
  assert.deepEqual(Object.keys(posts[0]).sort(), ["acknowledged", "snapshotHash", "workDate"]);
  assert.equal(posts[0].acknowledged, true);

  await page.evaluate(() => window.resetChanged());
  await page.getByRole("button", { name: "Refresh receipts" }).click();
  await page.getByText(/0 acknowledged · 0 awaiting acknowledgment · 1 changed/).waitFor();
  await page.getByRole("button", { name: "Review schedule" }).click();
  await page.getByRole("checkbox", { name: "I have seen the schedule snapshot displayed above." }).check();
  await page.evaluate(() => { window.forceConflict = true; });
  await page.getByRole("button", { name: "Acknowledge this snapshot" }).click();
  await page.getByText("Your schedule changed. Review the refreshed details before acknowledging.").waitFor();
  posts = await page.evaluate(() => window.posts);
  assert.equal(posts.length, 2, "Conflict is never silently retried as another write");
  assert.equal(await page.getByRole("button", { name: "Review schedule" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Acknowledge this snapshot" }).count(), 0,
    "Stale confirmation is cleared on refresh");
  await page.screenshot({ path: "qa-artifacts/wfm-inline-receipt-375px.png", fullPage: true });
  assert.deepEqual(errors, [], "Browser component must not throw");
  console.log("WFM employee receipts Chromium QA PASS (375px, pending -> acknowledgment, changed -> conflict refresh, explicit source-only POST).");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
