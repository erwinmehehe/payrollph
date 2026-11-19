#!/usr/bin/env node
/**
 * Read-only impact report for an edit to a pinned API route file.
 *
 * The tenant coverage manifest pins every route by its whole-file Git blob, so ANY edit to a
 * route.ts file fails the inventory and withdraws provisional credit for EVERY method in it, even
 * a method whose own code did not change. Authors learn that from a red CI run (that is how #2025
 * first failed). This tool tells them up front, and shows which methods' own handler text is
 * untouched, so a reviewer can see what a sibling-only edit actually put at stake.
 *
 *   node scripts/qa/tenant-route-edit-impact.mjs [--base <git-ref>] [--json] [--strict]
 *
 * It NEVER writes, re-pins or re-credits anything and it does not weaken the whole-blob rule: a
 * changed route still needs fresh method proof and independent security review. "Own text
 * untouched" is information for that review, not a credit.
 *
 * Exit status: 0 unless --strict, where it is 1 if any credited method sits in a changed route.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const HTTP = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const STARTER = /^(export|import|async function|function|const|let|var|type|interface|class|enum|declare)\b/;
const COMMENT = /^(\/\/|\/\*|\*)/;
const HANDLER = new RegExp(
  "^export\\s+(?:async\\s+)?(?:function\\s+|const\\s+)(" + HTTP.join("|") + ")\\b",
);

const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const normalize = (text) => text.replace(/\r\n/g, "\n");

/** Split a route file into top-level blocks. A comment run directly above a block belongs to it. */
export function splitBlocks(source) {
  const lines = normalize(source).split("\n");
  const blocks = [];
  let current = { lines: [] };
  for (const line of lines) {
    if (STARTER.test(line)) {
      const carried = [];
      while (current.lines.length && (COMMENT.test(current.lines[current.lines.length - 1]) || current.lines[current.lines.length - 1].trim() === "")) {
        const tail = current.lines[current.lines.length - 1];
        if (tail.trim() === "") break;
        carried.unshift(current.lines.pop());
      }
      blocks.push(current);
      current = { lines: [...carried, line] };
    } else {
      current.lines.push(line);
    }
  }
  blocks.push(current);
  return blocks.filter((block) => block.lines.length > 0);
}

/** Handler text per HTTP method, plus everything that is not a handler ("shared"). */
export function segmentRoute(source) {
  const methods = {};
  const shared = [];
  for (const block of splitBlocks(source ?? "")) {
    const header = block.lines.find((line) => STARTER.test(line)) ?? "";
    const match = HANDLER.exec(header);
    const text = block.lines.join("\n");
    if (match) methods[match[1]] = text;
    else shared.push(text);
  }
  return { methods, shared: shared.join("\n") };
}

/**
 * Compare two versions of one route file.
 * Returns per-method state and whether shared (non-handler) code changed.
 */
export function analyzeRouteEdit(baseSource, headSource) {
  const before = segmentRoute(baseSource);
  const after = segmentRoute(headSource);
  const sharedChanged = sha(before.shared.trim()) !== sha(after.shared.trim());
  const names = [...new Set([...Object.keys(before.methods), ...Object.keys(after.methods)])].sort();
  const methods = names.map((name) => {
    const was = before.methods[name];
    const now = after.methods[name];
    let state = "UNCHANGED";
    if (was === undefined) state = "ADDED";
    else if (now === undefined) state = "REMOVED";
    else if (sha(was.trim()) !== sha(now.trim())) state = "CHANGED";
    return { name, state };
  });
  return { sharedChanged, methods };
}

const CREDITED = new Set(["COVERED", "PUBLIC-BY-DESIGN", "PRIVILEGED-OPERATIONS-TOKEN-ONLY"]);

/** Fold the manifest's recorded status in, and say what the edit means for each method. */
export function describeImpact(path, analysis, manifestRoute) {
  const status = new Map((manifestRoute?.methods ?? []).map((method) => [method.name, method.status]));
  const rows = analysis.methods.map(({ name, state }) => {
    const recorded = status.get(name) ?? "NOT-IN-MANIFEST";
    const credited = CREDITED.has(recorded);
    let meaning;
    if (state === "ADDED") meaning = "new handler: no proof exists";
    else if (state === "REMOVED") meaning = "handler removed";
    else if (state === "CHANGED") meaning = "own code changed: needs fresh proof";
    else if (analysis.sharedChanged) meaning = "own code untouched, but shared code (imports/helpers/config) changed: needs fresh proof";
    else meaning = "own code untouched (sibling-only edit): whole-blob pin still requires re-proof, reviewer may accept";
    return { name, state, recorded, credited, meaning };
  });
  return {
    path,
    sharedChanged: analysis.sharedChanged,
    creditedAtStake: rows.filter((row) => row.credited).length,
    methods: rows,
  };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
}
function showAt(ref, file) {
  try { return git(["show", ref + ":" + file]); } catch { return null; }
}

function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : (process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main");
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const changed = git(["diff", "--name-only", base, "--", "src/app/api"]).split("\n")
    .filter((file) => /^src\/app\/api\/.*\/route\.ts$/.test(file));
  const reports = changed.map((file) => {
    const baseSource = showAt(base, file);
    let headSource = null;
    try { headSource = readFileSync(file, "utf8"); } catch { /* deleted */ }
    return describeImpact(file, analyzeRouteEdit(baseSource, headSource), manifest.allApiRouteFiles?.[file]);
  });
  if (json) {
    console.log(JSON.stringify({ base, changedRoutes: reports.length, reports }, null, 2));
  } else if (!reports.length) {
    console.log("No pinned API route file differs from " + base + ": no tenant proof is put at stake.");
  } else {
    for (const report of reports) {
      console.log(report.path + "  (credited methods at stake: " + report.creditedAtStake + (report.sharedChanged ? "; shared code changed" : "") + ")");
      for (const row of report.methods) {
        console.log("  " + row.name.padEnd(7) + row.state.padEnd(10) + row.recorded.padEnd(34) + row.meaning);
      }
    }
    console.log("\nThe whole-blob route pin is unchanged by this tool: every route above needs fresh method proof and independent review before any credit is renewed.");
  }
  if (strict && reports.some((report) => report.creditedAtStake > 0)) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
