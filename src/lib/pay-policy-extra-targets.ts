/**
 * Deterministic additive-only company premium selectors and bounded rate tiers.
 * These inputs are never guessed from a label, job title or a different tenant.
 * If an enabled rule requires evidence not supplied by its caller, fail closed.
 */
export type VerifiedPremiumTargetEvidence = {
  locationCode?: string | null;
  clientCode?: string | null;
  skillCode?: string | null;
  languageCode?: string | null;
};
export const PAY_PREMIUM_TARGET_SELECTORS = [
  ["locationCodes", "locationCode"],
  ["clientCodes", "clientCode"],
  ["skillCodes", "skillCode"],
  ["languageCodes", "languageCode"],
] as const;
const codePattern = /^[A-Z0-9][A-Z0-9_.-]{0,63}$/;
function normalizedCode(raw: unknown, label: string): string {
  if (typeof raw !== "string") throw new Error(label + " must be a nonempty string code.");
  const code = raw.trim().toUpperCase();
  if (!codePattern.test(code)) {
    throw new Error(label + " must be a strict ASCII code of 1-64 characters.");
  }
  return code;
}

export function payRuleMatchesVerifiedTargets(
  conditions: Record<string, unknown>,
  evidence: VerifiedPremiumTargetEvidence,
  ruleKey: string,
): boolean {
  for (const [selector, evidenceKey] of PAY_PREMIUM_TARGET_SELECTORS) {
    const raw = conditions[selector];
    if (raw == null) continue;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 50) {
      throw new Error("Pay rule " + ruleKey + " " + selector + " requires 1-50 codes.");
    }
    const allowed = raw.map(value => normalizedCode(value, "Pay rule " + ruleKey + " " + selector));
    if (new Set(allowed).size !== allowed.length) {
      throw new Error("Pay rule " + ruleKey + " " + selector + " contains duplicate codes.");
    }
    const supplied = evidence[evidenceKey];
    if (supplied == null || supplied === "") {
      throw new Error("Pay rule " + ruleKey + " requires verified " + evidenceKey + " evidence.");
    }
    if (!allowed.includes(normalizedCode(supplied, "Pay rule " + ruleKey + " " + evidenceKey))) {
      return false;
    }
  }
  return true;
}

export type AdditivePremiumRateTier = {
  minMinutes: number;
  maxMinutes?: number;
  premiumPercent: number;
  premiumAmountPerHour: number;
};

/** One effective rate for the entire qualifying segment, NOT a marginal tax table. */
export function selectAdditivePremiumRateTier(
  raw: unknown, minutes: number, ruleKey: string,
): AdditivePremiumRateTier | null {
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 10080) {
    throw new Error("Pay rule " + ruleKey + " requires finite, bounded segment minutes.");
  }
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 24) {
    throw new Error("Pay rule " + ruleKey + " rateTable requires 1-24 tiers.");
  }
  const tiers = raw.map((value, index): AdditivePremiumRateTier => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Pay rule " + ruleKey + " rateTable tier must be an object.");
    }
    const tier = value as Record<string, unknown>;
    if (Object.keys(tier).some(key => !["minMinutes", "maxMinutes", "premiumPercent", "premiumAmountPerHour"].includes(key))) {
      throw new Error("Pay rule " + ruleKey + " rateTable contains unsupported tier fields.");
    }
    const min = tier.minMinutes;
    const max = tier.maxMinutes;
    if (!Number.isSafeInteger(min) || Number(min) < 0 || Number(min) > 10080
      || (max != null && (!Number.isSafeInteger(max) || Number(max) <= Number(min) || Number(max) > 10080))) {
      throw new Error("Pay rule " + ruleKey + " rateTable requires valid minute thresholds.");
    }
    const percent = tier.premiumPercent == null ? 0 : tier.premiumPercent;
    const hourly = tier.premiumAmountPerHour == null ? 0 : tier.premiumAmountPerHour;
    if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 500
      || typeof hourly !== "number" || !Number.isFinite(hourly) || hourly < 0 || hourly > 100000
      || (percent === 0 && hourly === 0)) {
      throw new Error("Pay rule " + ruleKey + " rateTable requires a positive, bounded additive premium.");
    }
    return { minMinutes: Number(min),
      ...(max == null ? {} : { maxMinutes: Number(max) }),
      premiumPercent: percent, premiumAmountPerHour: hourly };
  });
  const sorted = [...tiers].sort((a,b)=>a.minMinutes - b.minMinutes);
  for (let index=1; index<sorted.length; index+=1) {
    if (sorted[index]!.minMinutes < (sorted[index-1]!.maxMinutes ?? Infinity)) {
      throw new Error("Pay rule " + ruleKey + " rateTable minute ranges overlap.");
    }
  }
  return sorted.find(tier => minutes >= tier.minMinutes
    && (tier.maxMinutes == null || minutes < tier.maxMinutes)) ?? null;
}
