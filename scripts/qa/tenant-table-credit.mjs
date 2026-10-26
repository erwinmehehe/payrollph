#!/usr/bin/env node
/**
 * Credit every row of the tenant proof tables in the manifest and the client-facing overview, after the
 * shared tenant-table workflow (or the identical local runners) has passed. It never decides coverage on
 * its own: rows come from the two runners, and the inventory guard independently re-validates each credit
 * (exact row, proof present, profile flags on, workflow runs it).
 *
 *   node scripts/qa/tenant-table-credit.mjs --run-label "local PG16 2026-10-24"   # writes
 *   node scripts/qa/tenant-table-credit.mjs --refresh-links                         # existing pins only
 *   node scripts/qa/tenant-table-credit.mjs --check                                  # dry run
 *
 * Family rows: scripts/qa/tenant-table-rows/{read,write}/*.mjs. Shared HTTP assertions
 * remain in the read/write runners. --refresh-links moves existing pins only and
 * refuses new GAP credits. Generate and review new credits BEFORE merging.
 * Only methods currently marked GAP (or already
 * credited to the same table) are touched. Counts, the "NOT ACCEPTED: N API methods" headline and the
 * overview metric table are recomputed from the manifest, never typed by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tenantFamilyCatalog } from "./tenant-table-catalog.mjs";
import { reviewedFamilySelection } from "./tenant-family-reconciliation.mjs";

const MANIFEST = "scripts/qa/tenant-isolation-coverage-manifest.json";
const OVERVIEW = "docs/engineering/tenant-isolation-coverage-inventory.md";
const write = !process.argv.includes("--check");
const refreshLinks = process.argv.includes("--refresh-links");
const labelAt = process.argv.indexOf("--run-label");
const runLabel = labelAt > 0 ? process.argv[labelAt + 1] : null;
// Explicit reviewed selection avoids crediting pending/partially exercised rows.
const selection = process.argv.includes("--reconcile-merged-families") ? reviewedFamilySelection() : null;
if (write && !refreshLinks && !runLabel) throw new Error("--run-label <where the table proof passed> is required to credit");

const SOURCES = [
  {
    kind: "read", file: "scripts/qa/tenant-table-http.mjs",
    own: "const owned = expectStatus(await request(item.own,", foreign: "const foreign = expectStatus(await request(item.foreign,",
    unchanged: "assert.deepEqual(victimAfter, victimBefore,",
    workflow: ".github/workflows/tenant-table-proof.yml",
    reason: (label) => "Provisional: table-driven disposable PG16 real-HTTP proof (" + label + "): two independently authenticated attacker employers each get own-employer 200 whose body carries their own seeded marker, " +
      "the real higher-ID victim employer is denied, and victim PostgreSQL rows and audit are unchanged; NOT production or blanket tenant certification; exact PR-head CI and reviewer acceptance required.",
    scope: "Organization-selector GET only. Owner sessions of two fictional employers; own ?organizationId= 200 with row-specific own-data proof, victim ?organizationId= denial, exact victim snapshot unchanged (CI PG16 only).",
    evidenceName: "Shared tenant-table workflow (.github/workflows/tenant-table-proof.yml); ",
    overviewLabel: "Tenant-table own-marker/victim PG16 proof",
    paragraphMarker: "**Tenant-table organization-selector reads (provisional, NOT ACCEPTED):**",
    paragraph: (n, totals, pageGaps) => "**Tenant-table organization-selector reads (provisional, NOT ACCEPTED):** [one shared table runner](../../scripts/qa/tenant-table-http.mjs) and [one shared workflow](../../.github/workflows/tenant-table-proof.yml) prove " +
      n + " GET methods whose only employer selector is `?organizationId=`. For each row, two independently signed-in fictional attacker employers receive 200 " +
      "whose body carries that employer's own seeded marker, the same session naming a real higher-ID victim employer is denied, no victim marker appears in either response, and the victim's PostgreSQL rows and audit are unchanged. " +
      "Rows whose response is empty for a fresh employer are deliberately not credited: an empty list cannot distinguish own-employer scoping from no data. Combined **" +
      totals + "** plus " + pageGaps + " page/action GAPs. Exact-head CI and independent security review are required; no production, provider, filing or payout system is touched.",
  },
  {
    kind: "write", file: "scripts/qa/tenant-write-table-http.mjs",
    own: 'const owned = expectStatus(await request(urlFor("own"),', foreign: 'const foreign = expectStatus(await request(urlFor("foreign"),',
    unchanged: "assert.deepEqual(victimAfter, victimBefore,",
    workflow: ".github/workflows/tenant-table-proof.yml",
    reason: (label) => "Provisional: write-table disposable PG16 real-HTTP proof (" + label + "): two independently authenticated attacker employers each perform the write for their own employer with the exact status and the own PostgreSQL rows change as the row's expectation states, " +
      "the same session naming the real higher-ID victim employer (or a victim row id) is denied with the exact status, and the victim's rows and audit are unchanged; NOT production or blanket tenant certification; exact PR-head CI and reviewer acceptance required.",
    scope: "Employer-scoped write (POST/PATCH/PUT/DELETE). Owner sessions of two fictional employers; own write succeeds and is read back from PostgreSQL, victim organizationId or victim row id is denied, optional forged victim reference writes nothing, exact victim rows and audit unchanged, and each row's expectation rejects the other attacker's genuine before/after (CI PG16 only).",
    evidenceName: "Shared tenant-table workflow write step (.github/workflows/tenant-table-proof.yml); ",
    overviewLabel: "Tenant write-table own-write/victim PG16 proof",
    paragraphMarker: "**Tenant write-table employer-scoped writes (provisional, NOT ACCEPTED):**",
    paragraph: (n, totals, pageGaps) => "**Tenant write-table employer-scoped writes (provisional, NOT ACCEPTED):** [one shared write runner](../../scripts/qa/tenant-write-table-http.mjs) runs in the [shared table workflow](../../.github/workflows/tenant-table-proof.yml) and proves " +
      n + " POST/PATCH/PUT/DELETE methods. For each row, two independently signed-in fictional attacker employers perform the write for their own employer (exact status, and the change is read back from PostgreSQL), " +
      "the same session naming a real higher-ID victim employer or a victim row id is denied, an optional forged victim reference writes nothing, no victim marker appears in any response, and the victim's PostgreSQL rows and audit are unchanged. " +
      "Each row's expectation must also reject the other attacker's genuine before/after. Combined **" + totals + "** plus " + pageGaps +
      " page/action GAPs. Exact-head CI and independent security review are required; no production, provider, filing or payout system is touched.",
  },
];

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const byKey = new Map(Object.entries(manifest.allApiRouteFiles).flatMap(([path, record]) =>
  record.methods.map((method) => [method.name + " " + record.route, { path, record, method }])));

const credited = [];
const bySource = new Map();
for (const source of SOURCES) {
  const suite = readFileSync(source.file, "utf8");
  const lines = suite.split("\n");
  const uniqueLine = (fragment) => {
    const at = lines.flatMap((text, i) => (text.includes(fragment) ? [i + 1] : []));
    if (at.length !== 1) throw new Error(source.file + ": expected exactly one line with " + fragment + ", found " + at.length);
    return at[0];
  };
  const ownPositiveLine = uniqueLine(source.own);
  const foreignDenialLine = uniqueLine(source.foreign);
  const unchangedDbLine = uniqueLine(source.unchanged);
  const rows = tenantFamilyCatalog(source.kind);
  bySource.set(source.kind, rows.length);
  for (const row of rows) {
    const hit = byKey.get(row.key);
    if (!hit) throw new Error(row.key + ": not in the manifest");
    const { method } = hit;
    const ownedHere = method.testedBy?.file === source.file;
    if (method.status !== "GAP" && !ownedHere) continue; // Preserve independently reviewed proof provenance.
    if (refreshLinks && !ownedHere) continue; // Pending rows remain GAP until an executed proof is credited.
    if (selection && !ownedHere && !selection.methods.has(row.key)) continue;
    const selected = selection?.methods.get(row.key);
    const retainEvidence = refreshLinks || (selection && !selected);
    const was = method.status;
    method.status = "COVERED";
    if (!retainEvidence) method.reason = source.reason(selected ? selection.receipt.run : (runLabel ?? method.testedBy?.evidence ?? "check"));
    method.testedBy = {
      ...method.testedBy,
      file: source.file, line: ownPositiveLine, rowFile: row.file, rowLine: row.line, ownPositiveLine, foreignDenialLine, unchangedDbLine,
      scope: retainEvidence ? method.testedBy.scope : (selected?.scope ?? source.scope),
      evidence: retainEvidence ? method.testedBy.evidence : source.evidenceName + (selected ? selection.receipt.run : (runLabel ?? "see prior credit")),
      ...(selected ? { reviewedHead: selection.receipt.reviewedHead, passedJob: selection.receipt.run + "/job/" + selection.receipt.profiles.default.job } : {}),
    };
    credited.push({ ...row, source, path: hit.path, was });
  }
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
const note = "Tenant-table proofs add " + fresh.length + " provisional organization-scoped read and write credits (own-data 200 or own write read back from PostgreSQL, victim denial, unchanged victim DB, two attackers): " +
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
  const [verb, route] = row.key.split(" ");
  const prefix = "| [`" + route + "` " + verb + "](";
  const rowLines = overview.split("\n");
  const at = rowLines.findIndex((text) => text.startsWith(prefix));
  if (at < 0) throw new Error(OVERVIEW + ": no method row for " + row.key);
  const cells = rowLines[at].split(" | ");
  const proof = manifest.allApiRouteFiles[row.path].methods.find((m) => m.name === verb).testedBy;
  cells[cells.length - 2] = "[" + row.source.overviewLabel + "](../../" + row.source.file + "#L" + proof.ownPositiveLine + ") — [family row](../../" + row.file + "#L" + row.line + ")";
  cells[cells.length - 1] = "**COVERED** |";
  rowLines[at] = cells.join(" | ");
  overview = rowLines.join("\n");
}
const totalsText = manifest.metrics.coveredAfter + " COVERED / " + manifest.metrics.publicByDesign + " PUBLIC-BY-DESIGN / " + manifest.metrics.gap + " GAP";
let anchor = null;
for (const source of SOURCES) {
  const n = credited.filter((row) => row.source === source).length;
  if (n === 0) continue;
  const paragraph = source.paragraph(n, totalsText, pageGaps);
  const existing = overview.split("\n").findIndex((text) => text.startsWith(source.paragraphMarker));
  if (existing >= 0) {
    const rows = overview.split("\n"); rows[existing] = paragraph; overview = rows.join("\n");
  } else {
    replaceOnce(/^(\| Metric \| Count \|)$/m, paragraph + "\n\n$1", "metric table");
  }
  anchor = source;
}
void anchor;

console.log(JSON.stringify({ reads: bySource.get("read"), writes: bySource.get("write"), rows: credited.length, newlyCredited: fresh.length, before,
  after: { coveredAfter: manifest.metrics.coveredAfter, gap: manifest.metrics.gap }, write }));
if (write) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(OVERVIEW, overview);
}
