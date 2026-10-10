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
