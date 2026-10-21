import { criticalReleaseFlagEnabled } from "./critical-release-flags";

export const HOSTED_DEMO_ORIGIN = "https://payrollph-fictional-demo-qa-three.vercel.app";

/** Fixed destination: neither query parameters nor request headers select a host. */
export function hostedDemoDestination(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (!criticalReleaseFlagEnabled("hostedDemoNavigation", env)) return null;
  try {
    const canonical = new URL(env.APP_BASE_URL ?? "");
    // Missing configuration fails local; the demo deployment never redirects to itself.
    if (canonical.protocol !== "https:" || canonical.origin === HOSTED_DEMO_ORIGIN) return null;
    return `${HOSTED_DEMO_ORIGIN}/demo`;
  } catch {
    return null;
  }
}
