import type { PlanId } from "@/lib/billing-matrix";

export type SellablePlan = Exclude<PlanId, "Solo">;
export type CatalogPrice = { name: string; monthlyBase: string | number; perEmployee: string | number; active: boolean };

const SELLED = new Set<string>(["Core", "Scale", "Enterprise"]);

export function isSellablePlan(value: unknown): value is SellablePlan {
  return typeof value === "string" && SELLED.has(value);
}

export function safeSeats(value: unknown) {
  const seats = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(seats) && seats >= 1 && seats <= 2_000 ? seats : null;
}

export function subscriptionQuote(plan: CatalogPrice, requestedSeats: number) {
  const seats = safeSeats(requestedSeats);
  if (!seats || !isSellablePlan(plan.name) || !plan.active) {
    throw new Error("Choose an active employer plan and 1–2,000 employee seats.");
  }
  const base = Number(plan.monthlyBase);
  const perSeat = Number(plan.perEmployee);
  if (!Number.isFinite(base) || !Number.isFinite(perSeat) || base < 0 || perSeat < 0) {
    throw new Error("The billing catalog is not ready for checkout.");
  }
  const amountCents = Math.round(base * 100) + Math.round(perSeat * 100) * seats;
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) {
    throw new Error("The subscription amount is invalid.");
  }
  return { plan: plan.name, seats, billingCycle: "monthly" as const, currency: "PHP" as const,
    baseCents: Math.round(base * 100), seatCents: Math.round(perSeat * 100),
    amountCents, amountPhp: amountCents / 100 };
}

/** Pure billing period arithmetic, bounded to months with fewer days. */
export function nextBillingMonth(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid billing date.");
  const y = date.getUTCFullYear(), m = date.getUTCMonth(), day = date.getUTCDate();
  const last = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 1, Math.min(day, last),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
}

/** Xendit requires a valid recurring anchor day on or before the 28th. */
export function firstRecurringAnchor(date: Date) {
  const day = Math.min(28, date.getUTCDate());
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  return new Date(Date.UTC(year, month + 1, day, 9, 0, 0)).toISOString();
}

export function paidAccessAllowed(input: { status: string; paidThrough: Date | null; now?: Date }) {
  const now = input.now ?? new Date();
  return ["active", "past_due", "cancel_at_period_end", "cancelled"].includes(input.status)
    && input.paidThrough !== null
    && input.paidThrough.getTime() > now.getTime();
}
