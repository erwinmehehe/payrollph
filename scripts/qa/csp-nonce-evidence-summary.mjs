#!/usr/bin/env node
/** Reproducible run-derived CSP pass/fail, browser evidence and timing report. */
import { readFile, writeFile } from "node:fs/promises";

const root = "qa-artifacts/csp-verification";
async function readJson(path) {
  try { return JSON.parse(await readFile(path,"utf8")); }
  catch { return null; }
}
const off = await readJson(root + "/off/raw-evidence.json");
const on = await readJson(root + "/on/raw-evidence.json");
const offBuild = await readJson(root + "/off/build-routes.json");
const onBuild = await readJson(root + "/on/build-routes.json");
const both = Boolean(off && on);
const status = (ok, ready=true) => !ready ? "UNVERIFIED" : ok ? "PASS" : "FAIL";
const n = value => typeof value === "number" ? value.toFixed(2) : "n/a";
const page = (report,path) => report?.http?.filter(x => x.path === path) ?? [];
const paths = ["/", "/login", "/hcm", "/__csp_qa_not_found", "/__csp_qa_error"];
const comparison = paths.map(path => {
  const a = off?.latency?.find(x => x.path === path);
  const b = on?.latency?.find(x => x.path === path);
  const first = page(off,path)[0] ?? {};
  const second = page(on,path)[0] ?? {};
  return {
    path, offStatus:first.status, onStatus:second.status,
    offTtfbMs:a?.medianTtfbMs, onTtfbMs:b?.medianTtfbMs,
    deltaTtfbMs:a && b ? +(b.medianTtfbMs - a.medianTtfbMs).toFixed(2) : null,
    offHtmlBytes:first.htmlBytes, onHtmlBytes:second.htmlBytes,
    metadataSame:["title","description","canonical","h1"].every(k=>first[k]===second[k]),
    offHtmlSha256:first.htmlSha256, onHtmlSha256:second.htmlSha256,
  };
});
const browserPass = both && off.browserPass === true && on.browserPass === true;
const htmlPass = both && off.htmlCheck?.pass === true && on.htmlCheck?.pass === true;
const errorPass = htmlPass && ["/__csp_qa_not_found", "/__csp_qa_error"].every((p,idx)=>
  page(on,p).every(x=>x.status===(idx?500:404)&&x.pass) &&
  page(off,p).every(x=>x.status===(idx?500:404)&&x.pass) &&
  page(on,p).length === 2 && page(off,p).length === 2);
const seoPass = both && comparison.every(row => row.metadataSame &&
  row.offStatus===row.onStatus && row.deltaTtfbMs!==null);
