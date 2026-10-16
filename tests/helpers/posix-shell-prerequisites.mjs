import { spawnSync } from "node:child_process";

/**
 * Only native POSIX shell fixtures may be skipped. Source/authorization
 * contract assertions remain enabled regardless of local tool availability.
 * CI must continue to inspect real Bash/jq behavior on supported runners.
 */
export function posixShellTestSkipReason({
  platform = process.platform,
  needsJq = false,
  probe = spawnSync,
} = {}) {
  if (platform === "win32") {
    return "POSIX Bash/jq shell fixtures are not supported on native Windows";
  }
  for (const executable of needsJq ? ["bash", "jq"] : ["bash"]) {
    const result = probe(executable, ["--version"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      return `Shell integration fixture requires ${executable} available on PATH`;
    }
  }
  return false;
}
