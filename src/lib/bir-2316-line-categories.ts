/**
 * Categorise one employee's calculated payroll lines into the BIR Form 2316 detail items (29-37 non-taxable, 39-51B taxable).
 *
 * Today the whole category split is a person's job: bir-2316-reconciliation.ts requires "reviewed present-employer category
 * mapping" and the year-end row only carries totals. The lines themselves, however, already say what they are (a code family,
 * a `Type:` note and a `Tax treatment:` note), so most of the split is mechanical. This module does that mechanical part and
 * REFUSES the rest: a line it cannot place with confidence is returned in `unmapped` with a reason, never guessed, never
 * folded into a neighbouring item and never turned into a zero.
 *
 * Every mapping below carries a tier:
 *   "direct"     the line's own code or type names the 2316 item (OT -> 50, commission -> 45, de minimis -> 35).
 *   "convention" a defensible placement that a reviewer must confirm (night differential and the holiday premium of an
 *                ordinary taxpayer have no 2316 line of their own, so they go to "Others" 51A / 51B with a description).
 *   "review"     not mapped.
 * Two structural mappings are supported by the BIR 1604-C Alphalist. See the 2316 mapping review in docs/payroll-certification:
 *   1. Employee contributions (item 36) are carved OUT of basic pay, so item 39 (item 29 for an MWE) is basic pay less
 *      contributions. That is what makes items 29-37 + 39-51B add up to gross compensation.
 *   2. The shared PHP 90,000 pool (13th month, bonuses, de minimis excess) is exempt up to the cap in item 34 and the excess
 *      is reported in item 48.
 *
 * Scope: lines calculated by this payroll engine. Months imported from a previous provider have no lines; `importedPeriods`
 * therefore makes the result incomplete rather than silently under-reporting. The module is pure: no database, no file, no
 * network, and it is wired into no route.
 */
import { THIRTEENTH_MONTH_EXEMPTION_CAP, isSharedBenefitPoolEarningType, type AnnualizationResult } from "./annualization";
import { BIR_2316_NON_TAX_ITEMS, BIR_2316_TAX_ITEMS } from "./bir-2316-reconciliation";

export type Bir2316Line = {
  code?: string;
  label?: string;
  amount?: number | string;
  notes?: string[];
  benefitPool90k?: boolean;
  benefitPoolKind?: string;
  periodOtherBenefitsPool?: number;
};

export type Bir2316Tier = "direct" | "convention";
export type Bir2316Unmapped = { code: string; label: string; amount: string; reason: string };
export type Bir2316Categories = {
  mwe: boolean;
  /** Item number to a two-decimal amount, for every item some line fed. */
  items: Record<string, string>;
  /** Item number to the line codes that fed it, so a reviewer can trace each figure. */
  basis: Record<string, string[]>;
  tiers: Record<string, Bir2316Tier>;
  /** Descriptions required by the certificate for items 44A, 44B, 51A and 51B when they are above zero. */
  descriptions: Partial<Record<"44A" | "44B" | "51A" | "51B", string>>;
  unmapped: Bir2316Unmapped[];
  /** Why the result is incomplete or inconsistent. */
  issues: string[];
  /** Every 2316 detail item with an explicit amount, or null while anything is unmapped or inconsistent. Zeros are evidence only then. */
  detailItems: Record<string, string> | null;
};

type Ctx = {
  mwe: boolean;
  /** Months imported from a previous provider. Their lines do not exist, so they cannot be categorised. */
  importedPeriods?: number;
  /** The 13th month entitlement not yet paid. Year end accrues it into gross compensation and the pool. */
  accruedUnpaidThirteenth?: number;
  /** Only codes independently matched to settled supplementary-earning records in the released ledger. */
  settledTaxableAllowanceCodes?: ReadonlySet<string>;
};

type Target =
  | { to: "basic" }
  | { to: "item"; item: string; tier: Bir2316Tier; description?: string }
  | { to: "pool13" } | { to: "poolOther" }
  | { to: "deMinimis" }
  | { to: "contribution" }
  | { to: "supplementaryAllowance" }
  | { to: "skip"; why: string }
  | { to: "review"; why: string };

