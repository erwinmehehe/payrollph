"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarCheck2,
  CheckCircle2,
  FileCheck2,
  Landmark,
  RefreshCcw,
  ShieldAlert,
  WalletCards,
} from "lucide-react";
import type { Notify } from "@/components/workspace/types";
import { Status } from "@/components/workspace/ui";

type State = {
  applicableMonth: string;
  evaluation: {
    ready: boolean;
    blockers: string[];
    snapshotHash: string;
    runCount: number;
    evidence: {
      runs: Array<{
        id: number;
        periodLabel: string;
        payDate: string;
        status: string;
        payoutCompleted: boolean;
        payoutReference: string | null;
        journalExported: boolean;
        closeCompleted: boolean;
        closeActor: string | null;
      }>;
      bir1601c: {
        proven: boolean;
        agencyReference: string | null;
        submittedAt: string | null;
      };
      remittance: {
        certificationValid: boolean;
        snapshotHash: string | null;
        certifiedByName: string | null;
        certifiedAt: string | null;
        blockerCount: number;
      };
      inspection: {
        highFindingCount: number;
        findingKeys: string[];
        recordedExposure: number;
        screeningExposure: number;
      };
    };
  };
  certificationValid: boolean;
  closure: {
    id: number;
    certifiedByName: string;
    certifiedAt: string;
    snapshotHash: string;
  } | null;
  certificationHistory: Array<{
    id: number;
    certifiedByName: string;
    certifiedAt: string;
    snapshotHash: string;
  }>;
  evidenceActors: string[];
  canCertifyRole: boolean;
};

function previousManilaMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function PayrollMonthClosePanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const maxMonth = useMemo(() => previousManilaMonth(), []);
  const [month, setMonth] = useState(maxMonth);
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [certifying, setCertifying] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/compliance/payroll-month-close?organizationId=${organizationId}&applicableMonth=${month}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Payroll month close could not be loaded.");
      setState(body);
    } catch (loadError) {
      setState(null);
      setError(loadError instanceof Error ? loadError.message : "Payroll month close could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [month, organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function certify() {
    setCertifying(true);
    try {
      const response = await fetch("/api/compliance/payroll-month-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, applicableMonth: month }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blockers = Array.isArray(body.blockers) ? body.blockers.join(" · ") : "";
        throw new Error([body.error, blockers].filter(Boolean).join(" "));
      }
      notify(`${month} payroll month independently certified.`, "ok");
      await load();
    } catch (certifyError) {
      notify(
        certifyError instanceof Error ? certifyError.message : "Payroll month certification failed.",
        "err",
      );
    } finally {
      setCertifying(false);
    }
  }

  const evidence = state?.evaluation.evidence;

  return (
    <article className="card" data-payroll-month-close style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">PAYROLL MONTH CLOSE</div>
          <h2>One certificate for the month, backed by every underlying control.</h2>
          <p>
            Independent month-end certification ties released payrolls, settled payouts, accounting close, BIR 1601-C,
            mandatory contribution certification and payroll-linked inspection findings to one immutable evidence hash.
          </p>
        </div>
        <div className="heading-actions">
          <input
            type="month"
            value={month}
            max={maxMonth}
            onChange={(event) => setMonth(event.target.value)}
            aria-label="Payroll month"
          />
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={14} /> {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-red" style={{ margin: 0 }}>
            <ShieldAlert size={15} />
            <span>{error}</span>
          </div>
        </div>
      ) : state && evidence ? (
        <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
          {state.certificationValid ? (
            <div className="notice notice-green" style={{ margin: 0 }}>
              <BadgeCheck size={15} />
              <span>
                <strong>Certified and current.</strong> {state.closure?.certifiedByName} independently certified this exact evidence snapshot.
              </span>
            </div>
          ) : state.closure ? (
            <div className="notice notice-red" style={{ margin: 0 }}>
              <ShieldAlert size={15} />
              <span>
                <strong>Previous certification is stale.</strong> Evidence changed after the prior certification. The historical certificate remains preserved, but this month must be certified again.
              </span>
            </div>
          ) : null}

          <div className="run-stats" style={{ margin: 0 }}>
            <div>
              <span>Payroll runs</span>
              <strong>{state.evaluation.runCount}</strong>
              <small>{evidence.runs.every((run) => run.status === "Released") ? "all released" : "release still incomplete"}</small>
            </div>
            <div>
              <span>BIR 1601-C</span>
              <strong>{evidence.bir1601c.proven ? "Proven" : "Missing"}</strong>
              <small>{evidence.bir1601c.agencyReference ?? "agency acknowledgement required"}</small>
            </div>
            <div>
              <span>Remittance close</span>
              <strong>{evidence.remittance.certificationValid ? "Certified" : "Not current"}</strong>
              <small>{evidence.remittance.certifiedByName ? `reviewed by ${evidence.remittance.certifiedByName}` : "independent certification required"}</small>
            </div>
            <div>
              <span>High inspection findings</span>
              <strong className={evidence.inspection.highFindingCount ? "red-number" : "green-number"}>
                {evidence.inspection.highFindingCount}
              </strong>
              <small>linked to this pay month</small>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {evidence.runs.map((run) => {
              const complete = run.status === "Released" && run.payoutCompleted && run.journalExported && run.closeCompleted;
              return (
                <section className="leave-request" key={run.id} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <strong>{run.periodLabel}</strong>
                      <p style={{ margin: "3px 0 0" }}>Pay date {run.payDate} · payroll #{run.id}</p>
                    </div>
                    <Status value={complete ? "Closed" : "Needs attention"} />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="status">{run.status === "Released" ? "Released" : run.status}</span>
                    <span className="status">{run.payoutCompleted ? "Payout settled" : "Payout open"}</span>
                    <span className="status">{run.journalExported ? "Journal exported" : "Journal missing"}</span>
                    <span className="status">{run.closeCompleted ? "Accounting close done" : "Accounting close open"}</span>
                  </div>
                </section>
              );
            })}
          </div>

          <div className="module-grid three">
            <article className="card compliance-tile">
              <div className="inline-icon amber"><FileCheck2 size={18} /></div>
              <span>BIR MONTHLY RETURN</span>
              <h2>{evidence.bir1601c.proven ? "Acknowledged" : "Evidence required"}</h2>
              <p>{evidence.bir1601c.proven ? "Current-version 1601-C operational acknowledgement is tied to this pay month." : "A generated worksheet is not filing proof. Record BIR's acknowledgement in Exports."}</p>
            </article>
            <article className="card compliance-tile">
              <div className="inline-icon purple"><Landmark size={18} /></div>
              <span>MANDATORY CONTRIBUTIONS</span>
              <h2>{evidence.remittance.certificationValid ? "Independently certified" : "Certification required"}</h2>
              <p>{evidence.remittance.certificationValid ? "The current SSS, PhilHealth and Pag-IBIG evidence snapshot is independently certified." : "Reconcile employee posting and certify the live remittance snapshot first."}</p>
            </article>
            <article className="card compliance-tile">
              <div className="inline-icon mint"><WalletCards size={18} /></div>
              <span>MONTH CLOSE</span>
              <h2>{state.evaluation.ready ? "Ready" : "Blocked"}</h2>
              <p>{state.evaluation.ready ? "Every evidence gate required by this month-close control is current." : `${state.evaluation.blockers.length} blocker(s) remain.`}</p>
            </article>
          </div>

          {!state.evaluation.ready && (
            <div className="notice notice-amber" style={{ margin: 0 }}>
              <ShieldAlert size={15} />
              <span><strong>Cannot certify yet.</strong> {state.evaluation.blockers.slice(0, 7).join(" · ")}</span>
            </div>
          )}

          {state.evaluation.ready && !state.certificationValid && (
            <div className="notice notice-blue" style={{ margin: 0 }}>
              <CalendarCheck2 size={15} />
              <span>
                <strong>Independent reviewer required.</strong> The certifier must not be one of the evidence actors for payout, journal, cutoff close, BIR acknowledgement or remittance certification.
                {state.evidenceActors.length ? ` Current evidence actors: ${state.evidenceActors.join(", ")}.` : ""}
              </span>
            </div>
          )}

          {state.evaluation.ready && !state.certificationValid && state.canCertifyRole && (
            <div className="run-actions">
              <button className="primary-button brand" onClick={() => void certify()} disabled={certifying}>
                <BadgeCheck size={14} /> {certifying ? "Certifying…" : "Certify payroll month"}
              </button>
            </div>
          )}

          {(state.certificationHistory?.length ?? 0) > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
                Certification history ({state.certificationHistory.length})
              </summary>
              <div className="policy-lines" style={{ marginTop: 8 }}>
                {state.certificationHistory.slice(0, 8).map((item) => (
                  <span key={item.id}>
                    <b>{item.certifiedByName}</b>
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      {new Date(item.certifiedAt).toLocaleString("en-PH")} · snapshot {item.snapshotHash.slice(0, 12)}…
                    </small>
                  </span>
                ))}
              </div>
            </details>
          )}

          <div className="notice" style={{ margin: 0 }}>
            <CheckCircle2 size={14} />
            <span>
              A PayrollPH month-close certificate is an internal evidence control. It does not replace BIR, SSS, PhilHealth, Pag-IBIG or DOLE acknowledgements and is not a government certification.
            </span>
          </div>
        </div>
      ) : (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p style={{ color: "var(--muted)", fontSize: 12 }}>Loading month-close evidence…</p>
        </div>
      )}
    </article>
  );
}
