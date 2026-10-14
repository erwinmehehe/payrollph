import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/** HCM is intentionally unavailable while multi-entity scoping is unreviewed. */
export function multiEntityHcmDeferred(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return criticalReleaseFlagEnabled("multiEntity", env);
}
