/**
 * An OpenAI API key and global switch alone never authorize disclosure.
 * The operator must attest that processor, retention and privacy disclosures
 * are verified, and explicitly allowlist the tenant after documented opt-in.
 *
 * These flags are technical release locks, NOT evidence of executed contracts.
 */
export function automationModelAllowedForOrganization(
  organizationId: number | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!Number.isSafeInteger(organizationId) || Number(organizationId) <= 0) return false;
  if (env.OPENAI_AUTOMATION_DRAFT_ENABLED !== "true"
    || !env.OPENAI_API_KEY
    || env.OPENAI_AUTOMATION_DPA_CONFIRMED !== "true"
    || env.OPENAI_AUTOMATION_ZERO_RETENTION_CONFIRMED !== "true"
    || env.OPENAI_AUTOMATION_NOTICE_CONFIRMED !== "true") return false;

  const allowlist = (env.OPENAI_AUTOMATION_APPROVED_ORG_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[1-9]\d*$/.test(value))
    .map(Number)
    .filter(Number.isSafeInteger);
  return allowlist.includes(Number(organizationId));
}
