import { constants, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Several security tests prove that a symlink is refused (path-escape guards,
// reviewed-SQL readers, evidence readers). They must create a real symlink, which
// Windows only allows with Developer Mode or an elevated shell; otherwise
// symlinkSync throws EPERM and the test fails for a reason unrelated to the code.
function probe() {
  const dir = mkdtempSync(join(tmpdir(), "symlink-probe-"));
  try {
    writeFileSync(join(dir, "target"), "x");
    symlinkSync(join(dir, "target"), join(dir, "link"));
    return true;
  } catch (error) {
    if (error && ["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return false;
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const symlinksAvailable = probe();

/**
 * Value for node:test's `skip` option. Never skips in CI: if CI cannot create
 * symlinks the test must run and fail loudly rather than quietly drop a
 * security regression.
 */
export const symlinkSkip =
  symlinksAvailable || process.env.CI === "true"
    ? false
    : "symlinks cannot be created here (Windows needs Developer Mode or an elevated shell); runs in CI";

// scripts/lib/reviewed-migration-runner.mjs reads reviewed SQL through a single
// O_NOFOLLOW descriptor and refuses (SQL_NOFOLLOW_REQUIRED) where the platform
// has none. Windows does not, so tests that drive the runner's SQL reader can
// only run on POSIX. Same CI rule: never skipped in CI.
export const noFollowAvailable = Number.isInteger(constants.O_NOFOLLOW) && constants.O_NOFOLLOW !== 0;

export const noFollowSkip =
  noFollowAvailable || process.env.CI === "true"
    ? false
    : "this platform has no O_NOFOLLOW (Windows), so the reviewed migration runner refuses to read SQL here by design; runs in CI";

// Several workflow-contract tests run the repo's real bash scripts, which pipe
// API responses through `jq`. It is preinstalled on GitHub runners and absent on
// a default Windows machine. Same CI rule: never skipped in CI.
export const jqAvailable = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;

export const jqSkip =
  jqAvailable || process.env.CI === "true"
    ? false
    : "jq is not installed here (preinstalled on GitHub runners); runs in CI";
