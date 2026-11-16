import { storedMoneyCentavos } from "./stored-money-centavos";

/**
 * Single source for the PD 851 13th-month entitlement arithmetic.
 *
 * Pure, integer-centavo, no I/O. The DOLE report uses its entitlement arithmetic
 * for screening; year-end and final pay retain their separate paths (see the
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
  const addBasic = (cents: number, code: string) => {
    const next = out.basicCentavos + cents;
    if (!Number.isSafeInteger(next)) out.blockers.push(`BASIC_TOTAL_UNSAFE:${code}`);
    else out.basicCentavos = next;
  };
  const addExcluded = (cents: number, code: string) => {
    const next = (out.excludedPay[code] ?? 0) + cents;
    if (!Number.isSafeInteger(next)) out.blockers.push(`EXCLUDED_PAY_TOTAL_UNSAFE:${code}`);
    else out.excludedPay[code] = next;
  };

  for (const line of lines) {
    const code = String(line.code ?? "").toUpperCase();
    const displayCode = code || "(no code)";
    const cls = classifyBasicLine(code);
    const cents = storedMoneyCentavos(line.amount);
    if (cents === null) {
      if (cls.kind === "RETRO") out.blockers.push(`RETRO_AMOUNT_INVALID:${code}`);
      else {
        // A missing or malformed BASIC amount must not shrink an employee's earned base.
        // Even excluded lines are blocked so incomplete released-line evidence is visible.
        out.blockers.push(`LINE_AMOUNT_INVALID:${displayCode}`);
        out.reviewFlags.push(`AMOUNT_NOT_VERIFIABLE_SKIPPED:${displayCode}`);
      }
      continue;
    }

    if (cls.kind === "RETRO") {
      const match = /^RETRO-(\d+)$/.exec(code);
      const adjustmentId = match ? Number(match[1]) : Number.NaN;
      // Do not silently round an unsafe retro id into another adjustment's year.
      const year = Number.isSafeInteger(adjustmentId)
        ? options.retroSourceYear?.(adjustmentId) : undefined;
      if (!Number.isInteger(year) || !Number.isInteger(options.taxYear)) {
        out.blockers.push(`RETRO_SOURCE_YEAR_UNVERIFIED:${code}`);
        continue;
      }
      if (year === options.taxYear) addBasic(cents, code);
      else addExcluded(cents, code);
      continue;
    }
    if (cls.included) { addBasic(cents, code); continue; }
    if (cls.kind === "EXCLUDED_PAY") addExcluded(cents, code);
    else if (cls.kind === "UNCLASSIFIED") {
      addExcluded(cents, displayCode);
      out.reviewFlags.push(`UNCLASSIFIED_LINE_EXCLUDED:${displayCode}`);
    }
  }
  // When blockers exist, sums are only partial diagnostics. Callers MUST stop.
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
    if (basic > 100_000_000_000_000) {
      // Preserve the existing helper's one-trillion-peso basic salary boundary.
      res.blockers.push("THIRTEENTH_BASIC_CENTAVOS_INVALID");
    } else {
      // One division and remainder on integer centavos; never round-trip via pesos.
      res.entitlementCentavos = Math.floor(basic / 12) + (basic % 12 >= 6 ? 1 : 0);
    }
  }

  for (const source of ["payroll", "historical", "finalPay"] as const) {
    let net = 0;
    for (const amount of input.payouts[source] ?? []) {
      const cents = storedMoneyCentavos(amount);
      if (cents === null) { res.blockers.push(`PAYOUT_AMOUNT_INVALID:${source}`); continue; }
      if (cents < 0) {
        const nextReversed = res.reversedCentavos - cents;
        if (!Number.isSafeInteger(nextReversed)) res.blockers.push(`REVERSAL_TOTAL_UNSAFE:${source}`);
        else res.reversedCentavos = nextReversed;
      }
      const nextNet = net + cents;
      if (!Number.isSafeInteger(nextNet)) res.blockers.push(`PAYOUT_TOTAL_UNSAFE:${source}`);
      else net = nextNet;
    }
    if (net < 0) {
      res.reviewFlags.push(`REVERSALS_EXCEED_PAYOUTS_FLOORED_AT_ZERO:${source}`);
      net = 0;
    }
    const nextGranted = res.grantedCentavos + net;
    if (!Number.isSafeInteger(nextGranted)) res.blockers.push("GRANTED_TOTAL_UNSAFE");
    else res.grantedCentavos = nextGranted;
  }

  if (res.blockers.length > 0) {
    // Do not expose a partial amount as a usable 13th-month payment instruction.
    return { ...res, entitlementCentavos: 0, grantedCentavos: 0,
      stillDueCentavos: 0, overpaidCentavos: 0, reversedCentavos: 0 };
  }
  res.stillDueCentavos = Math.max(0, res.entitlementCentavos - res.grantedCentavos);
  res.overpaidCentavos = Math.max(0, res.grantedCentavos - res.entitlementCentavos);
  if (res.overpaidCentavos > 0) res.reviewFlags.push("OVERPAID_NOT_RECOVERED_NEEDS_POLICY");
  return res;
}
