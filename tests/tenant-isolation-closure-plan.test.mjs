/**
 * Frozen closure-queue and live headline guard.
 * This tests bookkeeping, NEVER substitutes for method-specific HTTP/PG proof.
 * The earlier inventory guard continues to pin all route blobs/method exports.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const plan = readFileSync("docs/engineering/tenant-isolation-closure-plan.md", "utf8");
const overview = readFileSync("docs/engineering/tenant-isolation-coverage-inventory.md", "utf8");

function allMethods() {
  return new Map(Object.values(manifest.allApiRouteFiles).flatMap((route) =>
    route.methods.map((method) => [method.name + " " + route.route, method])));
}
function countInOverview(key) {
  const match = overview.match(new RegExp("^\\| " + key + " \\| ([0-9]+) \\|$", "m"));
  assert.ok(match, "Active inventory overview missing metric " + key);
  return Number(match[1]);
}

test("current overview headline equals complete live method manifest (frozen baseline is historical)", () => {
  const methods = [...allMethods().values()];
  const tally = (status) => methods.filter((x) => x.status === status).length;
  const stats = manifest.metrics;
  assert.equal(Object.keys(manifest.allApiRouteFiles).length, stats.routeFiles);
  assert.equal(methods.length, stats.methods);
  assert.equal(tally("COVERED"), stats.coveredAfter);
  assert.equal(tally("PUBLIC-BY-DESIGN"), stats.publicByDesign);
  assert.equal(tally("GAP"), stats.gap);
  assert.equal(methods.length, tally("COVERED") + tally("PUBLIC-BY-DESIGN") +
    tally("GAP") + tally("NEEDS OWNER"));
  assert.ok(manifest.acceptanceStatus.startsWith("NOT ACCEPTED"),
    "Only the owner can accept the security manifest");
  for (const key of ["routeFiles", "methods", "coveredBefore", "coveredAfter",
    "publicByDesign", "gap", "scopedPagesAndActions",
    "confirmedLeaksFound", "confirmedLeaksFixed"]) {
    assert.equal(countInOverview(key), stats[key], key + " overview/manifest mismatch");
  }
  assert.equal(manifest.scopedPages.length, stats.scopedPagesAndActions);
  assert.ok(overview.includes("**RELEASE BLOCKER:** " + stats.gap + " API methods and " +
    manifest.scopedPages.filter((page) => page.status === "GAP").length + " business-ID page entries"));
  assert.ok(overview.includes("**NOT ACCEPTED**: " + stats.gap +
    " method gaps and " + manifest.scopedPages.filter((page) => page.status === "GAP").length + " page/action gaps"));
});

test("closure plan schedules every original GAP exactly once in priority order", () => {
  // The 2026-10-21 closure queue is immutable, but live status annotations
  // in this document are updated as proofs arrive. Pin the original batch
  // names, order and exact 406 method/20 page source links, not the moving
  // status prose. Do not weaken the separate current-manifest guards.
  const frozenBatchHeadings = [...plan.matchAll(/^### Batch ([A-Z0-9-]+) — .+ \(([0-9]+) methods; phase ([1-6])\)$/gm)]
    .map((match) => match[0]);
  const frozenMethodLinks = [...plan.matchAll(/^- `(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS) \/api\/([^`]+)` — \[source\]\(\.\.\/\.\.\/(src\/app\/api\/[^)]+)#L([0-9]+)\)$/gm)]
    .map((match) => match[0]);
  const frozenPageLinks = [...plan.matchAll(/^- `GET [^`]+` — `(src\/app\/[^`]+\/page\.tsx)`;/gm)]
    .map((match) => match[0]);
  assert.equal(frozenBatchHeadings.length, 12, "Frozen batch count changed");
  assert.equal(frozenMethodLinks.length, 406, "Frozen method source links changed");
  assert.equal(frozenPageLinks.length, 20, "Frozen page source links changed");
  const frozenQueue = [
    "FROZEN_2026_10_21_CLOSURE_QUEUE_V1",
    "BATCH HEADINGS", ...frozenBatchHeadings,
    "METHOD SOURCE LINKS", ...frozenMethodLinks,
    "PAGE SOURCE LINKS", ...frozenPageLinks,
    "",
  ].join("\n");
  const frozenQueueBlob = createHash("sha1")
    .update("blob " + Buffer.byteLength(frozenQueue) + "\0" + frozenQueue)
    .digest("hex");
  assert.equal(frozenQueueBlob, "c30b018658cf19da7ce649efe606ba4b43f0612b",
    "The frozen 406-method closure queue and its exact source links must not change");

  const current = allMethods();
  const headers = [...plan.matchAll(/^### Batch ([A-Z0-9-]+) — .+ \(([0-9]+) methods; phase ([1-6])\)$/gm)];
  assert.equal(headers.length, 12, "12 numbered baseline closure PR batches expected");
  const scheduled = new Map();
  const sizes = [];
  let lastPhase = 0;
  for (let idx = 0; idx < headers.length; idx++) {
    const [heading, id, expectedSize, phaseText] = headers[idx];
    const phase = Number(phaseText);
    assert.ok(phase >= lastPhase, "Do not reorder the required security priority families");
    lastPhase = phase;
    const end = idx + 1 < headers.length ? headers[idx + 1].index :
      plan.indexOf("## Page and server-action closure", headers[idx].index);
    assert.ok(end > headers[idx].index, id + " missing end of batch section");
    const body = plan.slice(headers[idx].index + heading.length, end);
    const items = [...body.matchAll(/^- \x60(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS) \/api\/([^\x60]+)\x60 — \[source\]\(\.\.\/\.\.\/(src\/app\/api\/[^)]+)#L([0-9]+)\)$/gm)];
    assert.equal(items.length, Number(expectedSize), id + ": incomplete method queue");
    assert.ok(items.length >= 25 && items.length <= 40, id + ": batch outside 25-40 methods");
    for (const item of items) {
      const key = item[1] + " " + item[2];
      assert.ok(!scheduled.has(key), key + " scheduled more than once");
      const exactPath = item[3];
      const record = manifest.allApiRouteFiles[exactPath];
      assert.ok(record, key + " has no actual source route");
      const method = record.methods.find((x) => x.name === item[1] && record.route === item[2]);
      assert.ok(method, key + ": linked file/method do not agree");
      // Keep the baseline source coordinate frozen rather than comparing it
      // to today's line after a separately tested route security refactor.
      assert.ok(Number.isSafeInteger(Number(item[4])) && Number(item[4]) > 0,
        key + ": historical source link must contain a positive line");
      scheduled.set(key, id);
    }
    sizes.push(items.length);
  }
  assert.equal(scheduled.size, 406, "Frozen 2026-10-21 closure queue is 406 distinct method gaps");
  assert.deepEqual(sizes, [26, 26, 33, 33, 27, 39, 38, 39, 39, 40, 33, 33]);
  for (const [key, value] of current) {
    if (value.status === "GAP") assert.ok(scheduled.has(key), "Unsheduled new/remaining GAP: " + key);
  }
  for (const key of scheduled.keys()) assert.ok(current.has(key),
    "Removed/renamed method still in plan; reconcile this batch and manifest: " + key);
});

test("frozen 20-page closure slots remain exact while a newly verified manager page has separate proof", () => {
  const body = plan.split("## Page and server-action closure")[1]?.split("## CI and proof-link")[0];
  assert.ok(body, "Page closure section required");
  const sources = [...body.matchAll(/^- \x60GET [^\x60]+\x60 — \x60(src\/app\/[^\x60]+\/page\.tsx)\x60;/gm)]
    .map((match) => match[1]);
  // Do not alter the checksum-pinned 2026-10-21 closure queue. PR #1405
  // introduces a new page, with a dedicated real-HTTP proof, after that date.
  const newPage = "src/app/hcm/manager-direct-reports/page.tsx";
  const direct = manifest.scopedPages.find((entry) => entry.path === newPage);
  assert.equal(direct?.status, "COVERED", "A new page cannot bypass the original closure queue unproven");
  assert.equal(direct.testedBy?.file, "scripts/qa/hcm-manager-direct-reports-http.mjs");
  const frozenPages = manifest.scopedPages.filter((entry) => entry.path !== newPage);
  assert.equal(sources.length, 20, "Historical baseline must retain 20 original page slots");
  assert.equal(frozenPages.length, 20, "Every original page must retain its closure slot");
  assert.equal(new Set(sources).size, sources.length, "Do not duplicate page slots");
  assert.deepEqual(sources.sort(), frozenPages.map((entry) => entry.path).sort());
});

test("all preexisting COVERED references have real, checked-in own/victim and write snapshots", () => {
  for (const [key, method] of allMethods()) {
    if (method.status !== "COVERED") continue;
    const evidence = method.testedBy;
    assert.ok(evidence && typeof evidence.file === "string", key + ": no proof file");
    assert.match(evidence.file, /^(tests|scripts\/qa)\//);
    assert.ok(existsSync(evidence.file), key + ": proof file missing");
    const lines = readFileSync(evidence.file, "utf8").split("\n");
    for (const field of ["line", "ownPositiveLine", "foreignDenialLine",
      ...(["POST", "PUT", "PATCH", "DELETE"].includes(key.split(" ")[0]) ?
        ["unchangedDbLine"] : [])]) {
      const line = evidence[field];
      assert.ok(Number.isInteger(line) && line > 0 && line <= lines.length,
        key + ": " + field + " must reference an existing executable evidence line");
      assert.ok(lines[line - 1].trim().length > 0, key + ": " + field + " is blank");
    }
  }
});


// This is a bookkeeping guard, never a substitute for HTTP/DB proof.
function assertCurrentAcceptanceCounts(value) {
  const methods = Object.values(value.allApiRouteFiles).flatMap(route => route.methods);
  const gap = methods.filter(method => method.status === "GAP").length;
  const pages = value.scopedPages.filter(page => page.status === "GAP").length;
  const heading = /^NOT ACCEPTED: ([0-9]+) API methods and ([0-9]+) page\/action GAPs remain\./.exec(value.acceptanceStatus);
  assert.ok(heading, "Acceptance header must stay NOT ACCEPTED and include exact counts");
  assert.equal(value.metrics.gap, gap, "Actual method gaps differ from metric");
  assert.equal(Number(heading[1]), gap, "Acceptance text has a stale API GAP count");
  assert.equal(Number(heading[2]), pages, "Acceptance text has a stale page/action GAP count");
}

test("acceptance header matches actual method and page GAPs, not historical totals", () => {
  assertCurrentAcceptanceCounts(manifest);
});

test("acceptance guard rejects stale counts and never accepts an accepted label", () => {
  const gap = manifest.metrics.gap;
  const pages = manifest.scopedPages.filter(page => page.status === "GAP").length;
  for (const text of [
    "NOT ACCEPTED: " + (gap + 1) + " API methods and " + pages + " page/action GAPs remain.",
    "NOT ACCEPTED: " + gap + " API methods and " + (pages + 1) + " page/action GAPs remain.",
    "ACCEPTED: " + gap + " API methods and " + pages + " page/action GAPs remain.",
    "NOT ACCEPTED",
  ]) {
    assert.throws(() => assertCurrentAcceptanceCounts({ ...manifest, acceptanceStatus: text }));
  }
  assert.throws(() => assertCurrentAcceptanceCounts({
    ...manifest, metrics: { ...manifest.metrics, gap: gap + 1 },
  }));
});
