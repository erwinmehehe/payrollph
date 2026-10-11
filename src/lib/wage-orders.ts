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
 * NWPC ROVII-27: published 2026-09-28, effective 2026-10-14.
 * Class A covers Expanded Metro Cebu; Class B covers other covered cities
 * and municipalities including Negros Oriental and Siquijor.
 * Reference: https://nwpc.dole.gov.ph/central-visayas-workers-set-to-receive-%E2%82%B142-minimum-wage-increase-wage-review-in-other-regions-ongoing/
 *
 * The general regional screen still uses the highest (Class A) rate when the
 * exact locality is not established. It is a conservative REVIEW FLAG only,
 * never a salary adjustment or a claim about the employee's legal wage tier.
 */
export type RegionVIIWageClass = "A" | "B";
export const REGION_VII_WAGE_TIERS = [
  {
    wageClass: "A",
    geography: "Expanded Metro Cebu: Carcar, Cebu, Danao, Lapu-Lapu, Mandaue, Naga, Talisay, Compostela, Consolacion, Cordova, Liloan, Minglanilla, San Fernando",
    oldDailyRate: 540,
    newDailyRate: 582,
  },
  {
    wageClass: "B",
    geography: "Other covered cities and municipalities, including Negros Oriental and Siquijor",
    oldDailyRate: 500,
    newDailyRate: 542,
  },
] as const;
export const ROVII27_EFFECTIVE_ON = "2026-10-14";
export const ROVII27_SOURCE_URL =
  "https://nwpc.dole.gov.ph/central-visayas-workers-set-to-receive-%E2%82%B142-minimum-wage-increase-wage-review-in-other-regions-ongoing/";

export const FORTHCOMING_WAGE_ORDERS: WageOrder[] = [
  { region: "VII", dailyRate: REGION_VII_WAGE_TIERS[0].newDailyRate,
    wageOrder: "WO-ROVII-27", effectiveOn: ROVII27_EFFECTIVE_ON, verified: true },
];

function verifiedWageDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Wage screening as-of date must use YYYY-MM-DD.");
  }
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid wage screening calendar date.");
  }
  return value;
}

/**
 * Exact Region VII wage-class resolution is opt-in and requires explicit
 * employer classification; region-only callers retain the highest tier as an
 * advisory screening reference. No rates take effect before 2026-10-14.
 */
export function wageOrderFor(region: string, asOfDate?: string, wageClass?: RegionVIIWageClass): WageOrder {
  const normalized = region.trim().toUpperCase();
  const order = WAGE_ORDERS.find((row) => row.region === normalized);
  if (!order) {
    throw new Error(`Unknown Philippine wage region "${region}". Select a supported NWPC region instead of assuming NCR.`);
  }
  const date = asOfDate === undefined ? null : verifiedWageDate(asOfDate);
  if (wageClass !== undefined) {
    if (normalized !== "VII") {
      throw new Error("Wage Class A/B may only be selected for Region VII.");
    }
    const tier = REGION_VII_WAGE_TIERS.find((item) => item.wageClass === wageClass);
    if (!tier) throw new Error("Invalid Region VII wage class; choose A or B.");
    const active = date !== null && date >= ROVII27_EFFECTIVE_ON;
    return {
      region: "VII",
      dailyRate: active ? tier.newDailyRate : tier.oldDailyRate,
      wageOrder: active ? "WO-ROVII-27" : "WO-ROVII-26",
      effectiveOn: active ? ROVII27_EFFECTIVE_ON : "2025-10-04",
      verified: true,
    };
  }
  if (date === null) return order;
  const applicable = FORTHCOMING_WAGE_ORDERS
    .filter((item) => item.region === normalized && item.effectiveOn <= date)
    .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn))[0];
  return applicable ?? order;
}

export function isBelowMinimum(monthlyBasic: number, region: string, daysPerMonth = 22,
  asOfDate?: string, wageClass?: RegionVIIWageClass) {
  if (!Number.isFinite(monthlyBasic) || monthlyBasic < 0 || !Number.isFinite(daysPerMonth) || daysPerMonth <= 0) {
    throw new Error("Wage screening requires a non-negative monthly rate and positive working days per month.");
  }
  const order = wageOrderFor(region, asOfDate, wageClass);
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
