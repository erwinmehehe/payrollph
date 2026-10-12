import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export const CORE_API_SCOPES = ["employees:read", "employees:write", "payroll:read"] as const;
export const EXTENDED_API_SCOPES = ["org-units:read", "payslips:read", "events:read"] as const;

// The explicit security ceiling is not the set of active permissions.
// Per-request release-flag checks restrict the token creation allowlist.
export const ALLOWED_API_SCOPES: ReadonlySet<string> = new Set([
  ...CORE_API_SCOPES, ...EXTENDED_API_SCOPES,
]);

export function activeApiScopes(
  extendedEnabled = criticalReleaseFlagEnabled("publicApiV1Extended"),
): string[] {
  return extendedEnabled ? [...ALLOWED_API_SCOPES] : [...CORE_API_SCOPES];
}

export function normalizeScopes(
  value: unknown,
  extendedEnabled = criticalReleaseFlagEnabled("publicApiV1Extended"),
): string[] {
  const available = new Set<string>(activeApiScopes(extendedEnabled));
  if (!Array.isArray(value) || value.length === 0) return ["employees:read", "payroll:read"];
  const scopes = value.filter((scope): scope is string =>
    typeof scope === "string" && available.has(scope));
  return scopes.length ? [...new Set(scopes)] : ["employees:read", "payroll:read"];
}
