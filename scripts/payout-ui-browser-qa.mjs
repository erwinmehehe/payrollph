import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const root = process.cwd();
const artifacts = resolve(process.env.PAYOUT_UI_ARTIFACT_DIR || "qa-artifacts/payout-ui");
await mkdir(artifacts, { recursive: true });
const beforeSha = process.env.PAYOUT_UI_BEFORE_SHA;
if (beforeSha) assert.match(beforeSha, /^[a-f0-9]{40}$/);
const bundles = {};
for (const variant of beforeSha ? ["before", "after"] : ["after"]) {
  const plugins = variant === "before" ? [{ name: "reviewed-before-components", setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/]components[\\/](?:payout-profiles-panel|workspace[\\/](?:exports|xendit-payout-panel))\.tsx$/ }, async ({ path }) => {
      const relative = path.slice(root.length + 1).replaceAll("\\", "/");
      return { contents: execFileSync("git", ["show", `${beforeSha}:${relative}`], { encoding: "utf8" }),
        loader: "tsx", resolveDir: dirname(path) };
    });
  } }] : [];
  const result = await build({ entryPoints: ["scripts/qa/payout-ui-entry.tsx"], bundle: true,
    platform: "browser", format: "iife", jsx: "automatic", write: false,
    alias: { "@": resolve(root, "src") }, plugins,
    define: { "process.env.NODE_ENV": '"production"' } });
  bundles[variant] = result.outputFiles[0].text;
}
// Use the actual application stylesheet; no product styles are changed for QA.
const cssPath = resolve(root, "src/app/globals.css");
const globalCss = await readFile(cssPath, "utf8");
const compiled = await postcss([tailwindcss({ base: root })]).process(globalCss, { from: cssPath });
const additionalCss = await Promise.all(["workspace-theme", "dashboard-design", "workspace-panels", "ess-mobile", "premium-dashboard", "phase-two"]
  .map(name => readFile(resolve(root, `src/app/${name}.css`), "utf8")));
