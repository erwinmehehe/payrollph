/** Drizzle wraps PG errors in `cause`; only this employer-scoped name conflict is expected. */
export function isAutomationDraftNameConflict(error: unknown): boolean {
  const visited = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== "object" || visited.has(current)) return false;
    visited.add(current);
    const row = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (row.code === "23505" && row.constraint === "automation_rules_org_name_unique") return true;
    current = row.cause;
  }
  return false;
}
