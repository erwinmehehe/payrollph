import { storedMoneyCentavos } from "./stored-money-centavos";
import { thirteenthMonthFromCentavos } from "./thirteenth-month-centavos";

/**
 * Single source for the PD 851 13th-month entitlement arithmetic.
 *
 * Pure, integer-centavo, no I/O. It is not wired into year-end, final pay or the
 * DOLE report yet; those three still compute their own copies (see the
 * "Divergences" section of docs/payroll-certification/thirteenth-month-entitlement.md).
 *
 * Rule encoded (DOLE minimum): entitlement = 1/12 of BASIC salary actually earned in the
 * calendar year, rounded once to the centavo half-up. Anything not clearly basic stays out of
 * the base and is reported, never silently dropped or silently included.
 *
 * Evidence label SOLO_VERIFIED_DEV. Not a payroll certification.
 */

export type ThirteenthLine = { code?: string; label?: string; amount?: string | number };

export type BasicClassification = {
  included: boolean;
  kind: "BASIC" | "PAID_LEAVE" | "TARDINESS" | "UNDERTIME" | "RETRO" | "EXCLUDED_PAY" | "NOT_PAY" | "UNCLASSIFIED";
};

/** Lines that are known pay but are not basic salary for the DOLE minimum. */
const EXCLUDED_PAY = [/^HOLIDAY_UNWORKED$/, /^HOLIDAY$/, /^OT$/, /^ND$/, /^OTPREM-/, /^NDPREM-/, /^LEAVE_CONV-/];
/** Known non-pay or statutory lines that never belong in a basic base. */
const NOT_PAY = [/^(SSS|PHIC|HDMF|PAGIBIG|PAG-IBIG|WHT|TAX|UNPAID_MANDATORY)$/, /^DM-/];

export function isThirteenthPayoutLine(line: ThirteenthLine): boolean {
  const code = String(line.code ?? "").toUpperCase();
  const label = String(line.label ?? "").toLowerCase();
  return code.includes("13TH") || code.includes("THIRTEENTH")
    || label.includes("13th month") || label.includes("thirteenth month");
}

export function classifyBasicLine(code: string | undefined): BasicClassification {
  const c = String(code ?? "").toUpperCase();
  if (c === "BASIC") return { included: true, kind: "BASIC" };
  if (c === "LATE") return { included: true, kind: "TARDINESS" };
  if (c === "UT") return { included: true, kind: "UNDERTIME" };
  if (c.startsWith("LEAVE-")) return { included: true, kind: "PAID_LEAVE" };
  if (/^RETRO-/.test(c)) return { included: false, kind: "RETRO" }; // decided by source year, see sumBasicCentavos
  if (EXCLUDED_PAY.some((re) => re.test(c))) return { included: false, kind: "EXCLUDED_PAY" };
  if (NOT_PAY.some((re) => re.test(c)) || isThirteenthPayoutLine({ code: c })) return { included: false, kind: "NOT_PAY" };
  return { included: false, kind: "UNCLASSIFIED" };
}

export type BasicSum = {
  basicCentavos: number;
  /** Pay lines deliberately left out of the base, by code, in centavos. */
  excludedPay: Record<string, number>;
  blockers: string[];
  reviewFlags: string[];
};

/**
 * Sum the BASIC base from released payroll lines.
 * `retroSourceYear` maps a RETRO-<adjustmentId> id to the tax year of the ORIGINAL cutoff
 * (null = unknown). A retro line counts only when that year equals `taxYear`; an unknown year
 * blocks, exactly like final-pay's FINAL_PAY_RETRO_SOURCE_YEAR_UNVERIFIED.
 */
