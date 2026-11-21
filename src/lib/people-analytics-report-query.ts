/** Stable, read-only query contract shared by People Analytics JSON and CSV. */
export type PeopleAnalyticsWindow = 30 | 90 | 180 | 365;

export function peopleAnalyticsReportQuery(
  organizationId: number,
  windowDays: PeopleAnalyticsWindow,
  asOf = "",
  format: "json" | "csv" = "json",
): URLSearchParams {
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    throw new Error("A valid selected employer is required.");
  }
  if (![30, 90, 180, 365].includes(windowDays)) {
    throw new Error("Unsupported People Analytics reporting window.");
  }
  if (asOf) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(asOf)
      ? new Date(asOf + "T00:00:00Z") : new Date(NaN);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== asOf) {
      throw new Error("The reporting date is invalid.");
    }
  }
  if (format !== "json" && format !== "csv") {
    throw new Error("Unsupported report format.");
  }
  const query = new URLSearchParams({
    organizationId: String(organizationId), key: "people",
    windowDays: String(windowDays),
  });
  if (asOf) query.set("asOf", asOf);
  if (format === "csv") query.set("format", "csv");
  return query;
}

/**
 * Reject a response from the wrong reporting window/date even if its general
 * payload shape is valid. A blank date means the server owns the Manila-day
 * default; the returned verified date must then be pinned for CSV export.
 */
export function assertPeopleAnalyticsSnapshot(
  snapshot: { asOf: string; windowDays: number },
  requestedWindowDays: PeopleAnalyticsWindow,
  requestedAsOf: string,
): void {
  if (snapshot.windowDays !== requestedWindowDays ||
      (requestedAsOf !== "" && snapshot.asOf !== requestedAsOf)) {
    throw new Error("People Analytics returned a different reporting period. Refresh before exporting.");
  }
  // A valid source snapshot must carry an actual calendar date, even when the
  // user left the date picker blank. Never invent today's date for a CSV.
  peopleAnalyticsReportQuery(1, requestedWindowDays, snapshot.asOf);
}

/** Same selected employer, activity window and verified as-of date as the JSON. */
export function peopleAnalyticsExportQuery(
  organizationId: number,
  requestedWindowDays: PeopleAnalyticsWindow,
  requestedAsOf: string,
  snapshot: { asOf: string; windowDays: number },
): URLSearchParams {
  assertPeopleAnalyticsSnapshot(snapshot, requestedWindowDays, requestedAsOf);
  return peopleAnalyticsReportQuery(organizationId, requestedWindowDays, snapshot.asOf, "csv");
}
