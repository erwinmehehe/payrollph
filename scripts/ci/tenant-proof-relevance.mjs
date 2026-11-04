/**
 * Fail-closed relevance gate for expensive tenant PG16 proof workflows.
 * Unrelated GAP/zero-credit source-hash repins can skip costly HTTP proofs.
 * Relevant route, schema, test, workflow, or substantive manifest edits run.
 * This does not award tenant credits or authorize production release.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
export const INVENTORY = "tests/tenant-isolation-coverage-inventory.test.mjs";
const SHA = /^[0-9a-f]{40}$/;

export function workflowPaths(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex(line => /^    paths:\s*$/.test(line));
  if (start < 0) throw new Error("workflow lacks explicit pull_request paths");
  const paths = [];
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(/^      -\s+(.+?)\s*$/);
    if (!match) break;
    const value = match[1].replace(/^['"]|['"]$/g, "");
    if (!value || value.startsWith("!"))
      throw new Error("unsupported or negative workflow path filter");
    paths.push(value);
  }
  if (paths.length < 2 || !paths.includes(MANIFEST))
    throw new Error("workflow lacks reviewed shared-manifest path trigger");
  return paths;
}

export function matchesGlob(glob, filename) {
  let pattern = "^";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; pattern += "(?:.*/)?"; }
        else pattern += ".*";
      } else pattern += "[^/]*";
    } else if (char === "?") pattern += "[^/]";
    else pattern += /[\\^$+?.()|{}\[\]]/.test(char) ? "\\" + char : char;
  }
  return new RegExp(pattern + "$").test(filename);
}

function neutralizedManifest(source) {
  const doc = JSON.parse(source);
  if (!doc.allApiRouteFiles || !doc.metrics)
    throw new Error("unknown manifest schema");
  for (const record of Object.values(doc.allApiRouteFiles)) {
    if (!Array.isArray(record.methods)) throw new Error("unknown method schema");
    for (const method of record.methods) {
      const review = method.reviewedUncertified;
      if (method.status !== "GAP" || method.testedBy !== null ||
          !review || review.coverageCredits !== 0 ||
          review.independentSecurityReview !== "PENDING" ||
          review.productionCertified !== false) continue;
      for (const key of ["proofBlobSha", "contractBlobSha"]) {
        if (typeof review[key] === "string" && SHA.test(review[key]))
          review[key] = "<UNACCEPTED_SOURCE_PIN>";
      }
    }
  }
  return JSON.stringify(doc);
}

export function onlyUnacceptedManifestRepins(before, after) {
  return before !== after &&
    neutralizedManifest(before) === neutralizedManifest(after);
}

export function onlyInventoryHashRepins(before, after) {
  const neutral = text => text.replace(/\b[0-9a-f]{40}\b/g, "<SOURCE_SHA>");
  return before !== after && neutral(before) === neutral(after);
}

export function proofRequired({ changed, paths, manifestBefore, manifestAfter,
  inventoryBefore, inventoryAfter }) {
  if (!Array.isArray(changed) || !changed.length) return true;
  const specific = paths.filter(p => p !== MANIFEST && p !== INVENTORY);
  if (changed.some(file => specific.some(pattern => matchesGlob(pattern, file))))
    return true;
  // Inventory-only SHA substitutions cannot establish that the affected
  // method is GAP and uncredited. Require the reviewed manifest change too.
  if (!changed.includes(MANIFEST)) return true;
  if (changed.includes(MANIFEST) &&
      !onlyUnacceptedManifestRepins(manifestBefore, manifestAfter)) return true;
  if (changed.includes(INVENTORY) &&
      !onlyInventoryHashRepins(inventoryBefore, inventoryAfter)) return true;
  return false;
}

function run() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request")
    return { required: true, reason: "non-PR proof" };
  const base = process.env.PR_BASE_SHA;
  if (!SHA.test(base ?? "")) throw new Error("missing exact PR base SHA");
  const workflow = process.env.TENANT_WORKFLOW_FILE;
  if (!workflow?.startsWith(".github/workflows/") ||
      !workflow.endsWith(".yml")) throw new Error("invalid workflow path");
  const paths = workflowPaths(readFileSync(workflow, "utf8"));
  const changed = execFileSync("git",
    ["diff", "--name-only", "-z", base, "HEAD", "--"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  const before = file => execFileSync("git",
    ["show", base + ":" + file], { encoding: "utf8" });
  const args = { changed, paths };
  if (changed.includes(MANIFEST)) {
    args.manifestBefore = before(MANIFEST);
    args.manifestAfter = readFileSync(MANIFEST, "utf8");
  }
  if (changed.includes(INVENTORY)) {
    args.inventoryBefore = before(INVENTORY);
    args.inventoryAfter = readFileSync(INVENTORY, "utf8");
  }
  const required = proofRequired(args);
  return { required, reason: required ? "relevant or substantive change" :
    "unrelated source-pin change" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let outcome;
  try { outcome = run(); }
  catch (error) {
    // Missing Git history, invalid input or ambiguous scope must run real proof.
    console.error("Tenant relevance inconclusive; running real proof:", error.message);
    outcome = { required: true, reason: "fail-closed to real proof" };
  }
  console.log("Tenant proof required=" + outcome.required + " (" + outcome.reason + ")");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, "run=" + String(outcome.required) + "\n");
}
