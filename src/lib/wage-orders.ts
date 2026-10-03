import type { HolidayType } from "@/lib/payroll-rules";

export type WageOrder = {
  region: string;
  dailyRate: number;
  wageOrder: string;
  effectiveOn: string;
  /**
   * False means this row has NOT been confirmed against the region's own
   * RTWPB/NWPC wage order directly, see the module comment below. UI and
   * reports that show a wage order should say so when this is false.
   */
  verified: boolean;
};

/**
 * DOLE regional daily minimums used by this build.
 *
 * All 17 regions below (16 regional boards plus BARMM) are transcribed from a
 * third-party reference (open-payroll-data/philippines-payroll-data, MIT,
 * commit 89513baa), itself citing NWPC's "Latest Wage Orders" matrix as of
 * 2026-02-25: https://nwpc.dole.gov.ph/wp-content/uploads/2026/03/Latest-Wage-Orders-Matrix-2024-2025-As-of-25-February-2026.pdf
 *
 * `verified: false` on every row below means exactly that: nobody has opened
 * the cited NWPC matrix (or the region's own RTWPB order) directly and
 * confirmed these figures against it. This repo's own rule is to never present
 * a transcribed government figure as fact, so readiness/copy must not claim a
 * complete or confirmed wage-order registry, and `dailyRate` here must not be
 * used to automatically flag underpayment without a human check. The source
 * table gives a low and a high figure per region (the two private-sector
 * coverage tiers in that matrix); `dailyRate` uses the HIGH figure for every
 * region, for consistency with the one row (NCR) this file's prior values
 * already used, not because the high tier is confirmed to be the correct one
 * for every affected employer. `tests/wage-13th-crosscheck.test.ts` pins the
 * wage-order numbers this file was transcribed from, so a future update is a
 * deliberate, reviewed change rather than something that drifts unnoticed.
 *
 * MWE classification is explicit on the employee record; a rate below the
 * configured regional floor is additionally treated as MWE-adjacent for the
 * withholding exemption cascade (OT / holiday / night differential stay untaxed).
 */
export const WAGE_ORDERS: WageOrder[] = [
  { region: "NCR", dailyRate: 695, wageOrder: "WO-NCR-26", effectiveOn: "2025-07-18", verified: false },
  { region: "CAR", dailyRate: 500, wageOrder: "WO-CAR-24", effectiveOn: "2025-12-30", verified: false },
  { region: "I", dailyRate: 505, wageOrder: "WO-RB I-24", effectiveOn: "2025-11-19", verified: false },
  { region: "II", dailyRate: 505, wageOrder: "WO-RTWPB 2-24", effectiveOn: "2025-11-17", verified: false },
  { region: "III", dailyRate: 600, wageOrder: "WO-RBIII-26", effectiveOn: "2025-10-30", verified: false },
  { region: "IV-A", dailyRate: 600, wageOrder: "WO-IVA-22", effectiveOn: "2025-09-29", verified: false },
  { region: "IV-B", dailyRate: 455, wageOrder: "WO-MIMAROPA-13", effectiveOn: "2026-01-01", verified: false },
  { region: "V", dailyRate: 435, wageOrder: "WO-RBV-22", effectiveOn: "2025-04-05", verified: false },
  { region: "VI", dailyRate: 550, wageOrder: "WO-RBVI-29", effectiveOn: "2025-11-19", verified: false },
  { region: "VII", dailyRate: 540, wageOrder: "WO-ROVII-26", effectiveOn: "2025-10-04", verified: false },
  { region: "VIII", dailyRate: 470, wageOrder: "WO-RB VIII-25", effectiveOn: "2025-12-08", verified: false },
  { region: "IX", dailyRate: 464, wageOrder: "WO-RIX-24", effectiveOn: "2026-01-01", verified: false },
  { region: "X", dailyRate: 500, wageOrder: "WO-RX-24", effectiveOn: "2026-01-16", verified: false },
  { region: "XI", dailyRate: 540, wageOrder: "WO-RB XI-24", effectiveOn: "2026-03-13", verified: false },
  { region: "XII", dailyRate: 460, wageOrder: "WO-RB XII-25", effectiveOn: "2026-03-03", verified: false },
  { region: "XIII", dailyRate: 475, wageOrder: "WO-RXIII-20", effectiveOn: "2026-01-03", verified: false },
  { region: "BARMM", dailyRate: 411, wageOrder: "WO-BARMM-04", effectiveOn: "2025-07-17", verified: false },
];

export function wageOrderFor(region: string) {
  return WAGE_ORDERS.find((row) => row.region === region) ?? WAGE_ORDERS[0];
}

export function isBelowMinimum(monthlyBasic: number, region: string, daysPerMonth = 22) {
  const order = wageOrderFor(region);
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
