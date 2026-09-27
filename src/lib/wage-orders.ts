import { holidayMultiplier } from "@/lib/payroll-rules";

export type WageOrder = { region: string; dailyRate: number; wageOrder: string; effectiveOn: string };

/** Conservative screening floors only — not a complete wage-order rules engine. */
export const WAGE_ORDERS: WageOrder[] = [
  { region: "NCR", dailyRate: 718, wageOrder: "NCR current screening floor (see NWPC current-order notes)", effectiveOn: "2026-07-25" },
  { region: "III", dailyRate: 515, wageOrder: "WO-RBIII-26 (screening floor)", effectiveOn: "2026-04-16" },
  { region: "IV-A", dailyRate: 508, wageOrder: "WO-IVA-22 (screening floor)", effectiveOn: "2026-04-01" },
  { region: "VII", dailyRate: 500, wageOrder: "WO-ROVII-26 (screening floor)", effectiveOn: "2025-10-04" },
  { region: "XI", dailyRate: 525, wageOrder: "WO-RB-XI-24 (screening floor)", effectiveOn: "2026-09-01" },
];

export function wageOrderFor(region: string) { return WAGE_ORDERS.find((row) => row.region === region) ?? WAGE_ORDERS[0]; }
export function isBelowMinimum(monthlyBasic: number, region: string, annualPayDivisor = 365) {
  const order = wageOrderFor(region); const divisor = Number.isFinite(annualPayDivisor) && annualPayDivisor > 0 ? annualPayDivisor : 365;
  const impliedDaily = Math.round(((monthlyBasic * 12 / divisor) + Number.EPSILON) * 100) / 100;
  return { below: impliedDaily < order.dailyRate, impliedDaily, order };
}

export type Holiday = { date: string; name: string; kind: "regular" | "special" };
export const HOLIDAYS_2026: Holiday[] = [
  { date: "2026-01-01", name: "New Year's Day", kind: "regular" },
  { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
  { date: "2026-03-20", name: "Eid'l Fitr", kind: "regular" },
  { date: "2026-04-02", name: "Maundy Thursday", kind: "regular" },
  { date: "2026-04-03", name: "Good Friday", kind: "regular" },
  { date: "2026-04-04", name: "Black Saturday", kind: "special" },
  { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "regular" },
  { date: "2026-05-01", name: "Labor Day", kind: "regular" },
  { date: "2026-05-27", name: "Eid'l Adha", kind: "regular" },
  { date: "2026-06-12", name: "Independence Day", kind: "regular" },
  { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
  { date: "2026-08-31", name: "National Heroes Day", kind: "regular" },
  { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
  { date: "2026-11-02", name: "All Souls' Day", kind: "special" },
  { date: "2026-11-30", name: "Bonifacio Day", kind: "regular" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
  { date: "2026-12-24", name: "Christmas Eve", kind: "special" },
  { date: "2026-12-25", name: "Christmas Day", kind: "regular" },
  { date: "2026-12-30", name: "Rizal Day", kind: "regular" },
  { date: "2026-12-31", name: "Last Day of the Year", kind: "special" },
];
export function holidayOn(date: string) { return HOLIDAYS_2026.find((row) => row.date === date) ?? null; }
export { holidayMultiplier };
