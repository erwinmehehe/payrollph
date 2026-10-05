"use client";

import { useEffect, useState } from "react";
import { DashboardAlertBanner, type DashboardAlertItem } from "./dashboard-alert-banner";

type Alert = {
  id: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
};

export function StatutoryRemittanceWatch({
  organizationId,
  onOpen,
}: {
  organizationId: number;
  onOpen: () => void;
}) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/compliance/statutory-remittances?organizationId=${organizationId}`, { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok) {
          setFailed(true);
          setAlerts([]);
          return;
        }
        setFailed(false);
        setAlerts(Array.isArray(body.alerts) ? body.alerts : []);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setAlerts([]);
      });
    return () => { active = false; };
  }, [organizationId]);

  if (alerts == null) return null;

  if (failed) {
    return (
      <DashboardAlertBanner
        title="Statutory remittance status could not be checked"
        detail="Open Payroll and refresh the remittance control before assuming the month is compliant."
        items={[{ id: "load-failed", label: "Compliance status unavailable", tone: "warning" }]}
        actionLabel="Open payroll"
        onAction={onOpen}
      />
    );
  }

  if (alerts.length === 0) {
    return (
      <DashboardAlertBanner
        title="Statutory remittances are on track"
        detail="No missing, due-soon, overdue or employee-posting exceptions were found in the tracked months."
        items={[{ id: "clear", label: "SSS, PhilHealth and Pag-IBIG controls are clear", tone: "success" }]}
        actionLabel="View remittances"
        onAction={onOpen}
      />
    );
  }

  const items: DashboardAlertItem[] = alerts.slice(0, 4).map((alert) => ({
    id: alert.id,
    label: `${alert.title}: ${alert.detail}`,
    tone: alert.tone,
  }));

  return (
    <DashboardAlertBanner
      title="Statutory remittances need attention"
      detail="These items can affect whether employee contributions are actually paid and posted to their agency records."
      items={items}
      actionLabel="Resolve remittances"
      onAction={onOpen}
    />
  );
}
