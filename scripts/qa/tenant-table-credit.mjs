#!/usr/bin/env node
/**
 * Credit every TENANT_TABLE row in the manifest and the client-facing overview, after the shared
 * tenant-table workflow (or the identical local runner) has passed. It never decides coverage on
 * its own: rows come from scripts/qa/tenant-table-http.mjs, and the inventory guard independently
 * re-validates each credit (exact row, prove present, profile flags on, workflow runs it).
 *
 *   node scripts/qa/tenant-table-credit.mjs --run-label "local PG16 2026-10-24"   # writes
 *   node scripts/qa/tenant-table-credit.mjs --check                                  # dry run
 *
 * Only GET methods currently marked GAP (or already credited to this table) are touched. Counts,
 * the "NOT ACCEPTED: N API methods" headline and the overview metric table are recomputed from
 * the manifest, never typed by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";

const TABLE = "scripts/qa/tenant-table-http.mjs";
const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const write = !process.argv.includes("--check");
const labelAt = process.argv.indexOf("--run-label");
const runLabel = labelAt > 0 ? process.argv[labelAt + 1] : null;
if (write && !runLabel) throw new Error("--run-label <where the table proof passed> is required to credit");

const suite = readFileSync(TABLE, "utf8");
const lines = suite.split("\n");
const tableStart = suite.indexOf("export const TENANT_TABLE = Object.freeze([");
const tableEnd = suite.indexOf("\n]);", tableStart);
const lineOf = (offset) => suite.slice(0, offset).split("\n").length;
const uniqueLine = (fragment) => {
  const at = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
  if (at.length !== 1) throw new Error(TABLE + ": expected exactly one line with " + fragment + ", found " + at.length);
  return at[0];
};
const ownPositiveLine = uniqueLine("const owned = expectStatus(await request(item.own,");
const foreignDenialLine = uniqueLine("const foreign = expectStatus(await request(item.foreign,");
const unchangedDbLine = uniqueLine("assert.deepEqual(victimAfter, victimBefore,");

const rows = [...suite.slice(tableStart, tableEnd).matchAll(/\n  \{ key: "(GET [^"]+)",/g)]
  .map((match) => ({ key: match[1], line: lineOf(tableStart + match.index + 1) }));
if (rows.length === 0) throw new Error("TENANT_TABLE has no rows");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const byKey = new Map(Object.entries(manifest.allApiRouteFiles).flatMap(([path, record]) =>
  record.methods.map((method) => [method.name + " " + record.route, { path, record, method }])));
const credited = [];
for (const row of rows) {
  const hit = byKey.get(row.key);
  if (!hit) throw new Error(row.key + ": not in the manifest");
  const { method } = hit;
  if (method.status !== "GAP" && method.testedBy?.file !== TABLE) {
    throw new Error(row.key + ": already " + method.status + " by " + method.testedBy?.file + "; not re-crediting");
  }
  const was = method.status;
  method.status = "COVERED";
  method.reason = "Provisional: table-driven disposable PG16 real-HTTP proof (" + (runLabel ?? method.testedBy?.evidence ?? "check") +
    "): two independently authenticated attacker employers each get own-employer 200 whose body carries their own seeded marker, " +
    "the real higher-ID victim employer is denied, and victim PostgreSQL rows and audit are unchanged; NOT production or blanket tenant certification; exact PR-head CI and reviewer acceptance required.";
  method.testedBy = {
    file: TABLE, line: row.line, ownPositiveLine, foreignDenialLine, unchangedDbLine,
    scope: "Organization-selector GET only. Owner sessions of two fictional employers; own ?organizationId= 200 with row-specific own-data proof, victim ?organizationId= denial, exact victim snapshot unchanged (CI PG16 only).",
    evidence: "Shared tenant-table workflow (.github/workflows/tenant-table-proof.yml); " + (runLabel ?? "see prior credit"),
  };
  credited.push({ ...row, path: hit.path, routeLine: method.line, was });
}

const all = Object.values(manifest.allApiRouteFiles).flatMap((record) => record.methods);
const tally = (status) => all.filter((method) => method.status === status).length;
const before = { coveredAfter: manifest.metrics.coveredAfter, gap: manifest.metrics.gap };
manifest.metrics.coveredAfter = tally("COVERED");
manifest.metrics.publicByDesign = tally("PUBLIC-BY-DESIGN");
manifest.metrics.gap = tally("GAP");
const fresh = credited.filter((row) => row.was === "GAP");
const headline = /^NOT ACCEPTED: \d+ API methods/;
if (!headline.test(manifest.acceptanceStatus)) throw new Error("manifest headline has an unexpected shape");
manifest.acceptanceStatus = manifest.acceptanceStatus.replace(headline, "NOT ACCEPTED: " + manifest.metrics.gap + " API methods");
const note = "Tenant-table proof adds " + fresh.length + " provisional organization-selector GET credits (own-marker 200, victim denial, unchanged victim DB, two attackers): " +
  manifest.metrics.coveredAfter + " COVERED / " + manifest.metrics.publicByDesign + " PUBLIC-BY-DESIGN / " + manifest.metrics.gap + " GAP; no global tenant-isolation acceptance.";
if (fresh.length && !manifest.acceptanceStatus.includes(note)) manifest.acceptanceStatus += " " + note;

let overview = readFileSync(OVERVIEW, "utf8");
const pageGaps = manifest.scopedPages.filter((page) => page.status === "GAP").length;
const replaceOnce = (pattern, replacement, what) => {
  if (!pattern.test(overview)) throw new Error(OVERVIEW + ": missing " + what);
  overview = overview.replace(pattern, replacement);
};
replaceOnce(/\*\*RELEASE BLOCKER:\*\* \d+ API methods and \d+ business-ID page entries/,
  "**RELEASE BLOCKER:** " + manifest.metrics.gap + " API methods and " + pageGaps + " business-ID page entries", "release blocker headline");
replaceOnce(/\*\*NOT ACCEPTED\*\*: \d+ method gaps and \d+ page\/action gaps/,
  "**NOT ACCEPTED**: " + manifest.metrics.gap + " method gaps and " + pageGaps + " page/action gaps", "not accepted headline");
for (const key of ["coveredAfter", "publicByDesign", "gap"]) {
  replaceOnce(new RegExp("^\\| " + key + " \\| \\d+ \\|$", "m"), "| " + key + " | " + manifest.metrics[key] + " |", key + " metric row");
}
for (const row of credited) {
  const route = row.key.slice(4);
  const prefix = "| [`" + route + "` GET](";
  const at = overview.split("\n").findIndex((text) => text.startsWith(prefix));
  if (at < 0) throw new Error(OVERVIEW + ": no method row for " + row.key);
  const cells = overview.split("\n")[at].split(" | ");
  cells[cells.length - 2] = "[Tenant-table own-marker/victim PG16 proof](../../" + TABLE + "#L" + ownPositiveLine + ") — row L" + row.line;
  cells[cells.length - 1] = "**COVERED** |";
  const all = overview.split("\n");
  all[at] = cells.join(" | ");
  overview = all.join("\n");
}
const marker = "**Tenant-table organization-selector reads (provisional, NOT ACCEPTED):**";
const paragraph = marker + " [one shared table runner](../../" + TABLE + ") and [one shared workflow](../../.github/workflows/tenant-table-proof.yml) prove " +
  credited.length + " GET methods whose only employer selector is `?organizationId=`. For each row, two independently signed-in fictional attacker employers receive 200 " +
  "whose body carries that employer's own seeded marker, the same session naming a real higher-ID victim employer is denied, no victim marker appears in either response, and the victim's PostgreSQL rows and audit are unchanged. " +
  "Rows whose response is empty for a fresh employer are deliberately not credited: an empty list cannot distinguish own-employer scoping from no data. Combined **" +
  manifest.metrics.coveredAfter + " COVERED / " + manifest.metrics.publicByDesign + " PUBLIC-BY-DESIGN / " + manifest.metrics.gap + " GAP** plus " + pageGaps +
  " page/action GAPs. Exact-head CI and independent security review are required; no production, provider, filing or payout system is touched.";
const existing = overview.split("\n").findIndex((text) => text.startsWith(marker));
if (existing >= 0) {
  const all = overview.split("\n"); all[existing] = paragraph; overview = all.join("\n");
} else {
  replaceOnce(/^(\| Metric \| Count \|)$/m, paragraph + "\n\n$1", "metric table");
}

console.log(JSON.stringify({ rows: credited.length, newlyCredited: fresh.length, before,
  after: { coveredAfter: manifest.metrics.coveredAfter, gap: manifest.metrics.gap }, write }));
if (write) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
}
