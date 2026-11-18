/** Read-only planning for a future per-method renewal receipt. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";
import { collectRenewalInputs } from "./payroll-run-renewal-inputs.mjs";
import { methodKey, requiredWageFamilies } from "./wage-registry-renewal-methods.mjs";
import { INVENTORY, readWageRenewalInventory } from "./wage-registry-renewal-plan.mjs";
import { generatedWorkflow, RECIPES, OUTPUT } from "./wage-registry-renewal-workflow.mjs";
import { verifiedWageCreditHolds } from "./wage-registry-credit-holds.mjs";
import { historicalReceiptInputs, literalJobInputs, reviewedTableInputs } from "./wage-method-job-inputs.mjs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const COMMON_ROOTS = [
  ".gitattributes", OUTPUT, "src/proxy.ts", "src/instrumentation.ts",
  "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "drizzle.config.ts",
  "scripts/qa/apply-isolated-baseline.mjs", "docs/sql/source-baseline-supplement.sql",
  "scripts/qa/apply-audit-0109-isolated.mjs", "scripts/qa/apply-source-baseline-supplement.mjs",
  "scripts/qa/wage-registry-renewal-workflow.mjs",
];
const METHOD_PROOF_FILES = ["file", "rowFile", "sourceRowFile", "rejectedFile", "testFile", "workflowFile"];
const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const inGlobalDirectory = (file) => file.startsWith("src/db/") || file.startsWith("drizzle/");

export function comparePlannedSources(plan, changedPaths) {
  const changes = [...new Set(changedPaths)].sort();
  const commonChanges = changes.filter((file) =>
    Object.hasOwn(plan.globalPins, file) || inGlobalDirectory(file));
  const affected = plan.methods.flatMap(({ key, sourcePins }) => {
    const methodChanges = changes.filter((file) => Object.hasOwn(sourcePins, file));
    return commonChanges.length || methodChanges.length ? [{ key, methodChanges }] : [];
  });
  return { commonChanges, affected };
}

export function buildWageMethodSourcePlan() {
  const sourceHead = git(["rev-parse", "HEAD"]).trim();
  const dirty = git(["diff", "--name-only", "HEAD", "--"]).trim();
  assert.equal(dirty, "", "Use a clean tracked checkout for source planning");
  const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
  const readCache = new Map();
  const read = (file) => {
    assert.ok(tracked.has(file), "Dependency is not tracked: " + file);
    if (!readCache.has(file)) readCache.set(file, readFileSync(file));
    return readCache.get(file);
  };
  const collect = (roots) => collectRenewalInputs(roots, read, (file) => tracked.has(file));
  const inventory = readWageRenewalInventory(read);
  const manifest = JSON.parse(read(MANIFEST));
  const holds = verifiedWageCreditHolds(manifest);
  const expected = new Set(inventory.methods.map(methodKey));
  assert.deepEqual(holds, expected, "The reviewed 75-method cohort must still match the live holds");

  const globalRoots = [...new Set([
    ...COMMON_ROOTS,
    ...[...tracked].filter(inGlobalDirectory),
  ])].sort();
  const globalPins = collect(globalRoots);
  const workflowText = read(OUTPUT).toString("utf8");
  assert.equal(workflowText, generatedWorkflow(), "Generated workflow must match its checked-in recipes");
  const workflow = yaml.load(workflowText);
  const { scripts } = JSON.parse(read("package.json"));
  const jobInputsByFamily = new Map();
  for (const family of Object.keys(RECIPES)) {
    const jobs = Object.entries(workflow.jobs).filter(([id]) => id.startsWith(family + "__"));
    assert.ok(jobs.length, "Missing jobs from the renewal workflow: " + family);
    const commands = jobs.flatMap(([, job]) => (job.steps ?? [])
      .flatMap((step) => [step.run, step.uses].filter((value) => typeof value === "string")));
    jobInputsByFamily.set(family, literalJobInputs(commands, scripts, tracked));
  }
  const methods = inventory.methods.map((entry) => {
    const key = methodKey(entry);
    const live = manifest.allApiRouteFiles[entry.path];
    const row = live.methods.find((candidate) => candidate.name === entry.verb);
    assert.equal(row.status, "GAP", "Current method must remain held: " + key);
    assert.equal(row.testedBy, null);
    assert.equal(row.reviewedUncertified.coverageCredits, 0);
    const proof = entry.held.reviewedUncertified.priorProof;
    const families = requiredWageFamilies(entry);
    const jobInputs = [...new Set(families.flatMap((family) => {
      assert.ok(jobInputsByFamily.has(family), "Missing job inputs for " + family);
      return jobInputsByFamily.get(family);
    }))].sort();
    const historicalInputs = historicalReceiptInputs(proof.receiptFile, read, tracked);
    const workflows = families.map((family) => {
      assert.ok(RECIPES[family], "Missing reviewed workflow mapping for " + family);
      return ".github/workflows/" + RECIPES[family][0];
    });
    const roots = [...new Set([
      entry.path,
      ...METHOD_PROOF_FILES.flatMap((field) => typeof proof[field] === "string" ? [proof[field]] : []),
      ...workflows,
      ...jobInputs,
      ...historicalInputs,
    ])].sort();
    const staticPins = collect(roots);
    const computedInputs = reviewedTableInputs(Object.keys(staticPins), tracked, readdirSync);
    const pins = computedInputs.length ? collect([...roots, ...computedInputs]) : staticPins;
    assert.equal(pins[entry.path], live.gitBlobSha, "Route pin must match the live manifest: " + key);
    return {
      key, families, roots,
      jobInputs, historicalInputs, computedInputs,
      historicalReceipt: proof.receiptFile ?? null,
      sourcePins: Object.fromEntries(Object.entries(pins).filter(([path]) => !(path in globalPins))),
      execution: "NOT_RUN",
      coverageCredits: 0,
    };
  });
  return {
    schema: "payrollph-wage-method-source-plan-v2",
    sourceHead, inventory: INVENTORY, globalRoots, globalPins, methods,
    coverageCredits: 0,
    status: "PLANNING_ONLY",
    generatedInputs: {
      workflow: { path: OUTPUT, status: "RECIPE_PARITY_VERIFIED" },
      schema: { status: "PINNED_PRODUCERS_ONLY", outputs: "Disposable schema; execution proof must record its setup result." },
      profiles: { status: "PINNED_PRODUCERS_ONLY", outputs: "Matrix-specific environment; fresh jobs must attest the applied profile." },
      build: { status: "NOT_ATTESTED", outputs: "Next.js build output and runtime traces must come from the executed job." },
    },
    unresolvedEvidence: [
      "Review shell expansions, generated files, folder-based inputs, runtime file reads, and computed imports. Literal discovery is not a complete execution trace.",
      "Historical receipts supply dependency candidates; they do not establish current execution.",
      "Bind complete reviewed source inputs and successful fresh execution before any receipt or credit is accepted.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--changed-since"),
    "Usage: wage-method-source-plan.mjs [--changed-since <commit>]");
  const plan = buildWageMethodSourcePlan();
  if (args.length) {
    const before = git(["rev-parse", "--verify", "--end-of-options", args[1] + "^{commit}"]).trim();
    // Disable rename detection so comparison receives both the old and new paths.
    const paths = git(["diff", "--name-only", "--no-renames", "-z", before, plan.sourceHead, "--"])
      .split("\0").filter(Boolean);
    console.log(JSON.stringify({
      status: plan.status, sourceHead: plan.sourceHead, changedSince: before, coverageCredits: 0,
      ...comparePlannedSources(plan, paths),
      limitations: plan.unresolvedEvidence,
    }, null, 2));
  } else {
    console.log(JSON.stringify(plan, null, 2));
  }
}