const loadReviewed = Boolean(offBuild && onBuild && both);
const sections = [
  ["1. Headless Chromium / hydration",status(browserPass,both),
    "Browser screenshots, real console/pageerror/CSP events and React click checks in off/on raw-evidence.json."],
  ["2. HTML nonce matches CSP header",status(htmlPass,both),
    "Two independent GETs per route with script-src header, script nonce counts and matching evidence."],
  ["3. 404/500/error HTML coverage",status(errorPass,both),
    "Real 404 and temporary synthetic SSR throw returning HTTP 500 with separate CSP headers."],
  ["4. SEO/TTFB/HTML comparison",status(seoPass,both),
    "Seven HTTP requests per page/mode after one warmup; title, description, canonical, H1 and HTML hashes."],
  ["5. Hosting-load review",status(loadReviewed,Boolean(offBuild&&onBuild)),
    "Actual OFF/ON build prerender manifests, plus clearly hypothetical scale assumptions."],
];
const lines=[
  "# Nonce CSP verification: real served-build acceptance",
  "",
  "Source commit: " + (process.env.GITHUB_SHA || "unknown"),
  "",
  "Environment: GitHub Actions disposable Ubuntu + local PostgreSQL 16 app_db, two separate Next.js production builds, headless Chromium, fictional HR fixture only.",
  "NEXT_CSP_ENABLED=false for the OFF build/server. NEXT_CSP_ENABLED=true for the ON build/server.",
  "Production environment, databases and feature flags changed: NO.",
  "",
  "## Status per required check",
  "| Required check | Result | Raw evidence |",
  "| --- | --- | --- |",
  ...sections.map(([name,result,detail])=>"| "+name+" | **"+result+"** | "+detail+" |"),
  "",
  "Owner recommendation: "+(sections.every(([,s])=>s==="PASS")
    ? "Local staging verification passes covered paths. DO NOT enable in production without independent owner/security review, physical/mobile and third-party script coverage, and a production-like cache and load rehearsal."
    : "NO-GO. DO NOT enable NEXT_CSP_ENABLED. Missing or failed served evidence must be fixed and re-tested first."),
  "",
  "## Raw measured SEO/TTFB comparison",
  "Each sample measures local time until response headers arrive (fetch-based TTFB proxy). One warmup, seven GETs per route/mode, same port and runner but two independent builds.",
  "",
  "| Path | OFF/ON HTTP | OFF TTFB ms | ON TTFB ms | Delta ms | OFF HTML bytes | ON HTML bytes | SEO fields identical |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
  ...comparison.map(r=>"| "+r.path+" | "+(r.offStatus??"?")+"/"+(r.onStatus??"?")+
    " | "+n(r.offTtfbMs)+" | "+n(r.onTtfbMs)+" | "+n(r.deltaTtfbMs)+
    " | "+(r.offHtmlBytes??"?")+" | "+(r.onHtmlBytes??"?")+
    " | "+(r.metadataSame?"yes":"NO")+" |"),
  "",
  "TTFB limitations: local loopback only, not real-user browser CWV or a geographically distributed TTFB. Runs were sequential, not randomized, and server CPU/DB/cache warming may differ. Individual sample arrays are in raw-evidence.json.",
  "",
  "OFF prerendered route count: "+(offBuild?.prerenderedPages?.length??"not captured"),
  "ON prerendered route count: "+(onBuild?.prerenderedPages?.length??"not captured"),
  "See build-routes.json for the actual route keys and build.log for rendered build output. Some public pages were already dynamic before this feature.",
  "",
  "## Hosting-load estimate, NOT scale load tested",
  "Illustrative incremental HTML traffic that used to be served from a static/ISR cache. Assumed 100ms CPU per extra SSR request (unmeasured; do not treat as observed CPU time):",
  "",
  "| Extra HTML RPS | Extra SSR/day | Estimated extra vCPU at 100ms CPU/request |",
  "| ---: | ---: | ---: |",
  ...[10,100,500].map(rps=>"| "+rps+" | "+(rps*86400)+" | "+(rps*0.1).toFixed(1)+" |"),
  "",
  "This incremental scenario DOES NOT apply to routes already SSR. Real p95/p99 latency, cache hit rates, concurrency, cold starts, bandwidth and hosting bills need production-like traffic, which this workflow does not generate.",
  "",
  "## Raw artifacts in this GitHub Actions run",
  "off/raw-evidence.json and on/raw-evidence.json: CSP header, fresh per-request nonce, script nonce match/miss counts, HTTP statuses, exact TTFB samples and HTML SHA256, actual browser console/CSP violation events and hydration interaction outcomes.",
  "off/*.png and on/*.png: headless Chromium screenshots of marketing, login, payroll workspace and authenticated HCM pages (fictional data).",
  "off/build.log, on/build.log: independent Next.js builds and dynamic/static classifications.",
  "off/server.log, on/server.log: actual server output, including intentional SSR 500.",
  "off/build-routes.json and on/build-routes.json: build prerender manifests.",
  "off/harness.log and on/harness.log: actual test output; comparison.json: structured conclusions.",
  "",
  "## Boundaries",
  "No production flag toggle, no real employer records, no external authentication, no bank or payment operations. A local authoring-container git fetch failed because github.com DNS was unavailable; the GitHub Actions checkout explicitly fetches origin/main.",
  "A successful single-run local proof would not certify third-party integrations, physical devices or production-sized hosting load.",
];
const summary={sourceSha:process.env.GITHUB_SHA,sections:sections.map(([name,s,detail])=>({name,status:s,detail})),comparison,
  offPrerendered:offBuild?.prerenderedPages?.length??null,onPrerendered:onBuild?.prerenderedPages?.length??null,
  productionEnabled:false};
await writeFile(root+"/verification-report.md",lines.join("\n")+"\n");
await writeFile(root+"/comparison.json",JSON.stringify(summary,null,2)+"\n");
console.log(lines.join("\n"));
if (!sections.every(([,s])=>s==="PASS")) process.exitCode=1;
