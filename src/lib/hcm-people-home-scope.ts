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
