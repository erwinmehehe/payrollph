import type { ReactNode } from "react";

export type DashboardStatTone = "blue" | "green" | "amber" | "red" | "slate";

export function DashboardStatCard({
  icon,
  label,
  value,
  hint,
  tone = "blue",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: DashboardStatTone;
}) {
  return (
    <article className="dashboard-stat-card" data-tone={tone}>
      <span className="dashboard-stat-icon" aria-hidden>{icon}</span>
      <div>
        <span className="dashboard-stat-label">{label}</span>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
    </article>
  );
}
