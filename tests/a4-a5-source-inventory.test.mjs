import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const inventory = fileURLToPath(new URL("../scripts/qa/a4-a5-source-inventory.mjs", import.meta.url));
const expiryMarker = "/** Per-expiry, per-milestone HR alert ledger; idempotent across scheduler retries. */\n";
const expiryBlock = expiryMarker +
  'export const hcmDocumentExpiryNotices = pgTable("hcm_document_expiry_notices", {});\n\n';
const vaultImport = 'import { sweepPendingVaultUploads } from "@/lib/employee-vault-object-reconciliation";\n';
const vaultTick = "  // Private A5 upload intents must also be swept when its flag is rolled back.\n" +
  "  const pendingVaultObjectRecovery = await sweepPendingVaultUploads(new Date(now));\n";

function fixture({ predecessors = true, a5Mutation } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "a4-a5-both-merged-"));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const write = (file, content) => {
    const full = path.join(cwd, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const read = file => readFileSync(path.join(cwd, file), "utf8");
  const commit = message => {
    git("add", ".");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Fictional Source QA");
  git("config", "user.email", "source-qa@example.invalid");

  const oldSchema = (predecessors
    ? 'const hr = pgTable(\n  "employee_hr_cases", {}\n);\n' +
      'const privacy = pgTable("applicant_privacy_evidence", {});\n'
    : 'const org = pgTable("organizations", {});\n') +
    'export const invitations = pgTable("invitations", {});\n';
  const oldRetention =
    'import { sweepPendingCoeObjects } from "@/lib/hr-case-coe-object-reconciliation";\n' +
    'async function tick(now) {\n' +
    '  const pendingCoeObjectRecovery = await sweepPendingCoeObjects(new Date(now));\n' +
    '  return {\n    pendingCoeObjectRecovery,\n  };\n}\n';
  const flags = 'const CRITICAL_RELEASE_FLAGS = {\n' +
    '  vault: { env: "EMPLOYEE_DOCUMENT_VAULT_ENABLED" },\n' +
    '  uploads: { env: "DOCUMENT_UPLOADS_ENABLED" },\n' +
    '};\nexport function criticalReleaseFlagEnabled(flag, env) {\n' +
    '  return env[CRITICAL_RELEASE_FLAGS[flag].env] === "true";\n}\n';
  const proxy =
    'import { multiEntityHcmDeferred } from "./multi-entity-hcm-hold";\n' +
    'export function proxy() {\n' +
    '  if (multiEntityHcmDeferred()) return { code: "ENTITY_HCM_DEFERRED" };\n' +
    '  return {};\n}\n';
  write("src/db/schema.ts", oldSchema);
  write("src/lib/data-retention.ts", oldRetention);
  write("src/lib/critical-release-flags.ts", flags);
  write("src/proxy.ts", proxy);
  const original = commit("fictional A2 A3 predecessor");

  write("src/db/schema.ts", oldSchema.replace(
    "export const invitations",
    'const a4policies = pgTable("expense_category_policies", {});\n' +
    'const a4evidence = pgTable("expense_claim_evidence", {});\n' +
    "export const invitations",
  ));
  const spendImport = 'import { sweepPendingSpendReceipts } from "@/lib/spend-receipt-object-reconciliation";\n';
  const spendTick = "  const pendingSpendReceiptRecovery = await sweepPendingSpendReceipts(new Date(now));\n";
  const a4Retention = spendImport + oldRetention
    .replace("  return {\n", spendTick + "  return {\n")
    .replace("    pendingCoeObjectRecovery,\n",
      "    pendingCoeObjectRecovery,\n    pendingSpendReceiptRecovery,\n");
  write("src/lib/data-retention.ts", a4Retention);
  const mergedSpend = commit("actual merged A4 #896");

  // Model actual #902 as a two-parent merge, not an outstanding A5 candidate.
  git("switch", "-q", "-c", "a5");
  write("src/db/schema.ts", read("src/db/schema.ts").replace(
    "export const invitations", expiryBlock + "export const invitations",
  ));
  write("src/lib/data-retention.ts",
    vaultImport + a4Retention
      .replace("  return {\n", vaultTick + "  return {\n")
      .replace("    pendingSpendReceiptRecovery,\n",
        "    pendingSpendReceiptRecovery,\n    pendingVaultObjectRecovery,\n"));
  if (a5Mutation) a5Mutation({ read, write });
  const vaultFeatureHead = commit("fictional A5 private vault feature branch");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "merge A5 #902 into main", "a5");
  const vaultMerge = git("rev-parse", "HEAD");

  function verify({ main = vaultMerge, a4 = mergedSpend, a5Merge = vaultMerge,
    env = {} } = {}) {
    const call = spawnSync(process.execPath, [inventory], {
      cwd, encoding: "utf8",
      env: {
        ...process.env, CI: "true", A4_A5_INVENTORY_MODE: "read-only-ci",
        A4_A5_BASE_SHA: main, A4_A5_SPEND_SHA: a4,
        A4_A5_VAULT_MERGE_SHA: a5Merge, ...env,
      },
    });
    const json = JSON.parse(readFileSync(
      path.join(cwd, "qa-artifacts/a4-a5-source-inventory.json"), "utf8"));
    return { call, json };
  }
  return { cwd, git, write, read, commit, original, mergedSpend, vaultFeatureHead,
    vaultMerge, verify, clean: () => rmSync(cwd, { recursive: true, force: true }) };
}

test("merged A4+A5 source passes without certifying combined execution", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 0, call.stderr);
    assert.equal(json.status, "MERGED_SOURCE_RECONCILED_ONLY");
    for (const key of ["mergedA4InMain", "mergedA5InMain",
      "a5MergeHasReviewedParents", "a4SchemaPreserved", "a4RetentionPreserved",
      "currentMergedSchemaPresent", "currentMergedRetentionPresent",
      "applicantHrPredecessorsPresent", "currentCriticalFlagsProtected",
      "currentHcmProxyProtected", "sourceReconciled"]) {
      assert.equal(json[key], true, key);
    }
    assert.equal(json.featureFlagsChanged, false);
    assert.equal(json.hcmProxyChanged, false);
    assert.equal(json.combinedAcceptance, "NOT_RUN");
    assert.equal(json.databaseOperations, false);
  } finally { f.clean(); }
});

