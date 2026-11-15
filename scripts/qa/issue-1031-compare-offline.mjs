#!/usr/bin/env node
/** Offline file-to-file comparison: NO database client, credentials or network. */
import { constants, readSync, fstatSync, openSync, writeFileSync, closeSync, unlinkSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inventoryMigrationSources } from "../lib/migration-receipt-audit.mjs";
import { buildOfflineReport } from "../lib/issue-1031-offline-parity.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function pathOutsideRepository(p) {
  const file = resolve(p);
  if (file === ROOT || file.startsWith(ROOT + sep)) throw Error("EXPORT_FILES_MUST_STAY_OUTSIDE_GIT");
  return file;
}
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
function readPrivateJson(path) {
  const file = pathOutsideRepository(path);
  // Open a single descriptor, never stat(path) then reopen(path): that
  // introduces a TOCTOU race. Refuse symlinks and nonregular files.
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_EXPORT_BYTES) throw Error("OFFLINE_EXPORT_TOO_LARGE");
    const chunks = [];
    let bytes = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, MAX_EXPORT_BYTES - bytes + 1));
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      bytes += count;
      if (bytes > MAX_EXPORT_BYTES) throw Error("OFFLINE_EXPORT_TOO_LARGE");
      chunks.push(chunk.subarray(0, count));
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    closeSync(fd);
  }
}
function usage() {
  throw Error("USAGE: node scripts/qa/issue-1031-compare-offline.mjs --reference PRIVATE_PG18_JSON --production PRIVATE_PRODUCTION_JSON --report PRIVATE_REPORT_JSON");
}
function cli(args) {
  if (args.length !== 6) usage();
  const opts = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--production", "--reference", "--report"].includes(args[i]) ||
      opts.has(args[i]) || typeof args[i + 1] !== "string" || !args[i + 1]) usage();
    opts.set(args[i], pathOutsideRepository(args[i + 1]));
  }
  if (opts.size !== 3 || new Set([...opts.values()]).size !== 3) usage();
  return opts;
}
try {
  const args = cli(process.argv.slice(2));
  const report = buildOfflineReport(readPrivateJson(args.get("--reference")),
    readPrivateJson(args.get("--production")),
    inventoryMigrationSources(resolve(ROOT, "drizzle")));
  const destination = args.get("--report");
  let fd;
  try {
    fd = openSync(destination, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(report, null, 2) + "\n", "utf8");
    closeSync(fd);
    fd = undefined;
  } catch {
    if (fd !== undefined) { try { closeSync(fd); } catch {} try { unlinkSync(destination); } catch {} }
    throw Error("PRIVATE_REPORT_WRITE_FAILED");
  }
  process.stdout.write("ISSUE_1031_OFFLINE_COMPARISON_RECORDED " +
    JSON.stringify(report.summary) + "\n");
  if (report.summary.BLOCKING || report.summary["NEEDS-OWNER-DECISION"]) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message)
    ? error.message : "OFFLINE_COMPARISON_ABORTED_NO_REPORT";
  process.stderr.write(code + "\n");
  process.exitCode = 2;
}
