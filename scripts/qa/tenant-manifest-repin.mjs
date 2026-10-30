#!/usr/bin/env node
/**
 * Re-pin tenant-isolation proof line numbers after a proof file shifts.
 *
 * Every COVERED method cites exact lines (ownPositiveLine, foreignDenialLine, unchangedDbLine,
 * ...). Inserting one line above them used to force hand-edited "repin" commits. For each citation
 * the BASE manifest already had (same method, same proof file), this tool reads the cited TEXT at
 * the base line number in the base proof file and checks the current citation still points at it,
 * else finds that exact text in the current file. It re-pins only on a unique exact match; anything
 * moved ambiguously or edited is reported for a human, never guessed. Citations that are new in
 * this change (a new credit) have nothing to compare against and are left to the inventory guard.
 * It never touches statuses, route SHAs or proof claims.
 *
 *   node scripts/qa/tenant-manifest-repin.mjs [--base <git-ref>] [--write]
 * Without --write it only reports (exit 1 if anything would change or needs review).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
// The client-facing overview links proof lines as (../../<file>#L<n>); moved lines move there too.
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const args = process.argv.slice(2);
const write = args.includes("--write");
const baseRef = args[args.indexOf("--base") + 1] && args.includes("--base")
  ? args[args.indexOf("--base") + 1]
  : (process.env.FAIL_CLOSED_GUARD_BASE_REF || "origin/main");

const raw = readFileSync(MANIFEST, "utf8");
const manifest = JSON.parse(raw);
const baseManifest = (() => {
  try { return JSON.parse(execFileSync("git", ["show", baseRef + ":" + MANIFEST], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 })); }
  catch { return null; }
})();
/** The same method's citation of the same proof file on the base, if it existed. */
const baseCitation = (path, methodName, kind, file) => {
  const proof = baseManifest?.allApiRouteFiles?.[path]?.methods?.find((m) => m.name === methodName)?.[kind];
  return proof && typeof proof === "object" && proof.file === file ? proof : null;
};
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
const nowLines = (file) => linesAt(currentText, file, (f) => {
  try { return readFileSync(f, "utf8").split("\n"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
});

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
const anchorMoves = new Map(); // "<file>#L<old>" -> new line
let unchanged = 0, newCitations = 0;
for (const [path, record] of Object.entries(manifest.allApiRouteFiles)) {
  for (const method of record.methods) {
    for (const kind of ["testedBy", "reviewedUncertified"]) {
      const proof = method[kind];
      if (!proof || typeof proof !== "object" || typeof proof.file !== "string") continue;
      const cited = baseCitation(path, method.name, kind, proof.file);
      for (const [field, value] of Object.entries(proof)) {
        if (!/Line$|^line$/.test(field) || !Number.isInteger(value) || ROUTE_SOURCE_FIELDS.has(field)) continue;
        // Family rows and shared HTTP assertions have separate source files. The
        // initial split moves the old row citation to rowFile/rowLine; `line`
        // becomes the shared own-positive execution pin, checked by the inventory guard.
        if (field === "line" && proof.rowFile && !cited?.rowFile) { newCitations += 1; continue; }
        // A *Line citation can name its own *File (rowLine/rowFile or
        // victimUnchangedLine/victimUnchangedFile). Never pin it against the
        // primary proof file when the manifest declares a companion file.
        const companionFile = field === "line" ? null : field.replace(/Line$/, "File");
        const file = companionFile && typeof proof[companionFile] === "string"
          ? proof[companionFile] : proof.file;
        const oldFile = companionFile && typeof cited?.[companionFile] === "string"
          ? cited[companionFile] : cited?.file;
        const before = oldFile ? baseLines(oldFile) : null;
        const now = nowLines(file);
        if (!now) { review.push(`${method.name} ${path}: evidence file ${file} no longer exists`); continue; }
        const baseValue = field === "rowLine" ? (cited?.rowLine ?? cited?.line) : cited?.[field];
        // New proof file or new citation (a credit added in this change): nothing to compare against.
        if (!before || !Number.isInteger(baseValue)) { newCitations += 1; continue; }
        const text = before[baseValue - 1];
        if (text === undefined) { review.push(`${method.name} ${path} ${field}=${baseValue}: base citation pointed past the end of ${oldFile} at ${baseRef}`); continue; }
        if (now[value - 1] === text) { unchanged += 1; continue; }
        const { hits, at } = relocate(before, now, baseValue);
        if (at !== undefined) {
          moved.push(`${method.name} ${path} ${field}: ${value} -> ${at}`);
          proof[field] = at;
          anchorMoves.set(file + "#L" + value, at);
        } else {
          review.push(`${method.name} ${path} ${field}=${value}: cited text ${hits.length ? "now appears " + hits.length + " times" : "was edited or removed"} (${JSON.stringify(text.trim().slice(0, 90))})`);
        }
      }
    }
  }
}
if (write && moved.length) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  // One pass over the overview, so a chain of moves (L10->L11, L11->L12) cannot double-shift a link.
  // Read directly (no exists-then-write check): a missing overview just means nothing to update.
  let doc = null;
  try { doc = readFileSync(OVERVIEW, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (doc !== null) {
    const next = doc.replace(/\(\.\.\/\.\.\/([^)#\s]+)#L(\d+)\)/g, (link, file, line) => {
      const at = anchorMoves.get(file + "#L" + line);
      return at === undefined ? link : "(../../" + file + "#L" + at + ")";
    });
    if (next !== doc) writeFileSync(OVERVIEW, next);
  }
}
console.log(JSON.stringify({ base: baseRef, unchanged, newCitations, repinned: moved.length, needsReview: review.length, wrote: write && moved.length > 0 }, null, 1));
for (const line of moved) console.log("repin  " + line);
for (const line of review) console.log("REVIEW " + line);
if ((!write && moved.length) || review.length) process.exitCode = 1;
