/**
 * Keep client directory rows bound to the authorized employer and role.
 * React effects run after paint; clearing stale rows in an effect alone can
 * briefly render another employer's previously loaded directory.
 */
export type ScopedEmployeeDirectory<T> = Readonly<{
  organizationId: number;
  employees: T[];
}>;

export function visibleScopedEmployeeDirectory<T>(
  snapshot: ScopedEmployeeDirectory<T> | null,
  organizationId: number,
  allowed: boolean,
): T[] {
  if (!allowed || !Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      snapshot?.organizationId !== organizationId) return [];
  return snapshot.employees;
}
