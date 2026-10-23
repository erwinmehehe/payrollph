import { criticalReleaseFlagEnabled } from './critical-release-flags';

/** Match only this constraint, including Drizzle's wrapped driver error. */
export function underpaymentDuplicateConflict(error: unknown, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!criticalReleaseFlagEnabled('underpaymentDuplicateConflict', env)) return false;
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== 'object' || seen.has(current)) return false;
    seen.add(current);
    const issue = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (issue.code === '23505' && issue.constraint === 'payroll_underpayment_one_source_unique') return true;
    current = issue.cause;
  }
  return false;
}
