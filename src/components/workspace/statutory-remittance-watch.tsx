"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, ShieldCheck } from "lucide-react";

type Alert = {
  id: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
};

function toneClass(tone: Alert["tone"]) {
  if (tone === "danger") return "notice notice-red";
  if (tone === "warning") return "notice notice-amber";
  return "notice";
}

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

  return (
    <article className="card" data-statutory-remittance-watch style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">STATUTORY REMITTANCE WATCH</div>
          <h2>
            {failed
              ? "Remittance status could not be checked"
              : alerts.length
                ? "Statutory remittances need attention"
                : "Statutory remittances are on track"}
          </h2>
          <p>
            {failed
              ? "Open Payroll and refresh the remittance control before assuming the month is compliant."
              : alerts.length
                ? "These items can affect whether employee contributions are actually paid and posted to agency records."
                : "No missing, due-soon, overdue or employee-posting exceptions were found in the tracked months."}
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpen}>
          {alerts.length || failed ? <CircleAlert size={14} /> : <ShieldCheck size={14} />}
          {alerts.length || failed ? "Resolve remittances" : "View remittances"}
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 8 }}>
        {failed ? (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span><strong>Compliance status unavailable.</strong> Do not treat this as an all-clear state.</span>
          </div>
        ) : alerts.length === 0 ? (
          <div className="notice" style={{ margin: 0 }}>
            <CheckCircle2 size={15} />
            <span><strong>SSS, PhilHealth and Pag-IBIG controls are clear.</strong></span>
          </div>
        ) : (
          alerts.slice(0, 4).map((alert) => (
            <div className={toneClass(alert.tone)} style={{ margin: 0 }} key={alert.id}>
              {alert.tone === "danger" ? <AlertTriangle size={15} /> : <CircleAlert size={15} />}
              <span><strong>{alert.title}.</strong> {alert.detail}</span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}
