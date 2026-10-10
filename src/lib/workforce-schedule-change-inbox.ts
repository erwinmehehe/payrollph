/** Read-only attention derived from authenticated current schedule receipts. */
export type InboxNotice = { date: string; kind: "changed" | "review"; title: string };
export type InboxState = { today: string; notices: InboxNotice[]; acknowledged: number; unavailable: number };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{64}$/;
export function manilaInboxToday(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid clock");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function offset(date: string, n: number): string {
  if (!ISO.test(date)) throw new Error("Invalid date");
  const d = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new Error("Invalid calendar date");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function scheduleChangeInbox(raw: unknown, today: string): InboxState {
  const expected = offset(today, 0);
  if (!raw || typeof raw !== "object" || !("days" in raw) || !Array.isArray(raw.days) || raw.days.length !== 7)
    throw new Error("Incomplete schedule evidence");
  const notices: InboxNotice[] = [];
  let acknowledged = 0, unavailable = 0;
  for (const [i, x] of raw.days.entries()) {
    if (!x || typeof x !== "object" || x.date !== offset(expected, i))
      throw new Error("Outdated or malformed schedule evidence");
    switch (x.state) {
      case "acknowledged": acknowledged++; break;
      case "unavailable": unavailable++; break;
      case "pending":
      case "changed":
        if (typeof x.snapshotHash !== "string" || !HASH.test(x.snapshotHash))
          throw new Error("Missing current schedule version");
        notices.push({ date: x.date, kind: x.state === "changed" ? "changed" : "review",
          title: x.state === "changed" ? "Schedule changed since acknowledgment" : "Schedule available to review" });
        break;
      default: throw new Error("Unknown receipt state");
    }
  }
  return { today: expected, notices, acknowledged, unavailable };
}
export function managerAttentionDates(days: readonly { date: string; state: string }[]): string[] {
  if (days.length !== 7 || new Set(days.map(d => d.date)).size !== 7) throw new Error("Invalid manager week");
  for (const d of days) if (!ISO.test(d.date) || !["pending", "changed", "acknowledged", "unavailable"].includes(d.state))
    throw new Error("Invalid manager status");
  return days.filter(d => d.state === "pending" || d.state === "changed").map(d => d.date);
}
