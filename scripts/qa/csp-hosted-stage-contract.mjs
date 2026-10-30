/**
 * Pure validation + summarization helpers for the hosted CSP benchmark.
 * Never export production URLs or credentials as benchmark targets.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const QA_PROJECT_ID = "prj_fj1ezuD5LqXYRe9X2Lc9fwCHecpu";
export const QA_TEAM_ID = "team_5oyNk06BhdkUCcPJLzHPRpvK";
export const PRODUCTION_PROJECT_ID = "prj_DCCuaGyRvRNJ7hOybLLdJq0jdGhh";
export const PRODUCTION_HOSTNAME = "erwinmehehe-payrollph.vercel.app";
export const ROUTES = ["/", "/hris", "/pricing", "/hcm", "/login"];
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DEPLOYMENT_PATTERN = /^dpl_[A-Za-z0-9]+$/;

export function checkedStageUrl(value, label) {
  assert.equal(typeof value, "string", label + " missing URL");
  assert.ok(value.length <= 220, label + " URL too long");
  const u = new URL(value);
  assert.equal(u.protocol, "https:", label + " requires HTTPS");
  assert.equal(u.username, "", label + " may not include credentials");
  assert.equal(u.password, "", label + " may not include credentials");
  assert.equal(u.port, "", label + " may not specify a port");
  assert.equal(u.pathname, "/", label + " must be a bare origin");
  assert.equal(u.search, "", label + " may not include a query");
  assert.equal(u.hash, "", label + " may not include a fragment");
  assert.equal(u.origin, value, label + " must be a canonical origin");
  assert.ok(/^[a-z0-9-]+\.vercel\.app$/.test(u.hostname),
    label + " must be an immutable Vercel preview origin");
  assert.notEqual(u.hostname, PRODUCTION_HOSTNAME, label + " cannot be production");
  return u.origin;
}

export function stageConfiguration(env) {
  assert.equal(env.GITHUB_ACTIONS, "true", "Hosted verification only on protected GitHub Actions");
  assert.equal(env.GITHUB_REF, "refs/heads/main", "Protected manual main-only verification");
  assert.ok(SHA_PATTERN.test(env.GITHUB_SHA || ""), "Exact 40-character main SHA required");
  assert.equal(env.CSP_STAGE_SOURCE_SHA, env.GITHUB_SHA,
    "Both preview builds must match the exact workflow source SHA");
  assert.equal(env.CSP_STAGE_PROJECT_ID, QA_PROJECT_ID,
    "Only the separate fictional QA project may be used");
  assert.notEqual(env.CSP_STAGE_PROJECT_ID, PRODUCTION_PROJECT_ID);
  assert.equal(env.CSP_STAGE_TEAM_ID, QA_TEAM_ID,
    "Only the explicitly identified QA project team may be used");
  const off = {
    mode: "off", origin: checkedStageUrl(env.CSP_STAGE_OFF_URL, "OFF"),
    deploymentId: env.CSP_STAGE_OFF_DEPLOYMENT_ID,
  };
  const on = {
    mode: "on", origin: checkedStageUrl(env.CSP_STAGE_ON_URL, "ON"),
    deploymentId: env.CSP_STAGE_ON_DEPLOYMENT_ID,
  };
  assert.ok(DEPLOYMENT_PATTERN.test(off.deploymentId || ""), "OFF deployment id missing/invalid");
  assert.ok(DEPLOYMENT_PATTERN.test(on.deploymentId || ""), "ON deployment id missing/invalid");
  assert.notEqual(off.deploymentId, on.deploymentId, "Two separate builds/deployments required");
  assert.notEqual(off.origin, on.origin, "Do not test the same deployment twice");
  return {
    sourceSha: env.GITHUB_SHA, teamId: QA_TEAM_ID, projectId: QA_PROJECT_ID, off, on,
  };
}

export function attestPreview(deployment, expected, config) {
  assert.ok(deployment && typeof deployment === "object", "Missing Vercel metadata");
  const projectId = deployment.projectId ?? deployment.project?.id;
  assert.equal(projectId, QA_PROJECT_ID, expected.mode + ": target must be fictional QA project");
  assert.equal(projectId, config.projectId);
  assert.equal(deployment.target, "preview", expected.mode + ": production target forbidden");
  assert.equal(deployment.readyState ?? deployment.state, "READY",
    expected.mode + ": preview must be READY");
  assert.equal(deployment.id ?? deployment.uid, expected.deploymentId,
    expected.mode + ": deployment ID mismatch");
  const sourceSha = deployment.meta?.githubCommitSha ??
    deployment.meta?.gitCommitSha ?? deployment.gitSource?.sha;
  assert.equal(sourceSha, config.sourceSha,
    expected.mode + ": immutable deployment must prove matching Git SHA");
  assert.equal(checkedStageUrl("https://" + deployment.url, "Vercel metadata URL"),
    expected.origin, expected.mode + ": URL cannot be an alias or a different deployment");
  const aliases = Array.isArray(deployment.alias) ? deployment.alias : [];
  assert.ok(!aliases.some(alias => alias === PRODUCTION_HOSTNAME),
    expected.mode + ": preview may not carry the production alias");
  return {
    mode: expected.mode, origin: expected.origin, deploymentId: expected.deploymentId,
    projectId, sourceSha, target: "preview", readyState: "READY",
  };
}

export function getScriptPolicy(csp) {
  const directives = String(csp ?? "").split(";").map(x => x.trim());
  return directives.find(x => x.startsWith("script-src ")) ?? "";
}
export function nonceEvidence(csp, html, enabled) {
  const policy = getScriptPolicy(csp);
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1] ?? null;
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(hit => {
    const tag = hit[0];
    const type = /\btype=["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    return {
      nonce: /\bnonce=["']([^"']+)["']/i.exec(tag)?.[1] ?? null,
      executable: !type || /javascript|ecmascript|module/i.test(type),
    };
  }).filter(script => script.executable);
  const missing = scripts.filter(script => !script.nonce).length;
  const mismatched = scripts.filter(script => script.nonce && script.nonce !== nonce).length;
  const pass = enabled
    ? Boolean(nonce && scripts.length > 0 && !/unsafe-inline|unsafe-eval/.test(policy) &&
      missing === 0 && mismatched === 0)
    : Boolean(policy.includes("'unsafe-inline'"));
  return {
    policy, nonce, scriptCount: scripts.length,
    matching: scripts.length - missing - mismatched, missing, mismatched, pass,
  };
}

function attributes(tag) {
  const obj = {};
  for (const [,name,v1,v2,v3] of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
    obj[name.toLowerCase()] = v1 ?? v2 ?? v3;
  return obj;
}
export function seoEvidence(html) {
  const tags = [...html.matchAll(/<meta\b[^>]*>|<link\b[^>]*>/gi)]
    .map(m => ({ tag:m[0], attrs:attributes(m[0]) }));
  const meta = name => tags.find(t => t.tag.toLowerCase().startsWith("<meta") &&
    t.attrs.name?.toLowerCase() === name)?.attrs.content ?? null;
  const canonical = tags.find(t => t.tag.toLowerCase().startsWith("<link") &&
    t.attrs.rel?.toLowerCase() === "canonical")?.attrs.href ?? null;
  return {
    title: /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null,
    description: meta("description"),
    robots: meta("robots"), canonical,
    h1: /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
      ?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? null,
  };
}
export function seoParity(off, on) {
  return ["title","description","robots","canonical","h1"].every(k => off[k] === on[k]);
}
export function quantile(samples, p) {
  assert.ok(samples.length > 0, "No measurements");
  assert.ok(p >= 0 && p <= 1, "Invalid quantile");
  const sorted = [...samples].sort((a,b) => a-b);
  return +(sorted[Math.ceil(p * sorted.length) - 1 < 0 ? 0 :
    Math.ceil(p * sorted.length) - 1].toFixed(2));
}
export function safeHeaderSet(headers) {
  const get = key => headers.get(key);
  return {
    cacheControl: get("cache-control"),
    age: get("age"),
    vercelCache: get("x-vercel-cache"),
    nextCache: get("x-nextjs-cache"),
    vary: get("vary"),
    contentType: get("content-type"),
    // A boolean only. Never store cookies, auth headers or preview bypass secrets.
    setsCookie: Boolean(get("set-cookie")),
  };
}
export function cacheSafety(headers, enabled) {
  if (!enabled) return {pass:true, offCacheObserved:headers.vercelCache ?? null};
  const c = (headers.cacheControl || "").toLowerCase();
  const state = (headers.vercelCache || "").toUpperCase();
  return {
    pass: /\bno-store\b/.test(c) && /\bprivate\b/.test(c) &&
      !["HIT","STALE","REVALIDATED"].includes(state) &&
      (!headers.age || Number(headers.age) === 0),
    reason: "Nonce HTML must be private/no-store and never served as a CDN HIT",
  };
}
export function htmlFingerprint(html) {
  return createHash("sha256").update(html).digest("hex");
}
