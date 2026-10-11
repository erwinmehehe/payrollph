/**
 * Parse one explicitly chosen HCM employer. Invalid input may not silently
 * fall back to the first company membership.
 */
export function explicitHcmEmployerId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** UI eligibility only. The server still verifies roles, session and permissions. */
export function canOpenPeopleHome(
  access: { role: string; companyWide: boolean } | null | undefined,
): boolean {
  return Boolean(
    access?.companyWide &&
    ["owner", "admin", "bookkeeper", "hr"].includes(access.role),
  );
}

/**
 * Default-off, server-verified AND public-build-gated, employer-allowlisted pilot.
 * A flag by itself can never activate another legal employer's People Home.
 */
export function peopleHomeEnabledForOrganization(
  organizationId: number,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) return false;
  if (env.HCM_PEOPLE_HOME_ENABLED !== "true" ||
      env.NEXT_PUBLIC_HCM_PEOPLE_HOME_ENABLED !== "true") return false;
  return (env.HCM_PEOPLE_HOME_ORG_IDS ?? "").split(",")
    .map((value) => value.trim())
    .some((value) => /^[1-9]\d*$/.test(value) &&
      Number.isSafeInteger(Number(value)) && Number(value) === organizationId);
}
