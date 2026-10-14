#!/usr/bin/env node
/**
 * READ-ONLY inventory for a fresh-main A4/A5 successor to historical #927.
 * Inspects Git objects only. It never checks out feature code, applies SQL,
 * signs approvals, activates feature flags or merges owner PR branches.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const runGit = (...args) => execFileSync("git", args, { encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"] }).trim();
const exists = sha => spawnSync("git", ["cat-file", "-e", sha + "^{commit}"],
  { stdio: "ignore" }).status === 0;
const contains = (ancestor, head) => spawnSync("git",
  ["merge-base", "--is-ancestor", ancestor, head], { stdio: "ignore" }).status === 0;

const blockers = [];
const refNames = ["A4_A5_BASE_SHA", "A4_A5_SPEND_SHA", "A4_A5_VAULT_SHA"];
const refs = Object.fromEntries(refNames.map(key => [key, process.env[key] ?? ""]));
const manifest = {
  mode: "read-only-source-inventory", historicalPr: 927,
  ownerPrs: { spend: 896, vault: 902 },
  refs, featureOff: "not modified", databaseWrites: false,
  verifiedCombinedSource: false, verifiedMigration: false,
  owners: {}, overlaps: [], blockers,
};
if (process.env.CI !== "true" || process.env.A4_A5_INVENTORY_MODE !== "read-only-ci") {
  blockers.push("CI=true and A4_A5_INVENTORY_MODE=read-only-ci are required");
}
for (const [key, sha] of Object.entries(refs)) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !exists(sha)) {
    blockers.push(key + " must refer to an available exact 40-character Git commit");
  }
}
if (blockers.length === 0) {
  const main = refs.A4_A5_BASE_SHA;
  try {
    const schema = runGit("show", main + ":src/db/schema.ts");
    for (const table of ["employee_hr_cases", "applicant_privacy_evidence"]) {
      const expression = new RegExp("\\bpgTable\\s*\\(\\s*['\\\"]" + table + "['\\\"]");
      if (!expression.test(schema)) {
        blockers.push("Current-main schema does not contain already-merged " + table);
      }
    }
    for (const [name, sha] of [
      ["spend", refs.A4_A5_SPEND_SHA],
      ["vault", refs.A4_A5_VAULT_SHA],
    ]) {
      const ancestor = runGit("merge-base", main, sha);
      const changed = runGit("diff", "--name-only", "--diff-filter=ACDMRT", ancestor, sha)
        .split("\n").filter(Boolean).sort();
      const upToDate = contains(main, sha);
      manifest.owners[name] = { sha, mergeBase: ancestor, containsCurrentMain: upToDate,
        changedPaths: changed };
      if (!upToDate) blockers.push("PR #" + (name === "spend" ? 896 : 902) +
        " must reconcile to pinned current main before combined source testing");
    }
    const a4 = new Set(manifest.owners.spend?.changedPaths ?? []);
    manifest.overlaps = (manifest.owners.vault?.changedPaths ?? [])
      .filter(path => a4.has(path));
    if (manifest.overlaps.length) {
      blockers.push("Overlapping A4/A5 source paths require explicit conflict resolution; " +
        "never overwrite shared schema, retention or payroll code with one owner's full tree");
    }
  } catch (error) {
    blockers.push("Unable to inspect pinned local Git sources: " +
      (error instanceof Error ? error.name : "unknown error"));
  }
}

manifest.status = blockers.length ? "BLOCKED" : "INVENTORY_ONLY";
manifest.combinedAcceptance = "NOT_RUN";
mkdirSync("qa-artifacts", { recursive: true });
writeFileSync("qa-artifacts/a4-a5-source-inventory.json",
  JSON.stringify(manifest, null, 2) + "\n");
console.log("A4/A5 fresh-main source inventory:", manifest.status);
console.log("Overlapping source paths:", JSON.stringify(manifest.overlaps));
for (const message of blockers) console.error("A4/A5 BLOCKED:", message);
if (!blockers.length) {
  console.log("Inventory complete. This does NOT prove combined tests or migrations.");
}
if (blockers.length) process.exitCode = 1;
