export type ComplianceRuleRecord = {
  id: number;
  ruleKey: string;
  agency: string;
  jurisdiction: string;
  region: string;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sourceDocument: string;
  sourceUrl: string;
  payload: unknown;
  status: string;
  futureEffective: boolean;
  reviewedBy: string | null;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  supersedesRuleVersion: string | null;
  rollbackVersion: string | null;
};

export type ComplianceRuleSelector = {
  ruleKey: string;
  asOf: string;
  jurisdiction?: string;
  region?: string;
};

function normalizedRegion(region: string | null | undefined) {
  return String(region ?? "ALL").trim().toUpperCase() || "ALL";
}

/** Never let an impossible date select (or hide) a statutory rule by string ordering. */
function validIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC normalizes impossible dates, so compare the parsed components.
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day;
}

function assertValidRuleWindow(rule: ComplianceRuleRecord) {
  if (!validIsoCalendarDate(rule.effectiveFrom)
    || (rule.effectiveUntil !== null && !validIsoCalendarDate(rule.effectiveUntil))
    || (rule.effectiveUntil !== null && rule.effectiveUntil < rule.effectiveFrom)) {
    throw new Error(
      `Invalid compliance rule effective-date window for ${rule.ruleKey} (${rule.ruleVersion}).`,
    );
  }
}

function dateInRange(rule: ComplianceRuleRecord, asOf: string) {
  return rule.effectiveFrom <= asOf
    && (!rule.effectiveUntil || asOf <= rule.effectiveUntil);
}

/**
 * Resolve one approved statutory rule for a payroll date.
 *
 * This deliberately fails closed on gaps and overlaps. Payroll must never
 * guess which statutory version applies when registry governance is ambiguous.
 */
export function resolveComplianceRule(
  rules: ComplianceRuleRecord[],
  selector: ComplianceRuleSelector,
): ComplianceRuleRecord {
  if (!validIsoCalendarDate(selector.asOf)) {
    throw new Error("Compliance rule selection requires a valid ISO calendar date (YYYY-MM-DD).");
  }
  const jurisdiction = String(selector.jurisdiction ?? "PH").trim().toUpperCase();
  const region = normalizedRegion(selector.region);

  const scopedApproved = rules.filter((rule) =>
    rule.ruleKey === selector.ruleKey
    && rule.jurisdiction.trim().toUpperCase() === jurisdiction
    && normalizedRegion(rule.region) === region
    && rule.status === "approved"
    && Boolean(rule.approvedAt)
  );
  // Validate even future-dated candidates: a malformed approved version must
  // not silently disappear and let an older version win by accident.
  for (const rule of scopedApproved) assertValidRuleWindow(rule);
  const applicable = scopedApproved.filter((rule) => dateInRange(rule, selector.asOf));

  if (applicable.length === 0) {
    throw new Error(
      `No approved compliance rule for ${selector.ruleKey} (${jurisdiction}/${region}) on ${selector.asOf}.`,
    );
  }
  if (applicable.length > 1) {
    const versions = applicable.map((rule) => rule.ruleVersion).sort().join(", ");
    throw new Error(
      `Ambiguous approved compliance rules for ${selector.ruleKey} (${jurisdiction}/${region}) on ${selector.asOf}: ${versions}.`,
    );
  }

  return applicable[0];
}

export function complianceRuleTrace(rule: ComplianceRuleRecord) {
  return {
    ruleKey: rule.ruleKey,
    agency: rule.agency,
    jurisdiction: rule.jurisdiction,
    region: normalizedRegion(rule.region),
    ruleVersion: rule.ruleVersion,
    effectiveFrom: rule.effectiveFrom,
    effectiveUntil: rule.effectiveUntil,
    sourceDocument: rule.sourceDocument,
    sourceUrl: rule.sourceUrl,
    reviewedBy: rule.reviewedBy,
    approvedBy: rule.approvedBy,
    approvedAt: rule.approvedAt ? new Date(rule.approvedAt).toISOString() : null,
    supersedesRuleVersion: rule.supersedesRuleVersion,
    rollbackVersion: rule.rollbackVersion,
  };
}
