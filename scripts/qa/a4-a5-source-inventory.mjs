#!/usr/bin/env node
/**
 * Read-only #927 checkpoint now that A4 #896 is merged into main.
 * A5 #902 is checked as a candidate successor, not checked out or executed.
 * Schema and retention source are compared byte-for-byte after removing only
 * the reviewed A5 additions; this detects accidental A4 regressions.
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

const keys = ["A4_A5_BASE_SHA", "A4_A5_SPEND_SHA", "A4_A5_VAULT_SHA"];
const refs = Object.fromEntries(keys.map(key => [key, process.env[key] ?? ""]));
const blockers = [];
const evidence = {
  kind: "A4-merged-A5-candidate-read-only",
  historicalPr: 927, mergedSpendPr: 896, outstandingVaultPr: 902,
  refs, mergedA4InMain: false, vaultIncludesMain: false,
  a4SchemaPreserved: false, a4RetentionPreserved: false,
  applicantHrPredecessorsPresent: false,
  // Null means the current source pair was not inspected. Never record
  // false ("unchanged") merely because earlier ancestry preflight failed.
  featureFlagsChanged: null, hcmProxyChanged: null, databaseOperations: false,
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
    const [main, spend, vault] = keys.map(key => refs[key]);
    evidence.mergedA4InMain = ancestorOf(spend, main);
    evidence.vaultIncludesMain = ancestorOf(main, vault);
    if (!evidence.mergedA4InMain) blockers.push("A4 #896 merged commit is not an ancestor of current main");
    if (!evidence.vaultIncludesMain) blockers.push("A5 #902 must reconcile to pinned current main");

    const mainSchema = source(main, "src/db/schema.ts");
    const vaultSchema = source(vault, "src/db/schema.ts");
    evidence.applicantHrPredecessorsPresent = [
      "employee_hr_cases", "applicant_privacy_evidence",
    ].every(table => new RegExp("\\bpgTable\\s*\\(\\s*[\"']" + table + "[\"']").test(mainSchema));
    if (!evidence.applicantHrPredecessorsPresent) {
      blockers.push("Current main lacks merged HR-case/applicant-privacy predecessor tables");
    }
    for (const table of ["expense_category_policies", "expense_claim_evidence"]) {
      if (!mainSchema.includes('"' + table + '"')) {
        blockers.push("Merged A4 schema is missing " + table);
      }
    }

    const startTag = "/** Per-expiry, per-milestone HR alert ledger; idempotent across scheduler retries. */";
    const endTag = 'export const invitations = pgTable(';
    const start = vaultSchema.indexOf(startTag);
    const end = start < 0 ? -1 : vaultSchema.indexOf(endTag, start);
    if (start < 0 || end < 0 || end <= start || vaultSchema.indexOf(startTag, start + 1) !== -1) {
      blockers.push("A5 expiry-notice ledger is absent or ambiguous");
    } else {
      const a5Only = vaultSchema.slice(start, end);
      evidence.a4SchemaPreserved = a5Only.includes('pgTable("hcm_document_expiry_notices"') &&
        vaultSchema.replace(a5Only, "") === mainSchema;
      if (!evidence.a4SchemaPreserved) {
        blockers.push("A5 schema modifies merged main beyond its additive expiry-notice ledger");
      }
    }

    const mainRetention = source(main, "src/lib/data-retention.ts");
    let a5Retention = source(vault, "src/lib/data-retention.ts");
    const expectedA5 = [
      'import { sweepPendingVaultUploads } from "@/lib/employee-vault-object-reconciliation";\n',
      "  // Private A5 upload intents must also be swept when its flag is rolled back.\n" +
      "  const pendingVaultObjectRecovery = await sweepPendingVaultUploads(new Date(now));\n",
      "    pendingVaultObjectRecovery,\n",
    ];
    let exact = true;
    for (const addition of expectedA5) {
      if (a5Retention.split(addition).length !== 2) {
        exact = false; break;
      }
      a5Retention = a5Retention.replace(addition, "");
    }
    evidence.a4RetentionPreserved = exact &&
      a5Retention === mainRetention &&
      mainRetention.includes("await sweepPendingSpendReceipts(new Date(now))") &&
      mainRetention.includes("await sweepPendingCoeObjects(new Date(now))");
    if (!evidence.a4RetentionPreserved) {
      blockers.push("A5 retention loses A4 receipt/COE recovery or changes unrelated main logic");
    }

    // Do not claim feature flags or proxy HCM guards are unchanged unless
    // their full committed bytes have actually been compared. These are
    // intentional default-OFF and fail-closed invariants for development QA.
    evidence.featureFlagsChanged = source(main, "src/lib/critical-release-flags.ts") !==
      source(vault, "src/lib/critical-release-flags.ts");
    evidence.hcmProxyChanged = source(main, "src/proxy.ts") !==
      source(vault, "src/proxy.ts");
    if (evidence.featureFlagsChanged) {
      blockers.push("A5 changes current-main critical feature flag definitions");
    }
    if (evidence.hcmProxyChanged) {
      blockers.push("A5 changes current-main HCM HTTP proxy guards");
    }
  } catch (error) {
    blockers.push("Could not inspect exact Git source snapshots: " +
      (error instanceof Error ? error.name : "unknown"));
  }
}
evidence.sourceReconciled = !blockers.length &&
  evidence.mergedA4InMain && evidence.vaultIncludesMain &&
  evidence.applicantHrPredecessorsPresent &&
  evidence.a4SchemaPreserved && evidence.a4RetentionPreserved &&
  evidence.featureFlagsChanged === false && evidence.hcmProxyChanged === false;
evidence.status = evidence.sourceReconciled ? "SOURCE_RECONCILED_ONLY" : "BLOCKED";
mkdirSync("qa-artifacts", { recursive: true });
writeFileSync("qa-artifacts/a4-a5-source-inventory.json",
  JSON.stringify(evidence, null, 2) + "\n");
console.log("A4 merged + A5 candidate source inventory:", evidence.status);
for (const reason of blockers) console.error("A4/A5 BLOCKED:", reason);
if (evidence.sourceReconciled) {
  console.log("Combined A4/A5 tests and migrations are NOT performed by this inventory.");
}
if (blockers.length) process.exitCode = 1;
