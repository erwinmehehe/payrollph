#!/usr/bin/env node
/**
 * Read-only #927 post-merge source integrity inventory.
 * A4 #896 and A5 #902 are ALREADY merged into main. Never checkout or
 * execute an old proposal, apply DDL, or call a provider from this check.
 * Verify the actual two-parent #902 merge preserved A4 byte-for-byte except
 * for the reviewed A5 schema and retention additions, then check that the
 * pinned current main still contains the guarded merged-source contracts.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
const source = (sha, path) => execFileSync("git", ["show", sha + ":" + path], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const hasCommit = sha => spawnSync("git", ["cat-file", "-e", sha + "^{commit}"],
  { stdio: "ignore" }).status === 0;
const ancestorOf = (base, head) => spawnSync("git",
  ["merge-base", "--is-ancestor", base, head], { stdio: "ignore" }).status === 0;
const parentsOf = sha => git("rev-list", "--parents", "-n", "1", sha).split(" ").slice(1);
const hasTable = (schema, name) =>
  new RegExp("\\bpgTable\\s*\\(\\s*[\"']" + name + "[\"']").test(schema);

const keys = ["A4_A5_BASE_SHA", "A4_A5_SPEND_SHA", "A4_A5_VAULT_MERGE_SHA"];
const refs = Object.fromEntries(keys.map(key => [key, process.env[key] ?? ""]));
const blockers = [];
const evidence = {
  kind: "A4-and-A5-already-merged-source-read-only",
  historicalPr: 927, mergedSpendPr: 896, mergedVaultPr: 902,
  refs,
  mergedA4InMain: false, mergedA5InMain: false,
  a5MergeHasReviewedParents: false,
  a4SchemaPreserved: false, a4RetentionPreserved: false,
  applicantHrPredecessorsPresent: false,
  currentMergedSchemaPresent: false, currentMergedRetentionPresent: false,
  // Uninspected is null, never a misleading claim that guards did not change.
  featureFlagsChanged: null, hcmProxyChanged: null,
  currentCriticalFlagsProtected: false, currentHcmProxyProtected: false,
  databaseOperations: false,
  scannedFiles: [
    "src/db/schema.ts", "src/lib/data-retention.ts",
    "src/lib/critical-release-flags.ts", "src/proxy.ts",
  ],
  sourceReconciled: false, combinedAcceptance: "NOT_RUN",
  blockers,
};
if (process.env.CI !== "true" || process.env.A4_A5_INVENTORY_MODE !== "read-only-ci") {
  blockers.push("read-only CI mode is required");
}
for (const [key, sha] of Object.entries(refs)) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !hasCommit(sha)) {
    blockers.push(key + " must identify a reachable exact Git commit");
  }
}

if (!blockers.length) {
  try {
    const [main, spend, vaultMerge] = keys.map(key => refs[key]);
    evidence.mergedA4InMain = ancestorOf(spend, main);
    evidence.mergedA5InMain = ancestorOf(vaultMerge, main);
    if (!evidence.mergedA4InMain) blockers.push("A4 #896 merged commit is not an ancestor of pinned main");
    if (!evidence.mergedA5InMain) blockers.push("A5 #902 merge commit is not an ancestor of pinned main");

    const parents = parentsOf(vaultMerge);
    evidence.a5MergeHasReviewedParents = parents.length === 2 &&
      parents.every(parent => ancestorOf(spend, parent));
    if (!evidence.a5MergeHasReviewedParents) {
      blockers.push("A5 must be a two-parent merge preserving the merged A4 predecessor");
    }
    if (parents.length !== 2) {
      throw new Error("A5 merge does not have two parents");
    }
    const beforeA5 = parents[0];

    const preSchema = source(beforeA5, "src/db/schema.ts");
    const mergedSchema = source(vaultMerge, "src/db/schema.ts");
    const currentSchema = source(main, "src/db/schema.ts");
    evidence.applicantHrPredecessorsPresent = [
      "employee_hr_cases", "applicant_privacy_evidence",
    ].every(table => hasTable(currentSchema, table));
    if (!evidence.applicantHrPredecessorsPresent) {
      blockers.push("Pinned main lacks merged HR-case/applicant-privacy predecessor tables");
    }
    evidence.currentMergedSchemaPresent = [
      "expense_category_policies", "expense_claim_evidence",
      "hcm_document_expiry_notices",
    ].every(table => hasTable(currentSchema, table));
    if (!evidence.currentMergedSchemaPresent) {
      blockers.push("Pinned main is missing merged A4 Spend or A5 expiry-notice tables");
    }

    const startTag = "/** Per-expiry, per-milestone HR alert ledger; idempotent across scheduler retries. */";
    const endTag = "export const invitations = pgTable(";
    const start = mergedSchema.indexOf(startTag);
    const end = start < 0 ? -1 : mergedSchema.indexOf(endTag, start);
    if (start < 0 || end <= start || mergedSchema.indexOf(startTag, start + 1) !== -1) {
      blockers.push("A5 merge expiry-notice ledger is absent or ambiguous");
    } else {
      const a5Only = mergedSchema.slice(start, end);
      evidence.a4SchemaPreserved = hasTable(a5Only, "hcm_document_expiry_notices") &&
        mergedSchema.replace(a5Only, "") === preSchema &&
        hasTable(preSchema, "expense_category_policies") &&
        hasTable(preSchema, "expense_claim_evidence");
      if (!evidence.a4SchemaPreserved) {
        blockers.push("A5 merge modifies earlier A4 schema beyond the reviewed expiry-notice ledger");
      }
    }

    const preRetention = source(beforeA5, "src/lib/data-retention.ts");
    let mergedRetention = source(vaultMerge, "src/lib/data-retention.ts");
    const additions = [
      'import { sweepPendingVaultUploads } from "@/lib/employee-vault-object-reconciliation";\n',
      "  // Private A5 upload intents must also be swept when its flag is rolled back.\n" +
      "  const pendingVaultObjectRecovery = await sweepPendingVaultUploads(new Date(now));\n",
      "    pendingVaultObjectRecovery,\n",
    ];
    let exact = true;
    for (const addition of additions) {
      if (mergedRetention.split(addition).length !== 2) exact = false;
      mergedRetention = mergedRetention.replace(addition, "");
    }
    evidence.a4RetentionPreserved = exact && mergedRetention === preRetention &&
      preRetention.includes("await sweepPendingSpendReceipts(new Date(now))") &&
      preRetention.includes("await sweepPendingCoeObjects(new Date(now))");
    if (!evidence.a4RetentionPreserved) {
      blockers.push("A5 merge loses A4 Spend/COE recovery or changes unrelated retention logic");
    }

    const currentRetention = source(main, "src/lib/data-retention.ts");
    evidence.currentMergedRetentionPresent = [
      "await sweepPendingCoeObjects(new Date(now))",
      "await sweepPendingSpendReceipts(new Date(now))",
      "await sweepPendingVaultUploads(new Date(now))",
      "pendingCoeObjectRecovery,",
      "pendingSpendReceiptRecovery,",
      "pendingVaultObjectRecovery,",
    ].every(marker => currentRetention.includes(marker));
    if (!evidence.currentMergedRetentionPresent) {
      blockers.push("Pinned main no longer contains merged COE/Spend/vault cleanup");
    }

    evidence.featureFlagsChanged = source(beforeA5, "src/lib/critical-release-flags.ts") !==
      source(vaultMerge, "src/lib/critical-release-flags.ts");
    evidence.hcmProxyChanged = source(beforeA5, "src/proxy.ts") !==
      source(vaultMerge, "src/proxy.ts");
    if (evidence.featureFlagsChanged) blockers.push("A5 merge changes critical release-flag definitions");
    if (evidence.hcmProxyChanged) blockers.push("A5 merge changes HCM HTTP proxy guards");

    const currentFlags = source(main, "src/lib/critical-release-flags.ts");
    evidence.currentCriticalFlagsProtected = [
      'env: "EMPLOYEE_DOCUMENT_VAULT_ENABLED"',
      'env: "DOCUMENT_UPLOADS_ENABLED"',
      'return env[CRITICAL_RELEASE_FLAGS[flag].env] === "true";',
    ].every(marker => currentFlags.includes(marker));
    if (!evidence.currentCriticalFlagsProtected) {
      blockers.push("Pinned main no longer preserves the default-OFF document release flags");
    }
    const currentProxy = source(main, "src/proxy.ts");
    evidence.currentHcmProxyProtected = currentProxy.includes("multiEntityHcmDeferred()") &&
      currentProxy.includes('code: "ENTITY_HCM_DEFERRED"');
    if (!evidence.currentHcmProxyProtected) {
      blockers.push("Pinned main no longer preserves the HCM 403 deferred-source guard");
    }
  } catch (error) {
    blockers.push("Could not inspect exact merged Git source snapshots: " +
      (error instanceof Error ? error.name : "unknown"));
  }
}

evidence.sourceReconciled = !blockers.length &&
  evidence.mergedA4InMain && evidence.mergedA5InMain &&
  evidence.a5MergeHasReviewedParents && evidence.applicantHrPredecessorsPresent &&
  evidence.a4SchemaPreserved && evidence.a4RetentionPreserved &&
  evidence.currentMergedSchemaPresent && evidence.currentMergedRetentionPresent &&
  evidence.featureFlagsChanged === false && evidence.hcmProxyChanged === false &&
  evidence.currentCriticalFlagsProtected && evidence.currentHcmProxyProtected;
evidence.status = evidence.sourceReconciled ? "MERGED_SOURCE_RECONCILED_ONLY" : "BLOCKED";
mkdirSync("qa-artifacts", { recursive: true });
writeFileSync("qa-artifacts/a4-a5-source-inventory.json",
  JSON.stringify(evidence, null, 2) + "\n");
console.log("A4 and A5 merged source inventory:", evidence.status);
for (const reason of blockers) console.error("A4/A5 BLOCKED:", reason);
if (evidence.sourceReconciled) {
  console.log("Combined A4/A5 runnable tests and migrations are NOT performed by this inventory.");
}
if (blockers.length) process.exitCode = 1;
