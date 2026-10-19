"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  readVerifiedStatutoryRemittanceAlerts,
  type StatutoryRemittanceAlert,
} from "@/lib/statutory-remittance-watch-payload";

type ReadState =
  | { revision: number; phase: "ready"; alerts: StatutoryRemittanceAlert[] }
  | { revision: number; phase: "unavailable"; message: string };

function toneClass(tone: StatutoryRemittanceAlert["tone"]) {
  if (tone === "danger") return "notice notice-red";
  if (tone === "warning") return "notice notice-amber";
  return "notice";
}

type WatchProps = {
  organizationId: number;
  legalEntityId?: number | null;
  requiresLegalEntitySelection?: boolean;
  onOpen: () => void;
};

export function StatutoryRemittanceWatch(props: WatchProps) {
  // An aggregate multi-entity view is not a verified read of any one employer.
  // Never silently fall back to the primary entity and display its green status.
  if (props.requiresLegalEntitySelection && !props.legalEntityId) {
    return (
      <article className="card" data-statutory-remittance-watch style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">STATUTORY REMITTANCE WATCH</div>
            <h2>Legal employer selection required</h2>
            <p>Select an individual legal employer in the workspace switcher before checking remittance status.</p>
          </div>
        </div>
        <div className="card-body" role="status">No remittance compliance result is available for the combined employer view.</div>
      </article>
    );
  }
  // Remount on employer switch so the old employer's green status cannot flash.
  return <StatutoryRemittanceWatchContent key={`${props.organizationId}:${props.legalEntityId ?? "primary"}`} {...props} />;
}

function StatutoryRemittanceWatchContent({
  organizationId, legalEntityId, onOpen,
}: WatchProps) {
  const [revision, setRevision] = useState(0);
  const [stored, setStored] = useState<ReadState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readVerifiedStatutoryRemittanceAlerts(organizationId, fetch, controller.signal, legalEntityId ?? null)
      .then((alerts) => {
        if (!controller.signal.aborted) setStored({ revision, phase: "ready", alerts });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setStored({
          revision, phase: "unavailable",
          message: cause instanceof Error ? cause.message : "Could not verify remittance status.",
        });
      });
    return () => controller.abort();
  }, [organizationId, legalEntityId, revision]);

  const active = stored?.revision === revision ? stored : null;
  const alerts = active?.phase === "ready" ? active.alerts : null;
  const unavailable = active?.phase === "unavailable";
  const heading = unavailable
    ? "Remittance status could not be verified"
    : alerts === null
      ? "Checking statutory remittance status"
      : alerts.length ? "Statutory remittances need attention" : "Statutory remittances are on track";

  return (
    <article className="card" data-statutory-remittance-watch style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">STATUTORY REMITTANCE WATCH</div>
          <h2>{heading}</h2>
          <p>{unavailable
            ? "No compliance result or action is available until this employer's source read succeeds."
            : alerts === null
              ? "Verifying this employer's saved remittance records…"
              : alerts.length
                ? "These items can affect whether employee contributions are paid and posted to agency records."
                : "No missing, due-soon, overdue or employee-posting exceptions were found in the tracked months."}</p>
        </div>
        {alerts !== null && (
          <button className="secondary-button" type="button" onClick={onOpen}>
            {alerts.length ? <CircleAlert size={14} /> : <ShieldCheck size={14} />}
            {alerts.length ? "Resolve remittances" : "View remittances"}
          </button>
        )}
      </div>
      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 8 }}>
        {unavailable ? (
          <div className="notice notice-amber" role="alert" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span><strong>Compliance status unavailable.</strong> {active?.phase === "unavailable" ? active.message : ""}</span>
            <button className="secondary-button" type="button" onClick={() => setRevision((value) => value + 1)}>
              <RefreshCcw size={14} /> Retry status read
            </button>
          </div>
        ) : alerts === null ? (
          <p role="status">Verifying statutory remittance status…</p>
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
