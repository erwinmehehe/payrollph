/** Read-only HCM document alert classification. Never changes compliance state. */
export type DocumentRenewalState = "expired" | "expiring" | "overdue" | "missing" | "submitted" | "current" | "waived";

export function classifyDocumentRenewal(input: {
  status: string;
  dueAt: string | null;
  expiresAt: string | null;
  renewalLeadDays: number;
  expiryRequired: boolean;
}, today: string): DocumentRenewalState {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Expected ISO date.");
  if (input.status === "waived") return "waived";
  if (input.expiresAt && input.expiresAt < today) return "expired";
  const lead = Math.max(0, Math.min(365, Math.trunc(input.renewalLeadDays || 0)));
  const next = new Date(today + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + lead);
  const cutoff = next.toISOString().slice(0, 10);
  if (input.expiryRequired && input.expiresAt && input.expiresAt <= cutoff) return "expiring";
  if (input.status === "expired") return "expired";
  if (input.status === "expiring") return "expiring";
  if (input.status === "missing" && input.dueAt && input.dueAt < today) return "overdue";
  if (input.status === "missing") return "missing";
  if (input.status === "submitted") return "submitted";
  return "current";
}

export function documentWatchEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.HCM_DOCUMENT_RENEWAL_WATCH_ENABLED === "true";
}

/** The query API applies these choices before SQL keyset pagination. */
export const DOCUMENT_WATCH_STATES = [
  "all", "overdue", "expired", "expiring", "missing", "submitted", "current", "waived",
] as const;
export type DocumentWatchStateFilter = (typeof DOCUMENT_WATCH_STATES)[number];

export const DOCUMENT_WATCH_EXPIRIES = [
  "all", "past", "next30", "next60", "next90",
] as const;
export type DocumentWatchExpiry = (typeof DOCUMENT_WATCH_EXPIRIES)[number];

export type DocumentWatchRow = {
  id: number;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  orgUnitId: number | null;
  requirementId: number;
  requirementName: string;
  requirementCode: string;
  state: DocumentRenewalState;
  recordedStatus: string;
  dueAt: string | null;
  expiresAt: string | null;
  mandatory: boolean;
  hasAttachment: boolean;
};

/** Tenant-scoped, privacy-minimized, bounded response. Counts are page-only. */
export type DocumentWatchResponse = {
  organizationId: number;
  asOf: string;
  filters: {
    q: string;
    state: DocumentWatchStateFilter;
    expiry: DocumentWatchExpiry;
  };
  items: DocumentWatchRow[];
  page: {
    size: number;
    hasMore: boolean;
    nextCursor: number | null;
  };
  note: string;
};
