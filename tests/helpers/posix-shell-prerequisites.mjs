import { spawnSync } from "node:child_process";

/**
 * Only native POSIX shell fixtures may be skipped. Source/authorization
 * contract assertions remain enabled regardless of local tool availability.
 * CI must continue to inspect real Bash/jq behavior on supported runners.
 */
export function posixShellTestSkipReason({
  platform = process.platform,
  needsJq = false,
  ci = process.env.CI === "true",
  probe = spawnSync,
} = {}) {
  if (platform === "win32") {
    return "POSIX Bash/jq shell fixtures are not supported on native Windows";
  }
  for (const executable of needsJq ? ["bash", "jq"] : ["bash"]) {
    const result = probe(executable, ["--version"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      // A missing executable can skip a LOCAL POSIX fixture, but not CI:
      // forcing the test to execute makes missing bash/jq a visible failure.
      // Native Windows stays intentionally skipped above.
      if (ci) return false;
      return `Shell integration fixture requires ${executable} available on PATH`;
    }
  }
  return false;
}