const cents = (value: unknown) => {
  const number = Number(value);
  const scaled = number * 100;
  const rounded = Math.round(scaled);
  return Number.isFinite(number) && Math.abs(scaled - rounded) < 1e-6 && Number.isSafeInteger(rounded) ? rounded : null;
};
const money = (value: number) => (value / 100).toFixed(2);
const note = (line: Bir2316Line, prefix: string) =>
  (line.notes ?? []).find((text) => String(text).startsWith(prefix))?.slice(prefix.length).trim() ?? "";

const SKIP_EXACT = new Set(["WHT", "HDMF_VOL", "LATE", "UT", "UNPAID_MANDATORY"]);
const SKIP_PREFIX: Array<[string, string]> = [
  ["YE-TAX", "tax settlement, not compensation"], ["LOAN-", "loan deduction, not compensation"],
  ["EWA-", "earned wage advance recovery, not compensation"], ["EXP-", "expense reimbursement, not compensation"],
];

/** Where one line belongs. Unknown or judgement-dependent lines are "review". */
export function classifyBir2316Line(line: Bir2316Line, mwe: boolean, settledTaxableAllowance = false): Target {
  const code = String(line.code ?? "").toUpperCase();
  const type = note(line, "Type: ").toLowerCase();
  const treatment = note(line, "Tax treatment: ").toLowerCase();
  if (code === "SSS" || code === "PHIC" || code === "HDMF") return { to: "contribution" };
  if (SKIP_EXACT.has(code)) return { to: "skip", why: code === "HDMF_VOL" ? "voluntary Pag-IBIG is not an exempt contribution" : "deduction, not compensation" };
  for (const [prefix, why] of SKIP_PREFIX) if (code.startsWith(prefix)) return { to: "skip", why };
  if (code === "BASIC" || code === "HOLIDAY_UNWORKED" || code.startsWith("LEAVE-") || code.startsWith("RETRO-")) return { to: "basic" };
  if (code === "OT") return { to: "item", item: mwe ? "31" : "50", tier: "direct" };
  if (code === "CALAMITY") return { to: "review", why: "combined calamity/hazard premium: verify that it is hazard pay and establish eligibility before mapping to item 33 or 49" };
  if (code === "HOLIDAY") return mwe
    ? { to: "review", why: "combined holiday/rest-day premium: separate qualifying MWE holiday pay before mapping to item 30" }
    : { to: "item", item: "51B", tier: "convention", description: "Holiday and rest-day premium" };
  if (code === "ND") return mwe
    ? { to: "item", item: "32", tier: "direct" }
    : { to: "item", item: "51A", tier: "convention", description: "Night differential" };
  if (code.startsWith("DM-")) return { to: "deMinimis" };
  if (/^(PREM|OTPREM|NDPREM|DAYPREM)-/.test(code)) return { to: "review", why: "pay-policy premium: its 2316 item depends on the rule's own taxable flag and a legal reading" };
  if (code.startsWith("LEAVE_CONV-")) return { to: "review", why: "leave conversion: the exempt portion and its 2316 item need a legal reading" };

  // Supplementary earnings and recurring components share one shape: a Type note and a Tax treatment note.
  if (type === "allowance") {
    return settledTaxableAllowance && treatment === "taxable" && /^EARN-[1-9]\d*$/.test(code) &&
      line.benefitPool90k !== true && (!line.benefitPoolKind || line.benefitPoolKind === type)
      ? { to: "supplementaryAllowance" }
      : { to: "review", why: "generic allowance lacks matching settled taxable supplementary-earning evidence" };
  }
  if (line.benefitPool90k === true || isSharedBenefitPoolEarningType(type) || isSharedBenefitPoolEarningType(line.benefitPoolKind)
      || type === "13th_month" || type === "thirteenth_month") {
    return type === "13th_month" || type === "thirteenth_month" ? { to: "pool13" } : { to: "poolOther" };
  }
  if (type === "commission") return treatment === "taxable" ? { to: "item", item: "45", tier: "direct" } : { to: "review", why: "non-taxable commission" };
  if (type === "taxable_allowance" || type === "recurring_allowance") {
    return treatment === "taxable"
      ? { to: "item", item: "44A", tier: "convention", description: "Taxable allowance" }
      : treatment === "non-taxable"
        ? { to: "item", item: "37", tier: "convention" }
        : { to: "review", why: "allowance without an explicit tax treatment" };
  }
  if (code.startsWith("EARN-") || code.startsWith("COMP-") || type) {
    return { to: "review", why: "earning type \"" + (type || "unknown") + "\" has no unambiguous 2316 item" };
  }
  return { to: "review", why: "unrecognised line code \"" + code + "\"" };
}

