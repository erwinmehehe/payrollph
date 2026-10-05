export type RemittanceAlertTone = "danger" | "warning" | "info";

export type RemittanceAlert = {
  id: string;
  tone: RemittanceAlertTone;
  title: string;
  detail: string;
  agency: string;
  applicableMonth: string;
  dueDate: string | null;
};

type BatchSummary = {
  id: number;
  agency: string;
  applicableMonth: string;
  dueDate: string;
  status: string;
  pendingPostingCount: number;
  exceptionCount: number;
};

type CoverageGap = {
  agency: string;
  applicableMonth: string;
  dueDate: string | null;
};

function dayNumber(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function daysUntil(dueDate: string, today: string) {
  return dayNumber(dueDate) - dayNumber(today);
}

export function buildStatutoryRemittanceAlerts(input: {
  today: string;
  batches: BatchSummary[];
  coverageGaps: CoverageGap[];
}) {
  const alerts: RemittanceAlert[] = [];

  for (const gap of input.coverageGaps) {
    const days = gap.dueDate ? daysUntil(gap.dueDate, input.today) : null;
    const overdue = days != null && days < 0;
    const dueSoon = days != null && days <= 7;
    alerts.push({
      id: `missing-${gap.agency}-${gap.applicableMonth}`,
      tone: overdue ? "danger" : dueSoon ? "warning" : "info",
      title: overdue
        ? `${gap.agency} remittance control is missing and overdue`
        : `${gap.agency} remittance control has not been opened`,
      detail: gap.dueDate
        ? overdue
          ? `${gap.applicableMonth} deadline was ${gap.dueDate}. Snapshot the released payroll liability and reconcile payment now.`
          : `${gap.applicableMonth} is due ${gap.dueDate}${days === 0 ? " today" : days === 1 ? " tomorrow" : days != null ? ` in ${days} days` : ""}.`
        : `${gap.applicableMonth} has released payroll but the deadline could not be determined from employer records.`,
      agency: gap.agency,
      applicableMonth: gap.applicableMonth,
      dueDate: gap.dueDate,
    });
  }

  for (const batch of input.batches) {
    if (batch.status === "reconciled") continue;

    if (batch.status === "exception" || batch.exceptionCount > 0) {
      alerts.push({
        id: `exception-${batch.id}`,
        tone: "danger",
        title: `${batch.agency} has employee posting exceptions`,
        detail: `${batch.applicableMonth} has ${batch.exceptionCount} unresolved employee posting exception${batch.exceptionCount === 1 ? "" : "s"}. The month is not reconciled.`,
        agency: batch.agency,
        applicableMonth: batch.applicableMonth,
        dueDate: batch.dueDate,
      });
      continue;
    }

    if (batch.status === "paid" && batch.pendingPostingCount > 0) {
      alerts.push({
        id: `posting-${batch.id}`,
        tone: "warning",
        title: `${batch.agency} payment recorded, member posting still unconfirmed`,
        detail: `${batch.applicableMonth} still has ${batch.pendingPostingCount} employee posting confirmation${batch.pendingPostingCount === 1 ? "" : "s"} outstanding.`,
        agency: batch.agency,
        applicableMonth: batch.applicableMonth,
        dueDate: batch.dueDate,
      });
      continue;
    }

    if (batch.status === "open") {
      const days = daysUntil(batch.dueDate, input.today);
      if (days < 0) {
        alerts.push({
          id: `overdue-${batch.id}`,
          tone: "danger",
          title: `${batch.agency} remittance is overdue`,
          detail: `${batch.applicableMonth} was due ${batch.dueDate}. Payment evidence has not been recorded.`,
          agency: batch.agency,
          applicableMonth: batch.applicableMonth,
          dueDate: batch.dueDate,
        });
      } else if (days <= 7) {
        alerts.push({
          id: `due-${batch.id}`,
          tone: "warning",
          title: `${batch.agency} remittance is due soon`,
          detail: days === 0
            ? `${batch.applicableMonth} is due today.`
            : days === 1
              ? `${batch.applicableMonth} is due tomorrow.`
              : `${batch.applicableMonth} is due in ${days} days on ${batch.dueDate}.`,
          agency: batch.agency,
          applicableMonth: batch.applicableMonth,
          dueDate: batch.dueDate,
        });
      }
    }
  }

  const rank: Record<RemittanceAlertTone, number> = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) =>
    rank[a.tone] - rank[b.tone]
    || String(a.dueDate ?? "9999-99-99").localeCompare(String(b.dueDate ?? "9999-99-99"))
    || a.id.localeCompare(b.id),
  );
}