export function sumBasicCentavos(
  lines: readonly ThirteenthLine[],
  options: { taxYear?: number; retroSourceYear?: (adjustmentId: number) => number | null | undefined } = {},
): BasicSum {
  const out: BasicSum = { basicCentavos: 0, excludedPay: {}, blockers: [], reviewFlags: [] };
  for (const line of lines) {
    const code = String(line.code ?? "").toUpperCase();
    const cls = classifyBasicLine(code);
    const cents = storedMoneyCentavos(line.amount);
    if (cents === null) {
      if (cls.kind === "RETRO") out.blockers.push(`RETRO_AMOUNT_INVALID:${code}`);
      else if (line.amount !== undefined && line.amount !== null && String(line.amount).trim() !== "") {
        out.reviewFlags.push(`AMOUNT_NOT_VERIFIABLE_SKIPPED:${code || "(no code)"}`);
      }
      continue;
    }
    if (cls.kind === "RETRO") {
      const match = /^RETRO-(\d+)$/.exec(code);
      const year = match ? options.retroSourceYear?.(Number(match[1])) : undefined;
      if (!Number.isInteger(year) || !Number.isInteger(options.taxYear)) {
        out.blockers.push(`RETRO_SOURCE_YEAR_UNVERIFIED:${code}`);
        continue;
      }
      if (year === options.taxYear) out.basicCentavos += cents;
      else out.excludedPay[code] = (out.excludedPay[code] ?? 0) + cents;
      continue;
    }
    if (cls.included) { out.basicCentavos += cents; continue; }
    if (cls.kind === "EXCLUDED_PAY") out.excludedPay[code] = (out.excludedPay[code] ?? 0) + cents;
    else if (cls.kind === "UNCLASSIFIED") {
      out.excludedPay[code || "(no code)"] = (out.excludedPay[code || "(no code)"] ?? 0) + cents;
      out.reviewFlags.push(`UNCLASSIFIED_LINE_EXCLUDED:${code || "(no code)"}`);
    }
  }
  return out;
}

export type ThirteenthSource = "payroll" | "historical" | "finalPay";

export type ThirteenthInput = {
  /** Basic earned in the calendar year, centavos. May be negative only through data error. */
  basicCentavos: number;
  /** Signed 13th-month payout lines per source, in pesos as stored. Negative lines are reversals. */
  payouts: Partial<Record<ThirteenthSource, ReadonlyArray<string | number>>>;
};

export type ThirteenthResult = {
  entitlementCentavos: number;
  grantedCentavos: number;
  stillDueCentavos: number;
  overpaidCentavos: number;
  reversedCentavos: number;
  blockers: string[];
  reviewFlags: string[];
};

/**
 * Entitlement versus what was actually granted.
 *
 * Negative liabilities: a negative 13th-month line is a reversal and REDUCES what counts as
 * granted. (final-pay's reader and the DOLE report both do Math.max(0, amount) per line, which
 * drops a reversal and keeps the original payout counted.) Each source is netted separately and
 * floored at zero, so a data error in one source cannot create a credit against another.
 * An overpayment is reported, never recovered here.
 */
export function computeThirteenthMonth(input: ThirteenthInput): ThirteenthResult {
  const res: ThirteenthResult = {
    entitlementCentavos: 0, grantedCentavos: 0, stillDueCentavos: 0, overpaidCentavos: 0,
    reversedCentavos: 0, blockers: [], reviewFlags: [],
  };

  if (!Number.isSafeInteger(input.basicCentavos)) {
    res.blockers.push("BASIC_NOT_INTEGER_CENTAVOS");
  } else {
    let basic = input.basicCentavos;
    if (basic < 0) {
      res.reviewFlags.push("BASIC_NET_NEGATIVE_FLOORED_AT_ZERO");
      basic = 0;
    }
    try {
      res.entitlementCentavos = Math.round(thirteenthMonthFromCentavos(basic / 100) * 100);
    } catch (error) {
      res.blockers.push(error instanceof Error ? error.message : "THIRTEENTH_ENTITLEMENT_FAILED");
    }
  }

  for (const source of ["payroll", "historical", "finalPay"] as const) {
    let net = 0;
    for (const amount of input.payouts[source] ?? []) {
      const cents = storedMoneyCentavos(amount);
      if (cents === null) { res.blockers.push(`PAYOUT_AMOUNT_INVALID:${source}`); continue; }
      if (cents < 0) res.reversedCentavos += -cents;
      net += cents;
    }
    if (net < 0) {
      res.reviewFlags.push(`REVERSALS_EXCEED_PAYOUTS_FLOORED_AT_ZERO:${source}`);
      net = 0;
    }
    res.grantedCentavos += net;
  }

  res.stillDueCentavos = Math.max(0, res.entitlementCentavos - res.grantedCentavos);
  res.overpaidCentavos = Math.max(0, res.grantedCentavos - res.entitlementCentavos);
  if (res.overpaidCentavos > 0) res.reviewFlags.push("OVERPAID_NOT_RECOVERED_NEEDS_POLICY");
  return res;
}
