/**
 * Verify the full same-employer statutory snapshot and its calculated alerts.
 * An unverified partial response must never be presented as compliant.
 */
import { buildStatutoryRemittanceAlerts } from "./statutory-remittance-alerts";
import { isVerifiedRemittanceSnapshot } from "./statutory-remittance-snapshot-read";

export type StatutoryRemittanceAlert = {
  id: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
};
export type StatutoryRemittanceWatchPayload = {
  organizationId: number;
  alerts: StatutoryRemittanceAlert[];
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const isId = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);

export function isStatutoryRemittanceWatchPayload(
  value: unknown, organizationId: number,
): value is StatutoryRemittanceWatchPayload {
  if (!isId(organizationId) || !isRecord(value) || !isDate(value.today) ||
      !isVerifiedRemittanceSnapshot(value, organizationId, null)) return false;

  // The server supplies these independently derived integrity indicators for
  // every batch. Their absence may suppress payment/proof alerts.
  for (const batch of value.batches) {
    if (!isDate(batch.dueDate) ||
        typeof batch.paymentShortfall !== "number" ||
        !Number.isFinite(batch.paymentShortfall) || batch.paymentShortfall < 0 ||
        typeof batch.hasActivePaymentProof !== "boolean") return false;
  }
  for (const gap of value.coverageGaps) {
    if (gap.dueDate !== null && !isDate(gap.dueDate)) return false;
  }

  const ids = new Set<string>();
  for (const alert of value.alerts) {
    if (!isRecord(alert) || typeof alert.id !== "string" || !alert.id.trim() ||
        ids.has(alert.id) || !["danger", "warning", "info"].includes(String(alert.tone)) ||
        typeof alert.title !== "string" || !alert.title.trim() ||
        typeof alert.detail !== "string") return false;
    ids.add(alert.id);
  }

  // A syntactically valid alerts: [] is NOT evidence of an all-clear when the
  // very same response contains an overdue liability or uncovered month.
  // Recompute using the validated server snapshot, not the supplied alerts.
  const expected = buildStatutoryRemittanceAlerts({
    today: value.today,
    batches: value.batches.map((batch) => ({
      id: batch.id as number,
      agency: batch.agency as string,
      applicableMonth: batch.applicableMonth as string,
      dueDate: batch.dueDate as string,
      status: batch.status as string,
      pendingPostingCount: batch.pendingPostingCount as number,
      exceptionCount: batch.exceptionCount as number,
      paymentShortfall: batch.paymentShortfall as number,
      hasActivePaymentProof: batch.hasActivePaymentProof as boolean,
      filingCheck: batch.filingCheck as Parameters<typeof buildStatutoryRemittanceAlerts>[0]["batches"][number]["filingCheck"],
    })),
    coverageGaps: value.coverageGaps.map((gap) => ({
      agency: gap.agency as string,
      applicableMonth: gap.applicableMonth as string,
      dueDate: gap.dueDate as string | null,
    })),
  });
  if (expected.length !== value.alerts.length) return false;
  return expected.every((alert, i) => {
    const actual = value.alerts[i];
    return isRecord(actual) && actual.id === alert.id &&
      actual.tone === alert.tone && actual.title === alert.title &&
      actual.detail === alert.detail && actual.agency === alert.agency &&
      actual.applicableMonth === alert.applicableMonth && actual.dueDate === alert.dueDate;
  });
}

/** Read response transport and tenant envelope before showing a success status. */
export async function readVerifiedStatutoryRemittanceAlerts(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<StatutoryRemittanceAlert[]> {
  const response = await fetcher(
    `/api/compliance/statutory-remittances?organizationId=${organizationId}`,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw new Error("Statutory remittance status could not be checked.");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Statutory remittance status returned invalid JSON.");
  }
  if (!isStatutoryRemittanceWatchPayload(body, organizationId)) {
    throw new Error("Statutory remittance status could not be verified for the selected employer.");
  }
  return body.alerts;
}
