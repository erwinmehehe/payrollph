/**
 * Conservative Manila-day Web Bundy shift anchoring.
 *
 * An overnight clock-out belongs to the original workDate only when there is
 * one recently started, still-open Web Bundy punch from the previous Manila
 * calendar date. This is not automatic biometric/device reconciliation.
 */
export const WEB_BUNDY_OVERNIGHT_MAX_HOURS = 18;
const MAX_MS = WEB_BUNDY_OVERNIGHT_MAX_HOURS * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export type WebBundyAnchorPunch = {
  workDate: string;
  timeIn: Date | string | null;
  timeOut: Date | string | null;
  source?: string | null;
};

export function previousManilaWorkDate(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Invalid Manila work date.");
  const millis = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== today) {
    throw new Error("Invalid Manila calendar day.");
  }
  return new Date(millis - DAY_MS).toISOString().slice(0, 10);
}

export function eligiblePreviousWebBundyPunch(
  previous: WebBundyAnchorPunch | null,
  today: string,
  now: Date,
): boolean {
  if (!previous || previous.source !== "web_bundy" || previous.timeOut !== null
      || !previous.timeIn || previous.workDate !== previousManilaWorkDate(today)) return false;
  const at = new Date(previous.timeIn).getTime();
  const elapsed = now.getTime() - at;
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= MAX_MS;
}

export function resolveWebBundyPunchAnchor(input: {
  today: string;
  now: Date;
  todayPunch: WebBundyAnchorPunch | null;
  previousPunch: WebBundyAnchorPunch | null;
  action: "clock_in" | "break_start" | "break_end" | "clock_out";
}): { workDate: string; usePrevious: boolean; previousOpenRequiresClose: boolean } {
  const openPrevious = eligiblePreviousWebBundyPunch(input.previousPunch, input.today, input.now);
  if (input.action === "clock_in") {
    return { workDate: input.today, usePrevious: false, previousOpenRequiresClose: openPrevious };
  }
  const usePrevious = !input.todayPunch && openPrevious;
  return {
    workDate: usePrevious ? previousManilaWorkDate(input.today) : input.today,
    usePrevious,
    previousOpenRequiresClose: false,
  };
}
