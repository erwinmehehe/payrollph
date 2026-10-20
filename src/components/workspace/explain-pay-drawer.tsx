"use client";

import { useEffect, useMemo, useState } from "react";
import { parseExplainPayRead, type ExplainPayload } from "@/lib/explain-pay-read";
import { ArrowDownRight, ArrowUpRight, FileSearch, X } from "lucide-react";
import { money } from "./ui";

export function ExplainPayDrawer({
  organizationId,
  legalEntityId,
  runId,
  employeeId,
  employeeName,
  onClose,
}: {
  organizationId: number;
  legalEntityId: number | null;
  runId: number;
  employeeId: number;
  employeeName: string;
  onClose: () => void;
}) {
  const [observed, setObserved] = useState<{
    scope: object;
    payload: ExplainPayload | null;
    error: string;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  // Observation identity changes immediately on employer/run/employee/retry.
  const scope = useMemo(() => ({
    organizationId, legalEntityId, runId, employeeId, revision,
  }), [organizationId, legalEntityId, runId, employeeId, revision]);
  const currentRead = observed?.scope === scope ? observed : null;
  const payload = currentRead?.payload ?? null;
  const error = currentRead?.error ?? "";

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/payroll-runs/" + runId + "/explain/" + employeeId, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error("Could not load the selected payroll explanation.");
        const verified = parseExplainPayRead(body, { organizationId, legalEntityId, runId, employeeId });
        if (!verified) throw new Error("Payroll explanation was incomplete or did not belong to the selected employer, run and employee.");
        setObserved({ scope, payload: verified, error: "" });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setObserved({
          scope, payload: null,
          error: cause instanceof Error ? cause.message : "Could not verify the selected payroll explanation.",
        });
      }
    })();
    return () => controller.abort();
  }, [scope, organizationId, legalEntityId, runId, employeeId]);

  const explanation = payload?.explanation;
  const changePositive = Number(explanation?.netDelta ?? 0) >= 0;

  return (
    <div className="modal-backdrop linaw-dialog" role="dialog" aria-modal="true" aria-label="Explain this pay">
      <div className="modal" style={{ width: "min(920px, calc(100vw - 28px))", maxHeight: "88vh", overflow: "auto" }}>
        <button className="modal-close" onClick={onClose} aria-label="Close explanation"><X size={16} /></button>
        <div className="modal-icon"><FileSearch size={18} className="i-purple" /></div>
        <div className="card-kicker">EXPLAIN THIS PAY</div>
        <h2 style={{ marginTop: 6 }}>{employeeName}</h2>
        <p style={{ marginTop: 6 }}>
          Stored payroll components and the exact changes from the previous released cutoff. Nothing here is re-calculated in the browser.
        </p>

        {error && <div className="notice notice-amber" role="alert" style={{ marginTop: 14 }}>
          <span>{error} No pay explanation is shown until a verified reread succeeds.</span>
          <button type="button" className="secondary-button" onClick={() => setRevision((value) => value + 1)}>Retry explanation</button>
        </div>}
        {!error && !payload && <p style={{ color: "var(--muted)", marginTop: 18 }}>Loading payroll explanation…</p>}

        {explanation && (
          <>
            <div className="run-stats" style={{ margin: "16px 0" }}>
              <div><span>Gross</span><strong>{money(explanation.currentGross)}</strong><small>{payload?.run.periodLabel}</small></div>
              <div><span>Deductions</span><strong className="red-number">{money(explanation.currentDeductions)}</strong><small>stored deductions</small></div>
              <div>
                <span>Net pay</span>
                <strong className="green-number">{money(explanation.currentNet)}</strong>
                <small>
                  {explanation.netDelta == null
                    ? "No previous released payroll"
                    : `${changePositive ? "+" : ""}${money(explanation.netDelta)} vs previous`}
                </small>
              </div>
            </div>

            {explanation.netDelta != null && (
              <div className={`notice ${changePositive ? "notice-green" : "notice-amber"}`} style={{ margin: "0 0 14px" }}>
                {changePositive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                <span>
                  Net pay is <strong>{money(Math.abs(explanation.netDelta))} {changePositive ? "higher" : "lower"}</strong>
                  {explanation.netPercent == null ? "" : ` (${Math.abs(explanation.netPercent).toFixed(1)}%)`}
                  {payload.previousRun ? ` than ${payload.previousRun.periodLabel}` : ""}.
                </span>
              </div>
            )}

            <div className="line-title" style={{ margin: "10px 0 0" }}>
              <strong>What changed</strong>
              <span>Largest net-pay effects first</span>
            </div>

            <div className="audit-list">
              {explanation.lines.map((line) => {
                const effect = line.netEffectDelta;
                return (
                  <div className="audit-row" key={`${line.code}-${line.label}`} style={{ cursor: "default" }}>
                    <span className="audit-dot"><FileSearch size={13} className="i-purple" /></span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{line.label}</strong>
                      <p>{line.reason}</p>
                      <small style={{ color: "var(--muted)" }}>
                        {line.previous == null ? "No prior value" : `${money(line.previous)} → ${money(line.current)}`}
                      </small>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong className={effect != null && effect < 0 ? "red-number" : "green-number"}>
                        {effect == null ? money(line.current) : `${effect > 0 ? "+" : ""}${money(effect)}`}
                      </strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>{line.code}</small>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="trace-box" style={{ marginTop: 14 }}>
              <p>Calculation context · {explanation.ruleVersion ?? "stored ruleset"}</p>
              {Object.entries(explanation.context)
                .filter(([, value]) => value != null)
                .map(([key, value]) => (
                  <span className="trace-line" key={key}><span className="k">{key}</span> = <span className="v">{String(value)}</span></span>
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
