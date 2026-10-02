"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, XCircle } from "lucide-react";

export type DashboardAlertItem = {
  id: string;
  label: string;
  tone: "warning" | "danger" | "info" | "success";
};

const icons: Record<DashboardAlertItem["tone"], ReactNode> = {
  warning: <AlertTriangle size={14} aria-hidden />,
  danger: <XCircle size={14} aria-hidden />,
  info: <Info size={14} aria-hidden />,
  success: <CheckCircle2 size={14} aria-hidden />,
};

export function DashboardAlertBanner({
  title,
  detail,
  items,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  items: DashboardAlertItem[];
  actionLabel: string;
  onAction: () => void;
}) {
  const needsAttention = items.some((item) => item.tone === "danger" || item.tone === "warning");

  return (
    <section className="dashboard-alert-banner" aria-label={title}>
      <div className="dashboard-alert-symbol" data-tone={needsAttention ? "warning" : "success"} aria-hidden>
        {needsAttention ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
      </div>
      <div className="dashboard-alert-copy">
        <h2>{title}</h2>
        <p>{detail}</p>
        <ul>
          {items.map((item) => (
            <li key={item.id} data-tone={item.tone}>
              <span aria-hidden>{icons[item.tone]}</span>
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </div>
      <button type="button" className="dashboard-alert-action" onClick={onAction}>
        {actionLabel} <ArrowRight size={14} aria-hidden />
      </button>
    </section>
  );
}