test("pinned main predating A5 merge is blocked", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify({ main: f.mergedSpend });
    assert.equal(call.status, 1);
    assert.equal(json.mergedA5InMain, false);
  } finally { f.clean(); }
});

test("fake A4 merged SHA fails A5 parent ancestry checks", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify({ a4: f.vaultMerge });
    assert.equal(call.status, 1);
    assert.equal(json.a5MergeHasReviewedParents, false);
  } finally { f.clean(); }
});

test("an unmerged A5 feature head cannot stand in for the actual merge", () => {
  const f = fixture();
  try {
    const { call, json } = f.verify({ a5Merge: f.vaultFeatureHead });
    assert.equal(call.status, 1);
    assert.equal(json.a5MergeHasReviewedParents, false);
  } finally { f.clean(); }
});

test("A5 merge cannot silently mutate A4 expense ledger schema", () => {
  const f = fixture({ a5Mutation: ({ read, write }) =>
    write("src/db/schema.ts", read("src/db/schema.ts")
      .replace('"expense_category_policies"', '"wrong_a4_replacement"')) });
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.equal(json.a4SchemaPreserved, false);
  } finally { f.clean(); }
});

test("A5 merge cannot remove A4 receipt recovery", () => {
  const f = fixture({ a5Mutation: ({ read, write }) =>
    write("src/lib/data-retention.ts", read("src/lib/data-retention.ts")
      .replace("    pendingSpendReceiptRecovery,\n", "    LOST_SPEND_RECOVERY,\n")) });
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.equal(json.a4RetentionPreserved, false);
  } finally { f.clean(); }
});

test("merged source needs original A2/A3 predecessor tables", () => {
  const f = fixture({ predecessors: false });
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.equal(json.applicantHrPredecessorsPresent, false);
  } finally { f.clean(); }
});

test("later main cannot delete merged A5 expiry ledger", () => {
  const f = fixture();
  try {
    f.write("src/db/schema.ts", f.read("src/db/schema.ts")
      .replace('"hcm_document_expiry_notices"', '"missing_expiry_ledger"'));
    const later = f.commit("regression after merged A5");
    const { call, json } = f.verify({ main: later });
    assert.equal(call.status, 1);
    assert.equal(json.currentMergedSchemaPresent, false);
  } finally { f.clean(); }
});