export function categorizeBir2316Lines(lines: readonly Bir2316Line[], ctx: Ctx): Bir2316Categories {
  const mwe = ctx.mwe;
  const issues: string[] = [];
  const unmapped: Bir2316Unmapped[] = [];
  const totals = new Map<string, number>();
  const basis: Record<string, string[]> = {};
  const tiers: Record<string, Bir2316Tier> = {};
  const descriptions: Bir2316Categories["descriptions"] = {};
  let basic = 0, contributions = 0, pool13 = 0, poolOther = 0, deMinimisExempt = 0, deMinimisExcess = 0;
  const basicCodes: string[] = [], poolCodes: string[] = [], dmCodes: string[] = [], contributionCodes: string[] = [];
  const allowances: Array<{ code: string; label: string; amount: number }> = [];
  const add = (item: string, amount: number, code: string, tier: Bir2316Tier, description?: string) => {
    totals.set(item, (totals.get(item) ?? 0) + amount);
    (basis[item] ??= []).push(code);
    tiers[item] = tier;
    if (description && (item === "44A" || item === "44B" || item === "51A" || item === "51B")) descriptions[item] = description;
  };

  for (const line of lines) {
    const code = String(line.code ?? "").toUpperCase() || "(no code)";
    const amount = cents(line.amount ?? 0);
    const target = classifyBir2316Line(line, mwe, ctx.settledTaxableAllowanceCodes?.has(code));
    if (amount === null) {
      if (target.to !== "skip") unmapped.push({ code, label: String(line.label ?? ""), amount: String(line.amount), reason: "amount is not an exact centavo value" });
      continue;
    }
    // The engine emits these combined buckets even when no premium was paid.
    if (amount === 0 && (target.to !== "review" || code === "CALAMITY" || code === "HOLIDAY")) continue;
    switch (target.to) {
      case "skip": break;
      case "review": unmapped.push({ code, label: String(line.label ?? ""), amount: money(amount), reason: target.why }); break;
      case "contribution": contributions += Math.abs(amount); contributionCodes.push(code); break;
      case "supplementaryAllowance": allowances.push({ code, label: String(line.label ?? ""), amount }); break;
      case "basic": basic += amount; basicCodes.push(code); break;
      case "pool13": pool13 += Math.max(0, amount); poolCodes.push(code); break;
      case "poolOther": poolOther += Math.max(0, amount); poolCodes.push(code); break;
      case "deMinimis": {
        const pool = cents(line.periodOtherBenefitsPool ?? 0);
        if (pool === null || pool < 0 || pool > amount) { unmapped.push({ code, label: String(line.label ?? ""), amount: money(amount), reason: "de minimis excess is not an exact amount within the line" }); break; }
        deMinimisExcess += pool; deMinimisExempt += amount - pool; dmCodes.push(code); break;
      }
      case "item": add(target.item, amount, code, target.tier, target.description); break;
    }
  }

  const allowanceSlot = ["51A", "51B"].find(item => !totals.has(item));
  for (const { code, label, amount } of allowances) {
    if (allowanceSlot && amount > 0) add(allowanceSlot, amount, code, "convention", "Taxable supplementary allowances");
    else unmapped.push({ code, label, amount: money(amount), reason: "taxable supplementary allowance requires a reviewed item 51 allocation" });
  }

  const accrued = ctx.accruedUnpaidThirteenth === undefined ? 0 : cents(ctx.accruedUnpaidThirteenth);
  if (accrued === null || accrued < 0) issues.push("INVALID_ACCRUED_THIRTEENTH: the unpaid 13th month must be an exact non-negative amount.");
  const accruedCents = accrued ?? 0;
  if (accruedCents > 0) poolCodes.push("(accrued unpaid 13th month)");

  // Convention 2: the shared pool is exempt up to the cap (item 34) and the excess is taxable (item 48).
  const poolTotal = pool13 + poolOther + deMinimisExcess + accruedCents;
  const cap = THIRTEENTH_MONTH_EXEMPTION_CAP * 100;
  const exemptPool = Math.min(poolTotal, cap);
  if (exemptPool > 0) { totals.set("34", exemptPool); basis["34"] = [...poolCodes, ...dmCodes]; tiers["34"] = "direct"; }
  if (poolTotal - exemptPool > 0) { totals.set("48", poolTotal - exemptPool); basis["48"] = [...poolCodes, ...dmCodes]; tiers["48"] = "direct"; }
  if (deMinimisExempt > 0) { totals.set("35", deMinimisExempt); basis["35"] = dmCodes; tiers["35"] = "direct"; }
  if (contributions > 0) { totals.set("36", contributions); basis["36"] = contributionCodes; tiers["36"] = "direct"; }

  // Convention 1: contributions are carved out of basic pay.
  const basicItem = mwe ? "29" : "39";
  if (basic > 0 || contributions > 0) {
    const remainder = basic - contributions;
    if (remainder < 0) issues.push("CONTRIBUTIONS_EXCEED_BASIC: employee contributions are larger than basic pay, so they cannot be carved out of it.");
    else if (remainder > 0) { totals.set(basicItem, (totals.get(basicItem) ?? 0) + remainder); basis[basicItem] = [...(basis[basicItem] ?? []), ...basicCodes]; tiers[basicItem] = "convention"; }
  }
  if ((ctx.importedPeriods ?? 0) > 0) {
    issues.push("IMPORTED_HISTORY_NOT_CATEGORISED: " + ctx.importedPeriods + " imported month(s) have no payroll lines; these items cover only the periods this engine calculated.");
  }
  if (unmapped.length) issues.push("UNMAPPED_LINES: " + unmapped.length + " line(s) need a reviewer; no item is certified until they are placed.");

  const items: Record<string, string> = {};
  for (const [item, value] of totals) items[item] = money(value);
  for (const item of ["44A", "44B", "51A", "51B"] as const) if (items[item] && !descriptions[item]) issues.push("MISSING_DESCRIPTION_" + item);

  const complete = issues.length === 0 && unmapped.length === 0;
  let detailItems: Record<string, string> | null = null;
  if (complete) {
    detailItems = {};
    for (const item of [...BIR_2316_NON_TAX_ITEMS, ...BIR_2316_TAX_ITEMS]) detailItems[item] = items[item] ?? "0.00";
  }
  return { mwe, items, basis, tiers, descriptions, unmapped, issues, detailItems };
}

