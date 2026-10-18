/** A missing, partial or foreign remittance watch is not an all-clear view. */
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

export function isStatutoryRemittanceWatchPayload(
  value: unknown, organizationId: number,
): value is StatutoryRemittanceWatchPayload {
  if (!isId(organizationId) || !isRecord(value) || value.organizationId !== organizationId ||
      !Array.isArray(value.alerts)) return false;
  const ids = new Set<string>();
  for (const alert of value.alerts) {
    if (!isRecord(alert) || typeof alert.id !== "string" || !alert.id.trim() ||
        ids.has(alert.id) || !["danger", "warning", "info"].includes(String(alert.tone)) ||
        typeof alert.title !== "string" || !alert.title.trim() ||
        typeof alert.detail !== "string") return false;
    ids.add(alert.id);
  }
  return true;
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
