import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { TIMESHEET_ROUTE, verifiedTimesheetHoldKeys } from "./timesheet-source-accounting.mjs";

const manifestFile = "scripts/qa/tenant-isolation-coverage-manifest.json";
const receiptFile = "scripts/qa/timesheet-employer-receipt.json";
const verbs = ["GET", "POST"];
export const timesheetProofKind = "timesheet-legal-employer-pg16";
function blob(raw) {
  const bytes = Buffer.from(raw.toString().replaceAll("\r\n", "\n"));
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
function evidence(read) {
  const raw = read(receiptFile);
  assert.equal(blob(raw), "f87f6e16245a97a6833823f8807561584b4c2473", "Timesheet receipt changed");
  const receipt = JSON.parse(raw);
  assert.equal(receipt.label, "SOLO_VERIFIED_DEV_RECOVERY");
  assert.equal(receipt.route, TIMESHEET_ROUTE);
  assert.equal(Math.floor(receipt.postgres / 10000), 16);
  assert.equal(receipt.managers, 2);
  assert.equal(receipt.legalEmployers, 2);
  assert.ok(receipt.unchangedAfterReads && receipt.unchangedAfterDenials && receipt.unchangedAfterTransferChecks);
  for (const [file, expected] of Object.entries(receipt.sourcePins)) {
    assert.equal(blob(read(file)), expected, "Timesheet proof input changed: " + file);
  }
  return receipt;
}
export function verifyTimesheetRenewal(manifest, read = readFileSync) {
  const receipt = evidence(read);
  const route = manifest.allApiRouteFiles[TIMESHEET_ROUTE];
  assert.equal(createHash("sha256").update(JSON.stringify(route)).digest("hex"), "4b7f13c211f11f2d438877da756ff37b27e761340695775968255eca13eb3166",
    "Only the two reviewed timesheet citations may be counted");
  assert.equal(route.gitBlobSha, receipt.sourcePins[TIMESHEET_ROUTE]);
  for (const verb of verbs) {
    const method = route.methods.find(row => row.name === verb);
    assert.equal(method.status, "COVERED");
    assert.equal(method.reviewedUncertified, undefined);
    assert.deepEqual(method.testedBy, receipt.proofs[verb]);
  }
  return 2;
}
export function timesheetRenewalDelta(before, after) {
  const target = after.allApiRouteFiles[TIMESHEET_ROUTE];
  if (!target?.methods.some(row => row.testedBy?.kind === timesheetProofKind)) return 0;
  verifyTimesheetRenewal(after);
  if (!verifiedTimesheetHoldKeys(before).size) {
    verifyTimesheetRenewal(before);
    return 0;
  }
  assert.equal(createHash("sha256").update(JSON.stringify(before.allApiRouteFiles[TIMESHEET_ROUTE])).digest("hex"),
    "741c4a73c486c0fb4de27f5cd99a578b6ff56656b8a824a16ee88b56c6b5ca6f", "Unexpected timesheet credit base");
  return 2;
}
export function creditTimesheets(args) {
  const receipt = evidence(readFileSync);
  assert.deepEqual(args, ["--timesheet-employer", "--run-label", receipt.head]);
  const manifest = JSON.parse(readFileSync(manifestFile));
  assert.equal(verifiedTimesheetHoldKeys(manifest).size, 2, "Both exact source holds required");
  const prior = { ...manifest.metrics };
  const route = manifest.allApiRouteFiles[TIMESHEET_ROUTE];
  for (const row of route.methods) {
    row.status = "COVERED";
    row.testedBy = receipt.proofs[row.name];
    row.reason = "SOLO_VERIFIED_DEV_RECOVERY: local PostgreSQL 16 HTTP on " + receipt.head +
      ". Two distinct home employers, same-workspace legal-employer selection, revoked membership, transferred-worker exclusion and unchanged persisted state. See " + receiptFile;
    delete row.reviewedUncertified;
  }
  verifyTimesheetRenewal(manifest);
  const methods = Object.values(manifest.allApiRouteFiles).flatMap(route => route.methods);
  const covered = methods.filter(row => row.status === "COVERED").length;
  const gap = methods.filter(row => row.status === "GAP").length;
  assert.equal(covered, prior.coveredAfter + 2);
  assert.equal(gap, prior.gap - 2);
  manifest.metrics.coveredAfter = covered;
  manifest.metrics.gap = gap;
  manifest.acceptanceStatus = manifest.acceptanceStatus.replace(/^NOT ACCEPTED: \d+ API methods/, "NOT ACCEPTED: " + gap + " API methods");
  const documents = ["docs/engineering/tenant-isolation-coverage-inventory.md", "docs/engineering/tenant-isolation-closure-plan.md"];
  const changes = documents.map(path => {
    const lines = readFileSync(path, "utf8").replaceAll("\r\n", "\n").split("\n");
    lines[0] = lines[0].replace(prior.coveredAfter + " COVERED", covered + " COVERED").replace(prior.gap + " GAP", gap + " GAP");
    const note = "> **Timesheet GET and POST** were renewed with [fictional PG16 HTTP evidence](../../" + receiptFile + ").";
    if (path.includes("inventory")) {
      lines.splice(2, 0, note, "");
      for (const verb of verbs) {
        const i = lines.findIndex(line => line.startsWith("| [`workforce/timesheets` " + verb + "]"));
        assert.ok(i >= 0 && lines[i].endsWith("**GAP** |"));
        const proof = receipt.proofs[verb];
        lines[i] = lines[i].split(" | ").slice(0, -2).join(" | ") + " | [PG16 HTTP proof](../../" + proof.file + "#L" + proof.line + ") | **COVERED** |";
      }
    }
    return lines.map(line => {
      if (line.startsWith("> **Pilot timesheet hold:**")) return note;
      if (line.startsWith("| coveredAfter |")) return "| coveredAfter | " + covered + " |";
      if (line.startsWith("| gap |")) return "| gap | " + gap + " |";
      if (line.startsWith("> **NOT ACCEPTED**:")) return line.replace(prior.gap + " method gaps", gap + " method gaps");
      if (line.startsWith("> **RELEASE BLOCKER:**")) return line.replace(prior.gap + " API methods", gap + " API methods");
      if (path.includes("closure-plan") && line === "| 5 | **WRK-01** | 39 | 37 | 0 | 0 | 2 | INCOMPLETE |") {
        return line.replace("| 37 | 0 | 0 | 2 | INCOMPLETE |", "| 39 | 0 | 0 | 0 | PROVISIONAL — NOT ACCEPTED |");
      }
      if (line.startsWith("Frozen subtotal (")) return line
        .replace(/\*\*(\d+) COVERED/, (_, n) => "**" + (Number(n) + 2) + " COVERED")
        .replace(/(\d+) GAP = 406/, (_, n) => (Number(n) - 2) + " GAP = 406")
        .replace(/(\d+) batches remain INCOMPLETE/, (_, n) => (Number(n) - 1) + " batches remain INCOMPLETE")
        .replace("PII-01, WRK-02 remain PROVISIONAL", "PII-01, WRK-01, WRK-02 remain PROVISIONAL");
      return line;
    }).join("\n");
  });
  documents.forEach((path, i) => writeFileSync(path, changes[i]));
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ before: { covered: prior.coveredAfter, gap: prior.gap }, after: { covered, gap } }));
}
