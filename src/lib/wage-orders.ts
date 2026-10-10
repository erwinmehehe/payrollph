import type { HolidayType } from "@/lib/payroll-rules";

export type WageOrder = {
  region: string;
  dailyRate: number;
  wageOrder: string;
  effectiveOn: string;
  /**
   * True means the stored screening rate/order was confirmed against an
   * official NWPC/RTWPB current-rate source. It does NOT mean the high tier is
   * legally applicable to every employer in that region.
   */
  verified: boolean;
};

/**
 * Current private-sector regional wage screening references as of 2026-10-03,
 * verified against the official NWPC/RTWPB current-rate pages.
 *
 * IMPORTANT: several wage orders have sector, establishment-size, area, or
 * municipality tiers. This compact registry stores the HIGHEST rate currently
 * effective in each region so it can surface a conservative review warning.
 * It is not an automatic legal conclusion that every employer owes that high
 * tier. Callers must keep the result advisory until the employer's exact wage
 * category is known.
 *
 * For tranches, effectiveOn is the date the stored high-tier rate became
 * effective. Future tranches are intentionally excluded.
 *
 * MWE classification is explicit on the employee record. A rate below this
 * screening reference may raise a human-review flag, but never changes MWE
 * tax status or withholding treatment automatically.
 */
export const WAGE_ORDERS: WageOrder[] = [
  { region: "NCR", dailyRate: 755, wageOrder: "WO-NCR-28", effectiveOn: "2026-09-26", verified: true },
  { region: "CAR", dailyRate: 505, wageOrder: "WO-CAR-24", effectiveOn: "2025-12-30", verified: true },
  { region: "I", dailyRate: 505, wageOrder: "WO-RB1-24", effectiveOn: "2025-11-19", verified: true },
  { region: "II", dailyRate: 500, wageOrder: "WO-RTWPB 2-24", effectiveOn: "2025-11-05", verified: true },
  { region: "III", dailyRate: 600, wageOrder: "WO-RBIII-26", effectiveOn: "2026-04-16", verified: true },
  { region: "IV-A", dailyRate: 600, wageOrder: "WO-IVA-22", effectiveOn: "2025-10-05", verified: true },
  { region: "IV-B", dailyRate: 455, wageOrder: "WO-RB-MIMAROPA-13", effectiveOn: "2026-01-01", verified: true },
  { region: "V", dailyRate: 455, wageOrder: "WO-RBV-23", effectiveOn: "2026-04-08", verified: true },
  { region: "VI", dailyRate: 550, wageOrder: "WO-RBVI-29", effectiveOn: "2025-11-19", verified: true },
  // ROVII-27 is already published but takes effect only on 2026-10-14.
  { region: "VII", dailyRate: 540, wageOrder: "WO-ROVII-26", effectiveOn: "2025-10-04", verified: true },
  { region: "VIII", dailyRate: 470, wageOrder: "WO-RB VIII-25", effectiveOn: "2026-06-01", verified: true },
  { region: "IX", dailyRate: 464, wageOrder: "WO-RIX-24", effectiveOn: "2026-06-01", verified: true },
  { region: "X", dailyRate: 500, wageOrder: "WO-RX-24", effectiveOn: "2026-05-01", verified: true },
  { region: "XI", dailyRate: 540, wageOrder: "WO-RB XI-24", effectiveOn: "2026-09-01", verified: true },
  { region: "XII", dailyRate: 460, wageOrder: "WO-RXII-25", effectiveOn: "2025-12-15", verified: true },
  { region: "XIII", dailyRate: 475, wageOrder: "WO-RXIII-20", effectiveOn: "2026-05-01", verified: true },
  { region: "BARMM", dailyRate: 436, wageOrder: "WO-BARMM-05", effectiveOn: "2026-08-06", verified: true },
];

/**
 * Wage-order transitions published by the official NWPC but not yet
 * applicable to the 2026-10-10 baseline. The highest *Class A* reference is
 * an ADVISORY screen; legal Class B/sector treatment still requires HR review.
 * Source: https://nwpc.dole.gov.ph/central-visayas-workers-set-to-receive-%E2%82%B142-minimum-wage-increase-wage-review-in-other-regions-ongoing/
 */
export const FORTHCOMING_WAGE_ORDERS: WageOrder[] = [
  { region: "VII", dailyRate: 582, wageOrder: "WO-ROVII-27", effectiveOn: "2026-10-14", verified: true },
];

function wageOrderAsOfDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Wage screening as-of date must use YYYY-MM-DD.");
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid wage screening calendar date.");
  }
  return value;
}

/**
 * Without an as-of date, returns the existing baseline reference. Explicit
 * payroll-date lookups may select a published transition only once effective.
 * No salary increase or MWE tax classification is performed automatically.
 */
export function wageOrderFor(region: string, asOfDate?: string) {
  const normalized = region.trim().toUpperCase();
  const order = WAGE_ORDERS.find((row) => row.region === normalized);
  if (!order) {
    throw new Error(`Unknown Philippine wage region "${region}". Select a supported NWPC region instead of assuming NCR.`);
  }
  if (asOfDate == null) return order;
  const date = wageOrderAsOfDate(asOfDate);
  const current = FORTHCOMING_WAGE_ORDERS
    .filter((candidate) => candidate.region === normalized && candidate.effectiveOn <= date)
    .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn))[0];
  return current ?? order;
}

