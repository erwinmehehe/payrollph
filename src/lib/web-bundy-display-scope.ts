/** Browser-only, source-scoped attendance display contract.
 * Server authorization and immutable payroll locks remain authoritative.
 */
export type WebBundyPunch = {
  workDate?: string;
  timeIn?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  timeOut?: string | null;
};

export type WebBundyReadState = {
  key: string;
  status: "ready" | "unavailable";
  punches: WebBundyPunch[];
  previousShiftNeedsReview?: boolean;
};

/** The nonce invalidates cached state when the same employee is reselected. */
export function webBundyReadKey(organizationId: number, employeeId: number | null, nonce: number): string {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 ||
      (employeeId !== null && (!Number.isSafeInteger(employeeId) || employeeId <= 0)) ||
      !Number.isSafeInteger(nonce) || nonce < 0) {
    throw Error("Valid employer, employee and revision are required.");
  }
  return `${organizationId}:${employeeId ?? "unselected"}:${nonce}`;
}

/** Never reuse a preceding employee or organization's punch state at render time. */
export function visibleWebBundyState(
  key: string, state: WebBundyReadState | null,
): { status: "loading" | "ready" | "unavailable"; punches: WebBundyPunch[] } {
  if (!state || state.key !== key) return { status: "loading", punches: [] };
  return state;
}

export function isWebBundyPunchList(value: unknown): value is WebBundyPunch[] {
  if (!Array.isArray(value)) return false;
  const fields = ["timeIn", "breakStart", "breakEnd", "timeOut"] as const;
  return value.every((row: unknown) =>
    typeof row === "object" && row !== null &&
    ((row as Record<string, unknown>).workDate === undefined ||
      (typeof (row as Record<string, unknown>).workDate === "string" &&
       /^\d{4}-\d{2}-\d{2}$/.test((row as { workDate: string }).workDate))) &&
    fields.every((field) => {
      const value = (row as Record<string, unknown>)[field];
      return value === undefined || value === null ||
        (typeof value === "string" && Number.isFinite(Date.parse(value)));
    }),
  );
}

/**
 * Clock-out-only exceptions must never be treated as an untouched day. An
 * authorised correction is required before attempting a later clock-in.
 */
export function mayClockInWebBundy(historyReady: boolean, punch?: WebBundyPunch): boolean {
  return historyReady && !punch?.timeIn && !punch?.timeOut;
}
