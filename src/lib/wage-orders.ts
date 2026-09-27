export type WageOrder = {
  region: string;
  dailyRate: number;
  wageOrder: string;
  effectiveOn: string;
};

/**
 * DOLE regional daily minimums used by this build.
 *
 * NCR has been updated to Wage Order NCR-26 (PHP 695, effective 18 July 2025).
 * Other regional rows are the latest values previously configured in this demo;
 * they remain versioned, but should be verified against the relevant RTWPB order
 * before a customer relies on them. The readiness/copy therefore never claims a
 * complete nationally certified wage-order registry.
 *
 * MWE classification is explicit on the employee record; a rate below the
 * configured regional floor is additionally treated as MWE-adjacent for the
 * withholding exemption cascade (OT / holiday / night differential stay untaxed).
 */
export const WAGE_ORDERS: WageOrder[] = [
  { region: "NCR", dailyRate: 695, wageOrder: "WO-NCR-26", effectiveOn: "2025-07-18" },
  { region: "III", dailyRate: 500, wageOrder: "WO-RB-III-24", effectiveOn: "2024-10-01" },
  { region: "IV-A", dailyRate: 550, wageOrder: "WO-RB-IVA-20", effectiveOn: "2024-07-01" },
  { region: "VII", dailyRate: 501, wageOrder: "WO-RO-VII-23", effectiveOn: "2024-10-05" },
  { region: "XI", dailyRate: 456, wageOrder: "WO-XI-21", effectiveOn: "2024-09-16" },
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

export const NATIONAL_HOLIDAYS_2026: Array<{ date: string; name: string; kind: HolidayKind }> = [
  { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
  { date: "2026-04-02", name: "Maundy Thursday", kind: "regular" },
  { date: "2026-04-03", name: "Good Friday", kind: "regular" },
  { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
  { date: "2026-05-01", name: "Labor Day", kind: "regular" },
  { date: "2026-06-12", name: "Independence Day", kind: "regular" },
  { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
  { date: "2026-11-30", name: "Bonifacio Day", kind: "regular" },
  { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
  { date: "2026-12-30", name: "Rizal Day", kind: "regular" },
  { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
  { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
  { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
  { date: "2026-12-31", name: "Last Day of the Year", kind: "special" },
  { date: "2026-03-11", name: "Company special non-working (demo)", kind: "special" },
];

export function holidayOn(date: string) {
  return NATIONAL_HOLIDAYS_2026.find((row) => row.date === date) ?? null;
}