test("later main cannot remove private A5 retention recovery", () => {
  const f = fixture();
  try {
    f.write("src/lib/data-retention.ts", f.read("src/lib/data-retention.ts")
      .replace("await sweepPendingVaultUploads(new Date(now))", "removedVaultSweep()"));
    const later = f.commit("regression in combined retention");
    const { call, json } = f.verify({ main: later });
    assert.equal(call.status, 1);
    assert.equal(json.currentMergedRetentionPresent, false);
  } finally { f.clean(); }
});

test("A5 merge cannot alter critical release flags", () => {
  const f = fixture({ a5Mutation: ({ read, write }) =>
    write("src/lib/critical-release-flags.ts", read("src/lib/critical-release-flags.ts")
      .replace('=== "true"', '=== "false"')) });
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.equal(json.featureFlagsChanged, true);
  } finally { f.clean(); }
});

test("A5 merge cannot weaken HCM proxy guard", () => {
  const f = fixture({ a5Mutation: ({ read, write }) =>
    write("src/proxy.ts", read("src/proxy.ts")
      .replace('"ENTITY_HCM_DEFERRED"', '"HCM_NOT_PROTECTED"')) });
  try {
    const { call, json } = f.verify();
    assert.equal(call.status, 1);
    assert.equal(json.hcmProxyChanged, true);
  } finally { f.clean(); }
});

test("later main must keep document flags fail-closed", () => {
  const f = fixture();
  try {
    f.write("src/lib/critical-release-flags.ts", f.read("src/lib/critical-release-flags.ts")
      .replace('=== "true"', '=== "false"'));
    const later = f.commit("regression in release flag parser");
    const { call, json } = f.verify({ main: later });
    assert.equal(call.status, 1);
    assert.equal(json.currentCriticalFlagsProtected, false);
  } finally { f.clean(); }
});

test("later main must preserve HCM deferred source hold", () => {
  const f = fixture();
  try {
    f.write("src/proxy.ts", f.read("src/proxy.ts")
      .replace('"ENTITY_HCM_DEFERRED"', '"HCM_UNBLOCKED"'));
    const later = f.commit("regression in HTTP security gate");
    const { call, json } = f.verify({ main: later });
    assert.equal(call.status, 1);
    assert.equal(json.currentHcmProxyProtected, false);
  } finally { f.clean(); }
});

test("non-CI mode, malformed and nonexistent SHAs fail closed", () => {
  const f = fixture();
  try {
    const nonCi = f.verify({ env: { CI: "false" } });
    assert.equal(nonCi.call.status, 1);
    const malformed = f.verify({ a4: "main" });
    assert.equal(malformed.call.status, 1);
    assert.ok(malformed.json.blockers.some(x => x.includes("A4_A5_SPEND_SHA")));
    const missing = f.verify({ a5Merge: "0".repeat(40) });
    assert.equal(missing.call.status, 1);
    assert.equal(missing.json.featureFlagsChanged, null);
    assert.equal(missing.json.hcmProxyChanged, null);
    assert.ok(missing.json.blockers.some(x => x.includes("A4_A5_VAULT_MERGE_SHA")));
  } finally { f.clean(); }
});

test("workflow uses the exact A5 merge SHA and immutable PR event base", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../.github/workflows/a4-a5-source-inventory.yml", import.meta.url)),
    "utf8",
  );
  const dollar = String.fromCharCode(36);
  assert.ok(workflow.includes("PR_EVENT_BASE_SHA: " + dollar +
    "{{ github.event.pull_request.base.sha }}"));
  assert.ok(workflow.includes('if [[ "' + dollar + '{GITHUB_EVENT_NAME}" == "pull_request" ]]'));
  assert.ok(workflow.includes('export A4_A5_BASE_SHA="' + dollar + '{PR_EVENT_BASE_SHA}"'));
  assert.ok(workflow.includes('git cat-file -e "' + dollar + '{A4_A5_BASE_SHA}^{commit}"'));
  assert.ok(workflow.includes("A4_A5_VAULT_MERGE_SHA=3a4a2edaca9a44064c824d57fcb3f9e88aee72c9"));
  assert.ok(!workflow.includes("refs/pull/902/head"));
});