/**
 * Check the categorised items against the year-end annualization result for the same employee.
 * Items must add up to gross compensation. For an ordinary taxpayer the exempt items must equal the annualization's
 * non-taxable total and the taxable items its taxable income, so a line the payroll exempted but year end taxes (or the reverse)
 * shows up here instead of in a filed certificate.
 */
export function reconcileBir2316Categories(
  categories: Pick<Bir2316Categories, "items" | "mwe">,
  annual: Pick<AnnualizationResult, "grossCompensation" | "nonTaxable" | "taxableIncome" | "mwe">,
) {
  const issues: string[] = [];
  const sum = (list: readonly string[]) => list.reduce((total, item) => total + (cents(categories.items[item] ?? "0") ?? 0), 0);
  const exempt = sum(BIR_2316_NON_TAX_ITEMS);
  const taxable = sum(BIR_2316_TAX_ITEMS);
  if (categories.mwe !== annual.mwe) issues.push("MWE_STATUS_DIFFERS: the lines were categorised as " + (categories.mwe ? "an MWE" : "an ordinary taxpayer") + " but annualization used the other.");
  if (exempt + taxable !== cents(annual.grossCompensation)) {
    issues.push("GROSS_MISMATCH: items 29-37 and 39-51B add up to " + money(exempt + taxable) + " but annualization gross compensation is " + annual.grossCompensation.toFixed(2) + ".");
  }
  if (!annual.mwe) {
    if (exempt !== cents(annual.nonTaxable)) issues.push("EXEMPT_TOTAL_MISMATCH: exempt items add up to " + money(exempt) + " but annualization non-taxable is " + annual.nonTaxable.toFixed(2) + ".");
    if (taxable !== cents(annual.taxableIncome)) issues.push("TAXABLE_TOTAL_MISMATCH: taxable items add up to " + money(taxable) + " but annualization taxable income is " + annual.taxableIncome.toFixed(2) + ".");
  }
  return issues;
}
