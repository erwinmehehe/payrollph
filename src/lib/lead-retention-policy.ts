import { criticalReleaseFlagEnabled } from "./critical-release-flags";

export function leadRetentionDays(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!criticalReleaseFlagEnabled("configurableLeadRetention", env)) return 365;
  const raw = env.MARKETING_LEAD_RETENTION_DAYS ?? "365";
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("INVALID_MARKETING_LEAD_RETENTION_DAYS");
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days > 3650) throw new Error("INVALID_MARKETING_LEAD_RETENTION_DAYS");
  return days;
}

export function leadRetentionCutoff(now: number, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!Number.isFinite(now)) throw new Error("INVALID_RETENTION_TIMESTAMP");
  return new Date(now - leadRetentionDays(env) * 86_400_000);
}
