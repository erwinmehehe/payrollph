import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// No files are excluded: this is exactly the top-level *.test.ts/*.test.mjs
// inventory exercised by npm test, partitioned deterministically by filename.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function regressionFiles() {
  return readdirSync(join(root, "tests"))
    .filter((name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"))
    .sort()
    .map((name) => "tests/" + name);
}

export function selectRegressionShard(files, index, total) {
  if (!Number.isSafeInteger(total) || total < 1 || total > 32
      || !Number.isSafeInteger(index) || index < 0 || index >= total) {
    throw new Error("INVALID_REGRESSION_SHARD");
  }
  return files.filter((_, position) => position % total === index);
}

function runBinary(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

// Human-facing jobs keep compact spec output; machine collectors explicitly request TAP.
// Reject invalid reporters rather than silently generating an unparseable proof receipt.
export function regressionTestArguments(files, reporter = "spec") {
  if (!["spec", "tap"].includes(reporter)) throw new Error("INVALID_REGRESSION_REPORTER");
  return ["--test", "--test-concurrency=1", "--test-reporter=" + reporter, ...files];
}

export function runRegressionShard(index, total) {
  const reporter = process.env.REGRESSION_TEST_REPORTER ?? "spec";
  regressionTestArguments([], reporter);
  const all = regressionFiles();
  const selected = selectRegressionShard(all, index, total);
  if (selected.length === 0) throw new Error("EMPTY_REGRESSION_SHARD");
  const ts = selected.filter((file) => file.endsWith(".test.ts"));
  const mjs = selected.filter((file) => file.endsWith(".test.mjs"));
  console.log(JSON.stringify({
    event: "regression_shard_manifest",
    index,
    total,
    allTests: all.length,
    selectedTests: selected.length,
    typescript: ts.length,
    operationalMjs: mjs.length,
    selected,
  }));
  const tsxBin = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  // Preserve shared-DB isolation inside the shard; the four jobs have
  // independent PostgreSQL containers and deliberately independent keys.
  // Compact reporting keeps assertion details readable in CI log clients;
  // it changes neither the selected inventory nor the child exit status.
  const tsOk = ts.length === 0 || runBinary(tsxBin, regressionTestArguments(ts, reporter));
  const mjsOk = mjs.length === 0 || runBinary(process.execPath, regressionTestArguments(mjs, reporter));
  return tsOk && mjsOk;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = Number(process.argv[2]);
  const total = Number(process.argv[3]);
  try {
    if (!runRegressionShard(index, total)) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "REGRESSION_SHARD_FAILURE");
    process.exitCode = 1;
  }
}
