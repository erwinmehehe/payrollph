#!/usr/bin/env node
/**
 * Read-only Vercel environment-target audit; never outputs environment values.
 * This checks assignments, NOT database/encryption key identity.
 * Independent DB verification and protected staging UAT remain mandatory.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_PREVIEW_KEYS = Object.freeze([
  "DATABASE_URL",
  "TOTP_ENCRYPTION_KEY",
  "PII_ENCRYPTION_KEY",
  "BANK_DATA_ENCRYPTION_KEY",
]);

const VALID_TARGETS = new Set(["production", "preview", "development"]);
const VALID_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function auditPreviewIsolationMetadata(payload) {
  const envs = Array.isArray(payload) ? payload : payload?.envs;
  assert.ok(Array.isArray(envs), "Expected complete Vercel env metadata with an envs array");
  // A partial inventory cannot establish the absence of unsafe assignments.
  assert.ok(payload?.pagination?.next == null && payload?.pagination?.nextCursor == null,
    "Environment listing is paginated; fetch the complete inventory before approval");

  const errors = [];
  const inventory = [];
  for (const entry of envs) {
    const key = entry?.key;
    const targets = entry?.target;
    // A branch-specific Preview override cannot cover other Preview branches.
    // Treat absent/null gitBranch as the only unscoped Preview assignment.
    const gitBranch = entry?.gitBranch ?? null;
    const validBranch = gitBranch === null || (typeof gitBranch === "string"
      && gitBranch.length > 0 && gitBranch.length <= 255
      && gitBranch.trim() === gitBranch && !/[\x00-\x1f\x7f]/.test(gitBranch));
    if (typeof key !== "string" || !VALID_KEY_NAME.test(key)
      || !Array.isArray(targets) || targets.length === 0
      || targets.some((target) => !VALID_TARGETS.has(target)) || !validBranch) {
      errors.push("Malformed environment record: invalid variable name or targets");
      continue;
    }
    // Only retain metadata, never "value", "decrypted" or sensitive fields.
    inventory.push({ key, targets, gitBranch });
    if (targets.includes("production") && targets.includes("preview")) {
      // Catch future auth/session/provider secrets too, not just current DB keys.
      errors.push(key + " is shared by Preview and Production");
    }
  }

  for (const key of REQUIRED_PREVIEW_KEYS) {
    const matches = inventory.filter((entry) => entry.key === key
      && entry.targets.includes("preview") && !entry.targets.includes("production")
      && entry.gitBranch === null);
    if (matches.length === 0) errors.push("Preview-only " + key + " is absent");
  }

  return Object.freeze({
    ok: errors.length === 0,
    auditedEntries: envs.length,
    errors,
    message: errors.length
      ? "NO-GO: Preview environment assignments are not safely isolated."
      : "Metadata assignments passed; database identity and protected staging acceptance are STILL REQUIRED.",
  });
}

async function readMetadata() {
  const index = process.argv.indexOf("--fixture");
  if (index >= 0) {
    if (!process.argv[index + 1]) throw Error("Expected sanitized fixture path after --fixture");
    return JSON.parse(await readFile(process.argv[index + 1], "utf8"));
  }
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId || !teamId) {
    throw Error("VERCEL_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID must be configured");
  }
  if (!/^prj_[A-Za-z0-9]+$/.test(projectId) || !/^team_[A-Za-z0-9]+$/.test(teamId)) {
    throw Error("Expected explicit Vercel project and team IDs (not names or URLs)");
  }
  const url = new URL("https://api.vercel.com/v9/projects/"
    + encodeURIComponent(projectId) + "/env");
  url.searchParams.set("teamId", teamId);
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("Vercel metadata request failed (HTTP " + response.status + ")");
  const payload = await response.json();
  // Vercel may include secret values in a response. Immediately discard them.
  return {
    envs: (payload.envs || []).map((entry) => ({
      key: entry.key, target: entry.target, gitBranch: entry.gitBranch,
    })),
    pagination: payload.pagination,
  };
}

async function main() {
  const result = auditPreviewIsolationMetadata(await readMetadata());
  console.log(result.message);
  console.log("Checked " + result.auditedEntries + " assignments without printing values.");
  for (const error of result.errors) console.error("BLOCKED: " + error);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("NO-GO: " + (error instanceof Error ? error.message : "metadata verification failed"));
    process.exitCode = 1;
  });
}
