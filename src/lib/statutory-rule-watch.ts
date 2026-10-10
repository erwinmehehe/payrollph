import {
  BIR_WITHHOLDING_RULE_PACKS,
  PAGIBIG_RULE_PACKS,
  PHILHEALTH_RULE_PACKS,
  SSS_RULE_PACKS,
  type EffectiveRulePack,
} from "@/lib/ph-statutory-rule-packs";
import { WAGE_ORDERS } from "@/lib/wage-orders";

/**
 * Published statutory changes that are known but not yet loaded into the rule
 * packs or wage-order registry. Add an entry when a circular or wage order is
 * published; remove it once the registry carries the new version.
 */
export const KNOWN_PENDING_RULE_CHANGES: ReadonlyArray<{
  family: RuleWatchFamily;
  reference: string;
  scope: string;
  effectiveOn: string;
  note: string;
}> = [
  {
    family: "wage-orders",
    reference: "WO-ROVII-27",
    scope: "Region VII",
    effectiveOn: "2026-10-14",
    note: "Published Region VII wage order; the registry still carries WO-ROVII-26 until the new rates are verified and loaded.",
  },
];

/** Dates the team last confirmed each family against the official agency source; null means not recorded. */
export const RULE_FAMILY_LAST_VERIFIED: Record<RuleWatchFamily, string | null> = {
  sss: null,
  philhealth: null,
  pagibig: null,
  "bir-withholding": null,
  // From the WAGE_ORDERS registry header: verified against NWPC/RTWPB pages.
  "wage-orders": "2026-10-03",
};

export type RuleWatchFamily = "sss" | "philhealth" | "pagibig" | "bir-withholding" | "wage-orders";
export type RuleWatchStatus = "current" | "review-due" | "verification-unrecorded" | "change-upcoming" | "update-overdue" | "coverage-ending" | "no-coverage";

export type RuleWatchItem = {
  family: RuleWatchFamily;
  label: string;
  status: RuleWatchStatus;
  currentVersion: string | null;
  sourceDocument: string | null;
  lastVerifiedOn: string | null;
  detail: string;
};

const REVIEW_INTERVAL_DAYS = 90;
const UPCOMING_WINDOW_DAYS = 30;
const COVERAGE_WARNING_DAYS = 45;

const LABELS: Record<RuleWatchFamily, string> = {
  sss: "SSS contribution schedule",
  philhealth: "PhilHealth premium schedule",
  pagibig: "Pag-IBIG contribution rules",
  "bir-withholding": "BIR withholding tax tables",
  "wage-orders": "Regional minimum wage orders",
};

const SEVERITY: Record<RuleWatchStatus, number> = {
  "no-coverage": 0,
  "update-overdue": 1,
  "coverage-ending": 2,
  "change-upcoming": 3,
  "review-due": 4,
  "verification-unrecorded": 5,
  current: 6,
};

function dayNumber(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function packItem<T>(
  family: RuleWatchFamily,
  packs: readonly EffectiveRulePack<T>[],
  today: string,
  lastVerifiedOn: string | null,
): RuleWatchItem {
  const current = packs.find((pack) => pack.effectiveFrom <= today && (!pack.effectiveUntil || today <= pack.effectiveUntil));
  const base = {
    family,
    label: LABELS[family],
    currentVersion: current?.version ?? null,
    sourceDocument: current?.sourceDocument ?? null,
    lastVerifiedOn,
  };
  if (!current) {
    return { ...base, status: "no-coverage", detail: "No approved rule pack covers today. Payroll for today's dates will fail closed until a verified pack is added." };
  }
  if (current.effectiveUntil) {
    const successor = packs.some((pack) => pack.effectiveFrom > current.effectiveUntil!);
    const daysLeft = dayNumber(current.effectiveUntil) - dayNumber(today);
    if (!successor && daysLeft <= COVERAGE_WARNING_DAYS) {
      return { ...base, status: "coverage-ending", detail: `The current pack ends ${current.effectiveUntil} (${daysLeft} days) and no successor pack is loaded.` };
    }
  }
  return verificationItem(base, today);
}

function verificationItem(base: Omit<RuleWatchItem, "status" | "detail">, today: string): RuleWatchItem {
  if (!base.lastVerifiedOn) {
    return { ...base, status: "verification-unrecorded", detail: "No verification date is recorded. Confirm the pack against the official agency source and record the date." };
  }
  const age = dayNumber(today) - dayNumber(base.lastVerifiedOn);
  if (age > REVIEW_INTERVAL_DAYS) {
    return { ...base, status: "review-due", detail: `Last verified ${base.lastVerifiedOn} (${age} days ago). Re-check the agency source for new circulars.` };
  }
  return { ...base, status: "current", detail: `Verified ${base.lastVerifiedOn}.` };
}

export function buildStatutoryRuleWatch(today: string): RuleWatchItem[] {
  const items: RuleWatchItem[] = [
    packItem("sss", SSS_RULE_PACKS, today, RULE_FAMILY_LAST_VERIFIED.sss),
    packItem("philhealth", PHILHEALTH_RULE_PACKS, today, RULE_FAMILY_LAST_VERIFIED.philhealth),
    packItem("pagibig", PAGIBIG_RULE_PACKS, today, RULE_FAMILY_LAST_VERIFIED.pagibig),
    packItem("bir-withholding", BIR_WITHHOLDING_RULE_PACKS, today, RULE_FAMILY_LAST_VERIFIED["bir-withholding"]),
    verificationItem({
      family: "wage-orders",
      label: LABELS["wage-orders"],
      currentVersion: `${WAGE_ORDERS.length} regional orders`,
      sourceDocument: "NWPC/RTWPB current regional rates",
      lastVerifiedOn: RULE_FAMILY_LAST_VERIFIED["wage-orders"],
    }, today),
  ];

  for (const change of KNOWN_PENDING_RULE_CHANGES) {
    const daysUntil = dayNumber(change.effectiveOn) - dayNumber(today);
    if (daysUntil > UPCOMING_WINDOW_DAYS) continue;
    items.push({
      family: change.family,
      label: `${LABELS[change.family]} · ${change.scope}`,
      status: daysUntil <= 0 ? "update-overdue" : "change-upcoming",
      currentVersion: null,
      sourceDocument: change.reference,
      lastVerifiedOn: RULE_FAMILY_LAST_VERIFIED[change.family],
      detail: daysUntil <= 0
        ? `${change.reference} took effect ${change.effectiveOn} but is not loaded. ${change.note}`
        : `${change.reference} takes effect ${change.effectiveOn} (in ${daysUntil} day${daysUntil === 1 ? "" : "s"}). ${change.note}`,
    });
  }

  return items.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || a.label.localeCompare(b.label));
}