export function isBelowMinimum(monthlyBasic: number, region: string, daysPerMonth = 22, asOfDate?: string) {
  if (!Number.isFinite(monthlyBasic) || monthlyBasic < 0 || !Number.isFinite(daysPerMonth) || daysPerMonth <= 0) {
    throw new Error("Wage screening requires a non-negative monthly rate and positive working days per month.");
  }
  const order = wageOrderFor(region, asOfDate);
  const impliedDaily = monthlyBasic / daysPerMonth;
  return {
    below: impliedDaily + 0.005 < order.dailyRate,
    impliedDaily: Math.round(impliedDaily * 100) / 100,
    order,
  };
}

export type HolidayKind = "regular" | "special" | "rest";
export type HolidayCalendarEntry = { date: string; name: string; kind: HolidayKind };

/**
 * National 2026 regular and special non-working holidays.
 *
 * Base calendar: Proclamation No. 1006, s. 2025.
 * Movable Muslim holidays added by Proclamation No. 1189 (Eid'l Fitr,
 * 20 March 2026) and Proclamation No. 1264 (Eid'l Adha, 27 May 2026).
 * Special working days are intentionally omitted because they do not create
 * statutory holiday premium pay by themselves.
 */
export const NATIONAL_HOLIDAYS_2026: HolidayCalendarEntry[] = [
  { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
  { date: "2026-03-20", name: "Eid'l Fitr", kind: "regular" },
  { date: "2026-04-02", name: "Maundy Thursday", kind: "regular" },
  { date: "2026-04-03", name: "Good Friday", kind: "regular" },
  { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
  { date: "2026-05-01", name: "Labor Day", kind: "regular" },
  { date: "2026-05-27", name: "Eid'l Adha", kind: "regular" },
  { date: "2026-06-12", name: "Independence Day", kind: "regular" },
  { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
  { date: "2026-11-30", name: "Bonifacio Day", kind: "regular" },
  { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
  { date: "2026-12-30", name: "Rizal Day", kind: "regular" },

  { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
  { date: "2026-04-04", name: "Black Saturday", kind: "special" },
  { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
  { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
  { date: "2026-11-02", name: "All Souls' Day", kind: "special" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
  { date: "2026-12-24", name: "Christmas Eve", kind: "special" },
  { date: "2026-12-31", name: "Last Day of the Year", kind: "special" },
];

export const NATIONAL_HOLIDAY_RULE_PACKS = [
  {
    version: "PH-HOLIDAYS-2026-P1006+P1189+P1264",
    effectiveFrom: "2026-01-01",
    effectiveUntil: "2026-12-31",
    calendar: NATIONAL_HOLIDAYS_2026,
  },
] as const;

export function nationalHolidayCalendarForDate(asOf: string): HolidayCalendarEntry[] {
  const packs = NATIONAL_HOLIDAY_RULE_PACKS.filter((pack) =>
    pack.effectiveFrom <= asOf && asOf <= pack.effectiveUntil
  );
  if (packs.length !== 1) {
    throw new Error(
      `No certified Philippine national-holiday rule pack covers ${asOf}. Add the proclaimed holiday calendar before calculating that payroll period.`,
    );
  }
  return [...packs[0].calendar];
}

export function holidaysOn(date: string, calendar: readonly HolidayCalendarEntry[] = NATIONAL_HOLIDAYS_2026) {
  return calendar.filter((row) => row.date === date);
}

/**
 * Classifies the statutory premium context for one calendar date.
 *
 * Two regular holidays on the same date are the DOLE "double regular holiday"
 * case. We intentionally do not invent a multiplier for mixed regular/special
 * collisions; one regular holiday remains the controlling representable case.
 */
export function holidayPayContextOn(
  date: string,
  calendar: readonly HolidayCalendarEntry[] = NATIONAL_HOLIDAYS_2026,
): { holiday: HolidayType; holidays: HolidayCalendarEntry[]; label: string | null } {
  const holidays = holidaysOn(date, calendar);
  const regular = holidays.filter((row) => row.kind === "regular");

  if (regular.length >= 2) {
    return {
      holiday: "double",
      holidays,
      label: `${regular.map((row) => row.name).join(" + ")} (double regular holiday)`,
    };
  }

  if (regular.length === 1) {
    return {
      holiday: "regular",
      holidays,
      label: `${regular[0].name} (regular)`,
    };
  }

  const special = holidays.find((row) => row.kind === "special");
  if (special) {
    return {
      holiday: "special",
      holidays,
      label: `${special.name} (special)`,
    };
  }

  return { holiday: "ordinary", holidays, label: null };
}

/** Backward-compatible single-holiday lookup for non-payroll display callers. */
export function holidayOn(date: string) {
  return NATIONAL_HOLIDAYS_2026.find((row) => row.date === date) ?? null;
}
