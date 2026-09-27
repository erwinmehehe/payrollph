import { round2 } from "@/lib/round";

export type LeavePolicyInput = {
  leaveType: string;
  annualDays: number;
  carryOverMax?: number | null;
  maxBalance?: number | null;
};

export type BalanceResult = {
  leaveType: string;
  annualDays: number;
  accrued: number;
  used: number;
  pending: number;
  opening: number;
  available: number;
  capped: boolean;
};

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function monthlyAccrual(annualDays: number) {
  return annualDays / 12;
}

/**
 * Accrues (annualDays / 12) for every completed month of service, plus a
 * proportional amount for the current in-progress month.
 *
 * During the first calendar month of service the partial is measured from the
 * start date; afterwards it is measured from the 1st of the current month.
 * This is deterministic so balances are reproducible in tests and audits.
 */
export function computeAccrual(annualDays: number, startDate: string, asOf: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const now = new Date(`${asOf}T12:00:00`);
  if (now < start) return 0;

  let monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) monthsElapsed -= 1;
  if (monthsElapsed < 0) monthsElapsed = 0;

  const per = monthlyAccrual(annualDays);
  let ratio: number;
  if (monthsElapsed === 0) {
    const total = daysInMonth(start.getFullYear(), start.getMonth());
    const worked = now.getDate() - start.getDate() + 1;
    ratio = Math.min(1, Math.max(0, worked / total));
    return round2(per * ratio);
  }

  const total = daysInMonth(now.getFullYear(), now.getMonth());
  ratio = Math.min(1, Math.max(0, now.getDate() / total));
  return round2(monthsElapsed * per + per * ratio);
}

/** Available leave: opening carry-over + accrued - approved used - pending requests, floored at zero and capped by policy. */
export function computeBalance(input: {
  policy: LeavePolicyInput;
  startDate: string;
  asOf: string;
  opening?: number;
  used?: number;
  pending?: number;
}): BalanceResult {
  const opening = Number(input.opening ?? 0);
  const used = Number(input.used ?? 0);
  const pending = Number(input.pending ?? 0);
  const accrued = computeAccrual(input.policy.annualDays, input.startDate, input.asOf);

  const raw = Math.max(0, opening + accrued - used - pending);
  const cap = input.policy.maxBalance == null ? null : Number(input.policy.maxBalance);
  const capped = cap != null && raw > cap;
  const available = capped ? round2(cap as number) : round2(raw);

  return {
    leaveType: input.policy.leaveType,
    annualDays: Number(input.policy.annualDays),
    accrued: round2(accrued),
    used: round2(used),
    pending: round2(pending),
    opening: round2(opening),
    available,
    capped,
  };
}

/** Unused days carried into the next year, limited by the policy's carry-over cap. */
export function carryOverDays(available: number, carryOverMax?: number | null) {
  if (carryOverMax == null) return round2(Math.max(0, available));
  return round2(Math.min(Math.max(0, available), Number(carryOverMax)));
}
