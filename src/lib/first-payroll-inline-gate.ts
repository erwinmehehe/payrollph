import { db } from "@/db";
import { firstPayrollJourneyProgress } from "@/db/schema";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

/**
 * Default OFF. Enabling an environment variable alone is insufficient:
 * the canonical 0117 progress table must exist on this DB connection.
 * This is a technical safety check, not DBA approval or payroll sign-off.
 * Never attempts to apply or repair migrations.
 */
export async function firstPayrollInlineAvailable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  reader: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  if (!criticalReleaseFlagEnabled("firstPayrollInline", env)) return false;
  try {
    await reader.select({ organizationId: firstPayrollJourneyProgress.organizationId })
      .from(firstPayrollJourneyProgress).limit(1);
    return true;
  } catch {
    // Do not expose an unconfigured or partly migrated journey.
    return false;
  }
}