const css = compiled.css + additionalCss.join("\n");
const server = createServer((req, res) => {
  if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  if (req.url === "/before.js" || req.url === "/after.js") {
    res.setHeader("Content-Type", "application/javascript"); res.end(bundles[req.url.slice(1, -3)]); return;
  }
  res.setHeader("Content-Type", "text/html");
  const variant = req.url?.includes("variant=before") ? "before" : "after";
  res.end(`<!doctype html><html style="--font-inter:Inter,Arial,sans-serif;--font-jetbrains-mono:monospace"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/${variant}.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PAYOUT_UI_BROWSER_CHANNEL ? { channel: process.env.PAYOUT_UI_BROWSER_CHANNEL } : {}) });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    let mode = "ready", payoutMode = "verified", xenditGets = 0, releaseLoading = null;
    const posts = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const req = route.request();
      assert.ok(req.url().startsWith(base), "No external provider request allowed");
      if (req.method() !== "GET") { posts.push(req.postDataJSON()); await route.fulfill({ status: 503, json: { error: "Synthetic QA never sends money" } }); return; }
      if (req.url().includes("/payout-reconciliation")) {
        const verified = {
          organizationId: payoutMode === "foreign" ? 2 : 1,
          runId: 1, runNetPay: "8000.00", runEmployeeCount: 1,
          periodLabel: "October 1–15, 2026",
          release: { done: true, at: null },
          bankFile: { status: "waiting", filename: null, template: null, generatedAt: null },
          payout: { status: "awaiting-preflight", label: "Synthetic preflight pending",
            reference: null, method: null, completedAt: null },
          reconciliation: { provider: null, status: "not-applicable",
            batchIds: [], total: 0, succeeded: 0, pending: 0, failed: 0,
            unknown: 0, checkedAt: null, canRetryFailed: false,
            settlementRegressed: false, transfers: [] },
        };
        await route.fulfill({ json: verified });
        return;
      }
      if (req.url().includes("/xendit-payout")) {
        xenditGets++;
        if (mode === "loading") { await new Promise(resolve => { releaseLoading = resolve; }); }
        if (mode === "error") { await route.fulfill({ status: 503, json: { error: "Synthetic unavailable" } }); return; }
        await route.fulfill({ json: { selectedProvider: "xendit", readiness: { ready: false, blockers: ["Synthetic provider disabled"] }, ledger: null } }); return;
      }
      if (req.url().includes("/payout-profiles")) {
        await route.fulfill({ json: { xenditEnabled: new URL(page.url()).searchParams.get("enabled") === "on",
          adapters: [], profiles: [{ legalEntity: { id: 1, code: "SYNTHETIC", displayName: "Synthetic employer", active: true }, profile: null }] } }); return;
      }
      await route.fulfill({ json: { enabled: false, assigned: false } });
    });
    let baselineXenditGets = 0;
    for (const variant of beforeSha ? ["before", "after"] : ["after"]) {
      const beforeResponse = variant === "before" ? page.waitForResponse(response => response.url().includes("/xendit-payout")) : null;
      await page.goto(`${base}/?enabled=off&variant=${variant}`);
      await page.getByRole("heading", { name: "Files that leave a paper trail." }).waitFor();
      if (beforeResponse) { await beforeResponse; baselineXenditGets = xenditGets; }
      if (variant === "after") {
        await page.getByText("Primary payout: PayMongo", { exact: true }).waitFor();
        assert.equal(await page.locator("[data-xendit-payout-panel]").count(), 0);
        assert.equal(xenditGets, baselineXenditGets, "Disabled panel must make no additional Xendit request");
      }
      await page.screenshot({ path: resolve(artifacts, `${variant}-off-exports-${width}.png`), fullPage: true });
    }
    await page.goto(`${base}/?enabled=off&view=profiles`);
    const select = page.getByLabel("Default payout method"); await select.waitFor();
    assert.equal(await select.locator('option[value="xendit"]').count(), 0);
    await page.screenshot({ path: resolve(artifacts, `after-off-profiles-${width}.png`), fullPage: true });
    mode = "loading";
    await page.goto(`${base}/?enabled=on`);
    await page.getByText("Loading payout status…", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(artifacts, `after-on-loading-${width}.png`), fullPage: true });
    mode = "error";
    releaseLoading?.(); releaseLoading = null;
    await page.goto(`${base}/?enabled=on`);
    await page.getByRole("button", { name: "Retry payout status" }).waitFor();
    await page.screenshot({ path: resolve(artifacts, `after-on-error-${width}.png`), fullPage: true });
    mode = "ready";
    await page.getByRole("button", { name: "Retry payout status" }).click();
    await page.getByText(/Synthetic provider disabled/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Submit / continue Xendit payroll" }).isDisabled(), true);
    await page.screenshot({ path: resolve(artifacts, `after-on-empty-${width}.png`), fullPage: true });
    // A cross-employer HTTP 200 is still untrusted. Never show payout
    // controls, monetary totals, or provider actions before verification.
    payoutMode = "foreign";
    await page.goto(`${base}/?enabled=off`);
    await page.getByRole("button", { name: "Retry payout reconciliation" }).waitFor();
    assert.equal(await page.locator("[data-payout-operations]").count(), 0);
    assert.equal(await page.locator("[data-paymongo-primary-actions]").count(), 0);
    await page.screenshot({ path: resolve(artifacts, `after-foreign-payout-rejected-${width}.png`), fullPage: true });
    payoutMode = "verified";
    await page.getByRole("button", { name: "Retry payout reconciliation" }).click();
    await page.getByText("Primary payout: PayMongo", { exact: true }).waitFor();
    await page.goto(`${base}/?enabled=on&role=hr`);
    await page.getByRole("heading", { name: "Files that leave a paper trail." }).waitFor();
    assert.equal(await page.locator("[data-xendit-payout-panel]").count(), 0);
    assert.equal(posts.length, 0, "No submission performed in UI acceptance");
    assert.deepEqual(errors, []);
    results.push({ width, verifiedPayoutControls: true, foreignPayoutRejected: true, loadingErrorRetry: true, hrDeniedPanel: true, externalPayments: 0 });
    await page.close();
  }
  await writeFile(resolve(artifacts, "receipt.json"), JSON.stringify({ scope: "Actual React components with synthetic intercepted local API responses; not deployed authentication or live payout acceptance", results }, null, 2));
  console.log(JSON.stringify({ status: "PASS", results }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
