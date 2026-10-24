#!/usr/bin/env node
/**
 * Re-pin tenant-isolation proof line numbers after a proof file shifts.
 *
 * Every COVERED method cites exact lines (ownPositiveLine, foreignDenialLine, unchangedDbLine,
 * ...). Inserting one line above them used to force hand-edited "repin" commits. This tool reads
 * each cited line's TEXT from the base version of the proof file and finds that exact text in the
 * current file. It re-pins only on a unique exact match; anything moved ambiguously or edited is
 * reported for a human, never guessed. It never touches statuses, route SHAs or proof claims.
 *
 *   node scripts/qa/tenant-manifest-repin.mjs [--base <git-ref>] [--write]
 * Without --write it only reports (exit 1 if anything would change or needs review).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const args = process.argv.slice(2);
const write = args.includes("--write");
const baseRef = args[args.indexOf("--base") + 1] && args.includes("--base")
  ? args[args.indexOf("--base") + 1]
  : (process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main");

const raw = readFileSync(MANIFEST, "utf8");
const manifest = JSON.parse(raw);
const baseText = new Map();
const currentText = new Map();
const linesAt = (cache, file, loader) => {
  if (!cache.has(file)) cache.set(file, loader(file));
  return cache.get(file);
};
const baseLines = (file) => linesAt(baseText, file, (f) => {
  try { return execFileSync("git", ["show", baseRef + ":" + f], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }).split("\n"); }
  catch { return null; }
});
const nowLines = (file) => linesAt(currentText, file, (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n") : null));

// Fields that cite the ROUTE source, not the proof file. Never re-pinned against the proof file.
const ROUTE_SOURCE_FIELDS = new Set(["currentMembershipGuardLine"]);

/**
 * Pick where a cited line moved: unique exact text, or, when the text repeats, the unique
 * candidate whose surrounding lines (4 above, 4 below) all still match the base file.
 */
function relocate(before, now, value) {
  const text = before[value - 1];
  const hits = now.flatMap((line, i) => (line === text ? [i + 1] : []));
  if (hits.length <= 1) return { hits, at: hits[0] };
  const window = (lines, at) => lines.slice(Math.max(0, at - 5), at + 4).join("\n");
  const want = window(before, value);
  const exact = hits.filter((at) => window(now, at) === want);
  return { hits, at: exact.length === 1 ? exact[0] : undefined };
}

const moved = [], review = [];
let unchanged = 0;
for (const [path, record] of Object.entries(manifest.allApiRouteFiles)) {
  for (const method of record.methods) {
    for (const proof of [method.testedBy, method.reviewedUncertified].filter((p) => p && typeof p === "object")) {
      if (typeof proof.file !== "string") continue;
      const before = baseLines(proof.file);
      const now = nowLines(proof.file);
      if (!now) { review.push(`${method.name} ${path}: proof file ${proof.file} no longer exists`); continue; }
      for (const [field, value] of Object.entries(proof)) {
        if (!/Line$|^line$/.test(field) || !Number.isInteger(value) || ROUTE_SOURCE_FIELDS.has(field)) continue;
        if (!before) { unchanged += 1; continue; } // new proof file: nothing to compare against
        const text = before[value - 1];
        if (text === undefined) { review.push(`${method.name} ${path} ${field}=${value}: line did not exist at ${baseRef}`); continue; }
        if (now[value - 1] === text) { unchanged += 1; continue; }
        const { hits, at } = relocate(before, now, value);
        if (at !== undefined) {
          moved.push(`${method.name} ${path} ${field}: ${value} -> ${at}`);
          proof[field] = at;
        } else {
          review.push(`${method.name} ${path} ${field}=${value}: cited text ${hits.length ? "now appears " + hits.length + " times" : "was edited or removed"} (${JSON.stringify(text.trim().slice(0, 90))})`);
        }
      }
    }
  }
}
if (write && moved.length) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
console.log(JSON.stringify({ base: baseRef, unchanged, repinned: moved.length, needsReview: review.length, wrote: write && moved.length > 0 }, null, 1));
for (const line of moved) console.log("repin  " + line);
for (const line of review) console.log("REVIEW " + line);
if ((!write && moved.length) || review.length) process.exitCode = 1;
