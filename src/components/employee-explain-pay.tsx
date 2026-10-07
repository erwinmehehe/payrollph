"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FileSearch, LoaderCircle, ShieldCheck } from "lucide-react";

type ExplainLine = {
  code: string;
  label: string;
  direction: "earning" | "deduction";
  previous: number | null;
  current: number;
  delta: number | null;
  netEffectDelta: number | null;
  reason: string;
  notes: string[];
};

type ExplainPayload = {
  run: {
    id: number;
    periodLabel: string;
    payDate: string;
    ruleVersion: string;
  };
  previousRun: {
    id: number;
    periodLabel: string;
    payDate: string;
    ruleVersion: string;
  } | null;
  explanation: {
    currentGross: number;
    currentDeductions: number;
    currentNet: number;
    previousGross: number | null;
    previousDeductions: number | null;
    previousNet: number | null;
    netDelta: number | null;
    netPercent: number | null;
    ruleVersion: string | null;
    lines: ExplainLine[];
  };
};

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

function signedPeso(value: number) {
  if (Math.abs(value) < 0.005) return "No net change";
  return `${value > 0 ? "+" : "-"}${peso(Math.abs(value))}`;
}

export function EmployeeExplainPay({ entryId, period }: { entryId: number; period: string }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<ExplainPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    if (payload || busy) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/self/payslips/${entryId}/explain`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "We could not explain this payslip.");
        return;
      }
      setPayload(body as ExplainPayload);
    } catch {
      setError("We could not load the explanation because the server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  const explanation = payload?.explanation ?? null;
  const changedLines = explanation?.lines.filter(
    (line) => line.netEffectDelta != null && Math.abs(line.netEffectDelta) >= 0.01,
  ) ?? [];
  const candidateLines = changedLines.length > 0 ? changedLines : explanation?.lines ?? [];
  const visibleLines = showAll ? candidateLines : candidateLines.slice(0, 4);
  const netDelta = explanation?.netDelta ?? null;

  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        className="secondary-button"
        onClick={() => void toggle()}
        aria-expanded={open}
        aria-controls={`employee-pay-explanation-${entryId}`}
      >
        <FileSearch size={14} />
        Why did my pay change?
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div
          id={`employee-pay-explanation-${entryId}`}
          className="trace-box"
          style={{ marginTop: 10, display: "grid", gap: 12 }}
        >
          {busy && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <LoaderCircle size={15} className="i-blue" />
              <span>Comparing this payslip with your previous released pay...</span>
            </div>
          )}

          {error && <div className="notice notice-amber"><span>{error}</span></div>}

          {payload && explanation && (
            <>
              <div>
                <div className="card-kicker">EXPLAIN MY PAY</div>
                <strong style={{ display: "block", marginTop: 4 }}>{period}</strong>
                <p style={{ margin: "5px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
                  This uses the stored payroll calculation and compares it with your previous released cutoff. It does not recalculate your pay in the browser.
                </p>
              </div>

              {payload.previousRun ? (
                <div className={netDelta === 0 ? "notice notice-green" : "notice notice-blue"}>
                  <ShieldCheck size={14} />
                  <span>
                    {netDelta == null
                      ? "Your previous released pay is available, but no net-pay comparison was produced."
                      : netDelta === 0
                        ? `Your net pay is unchanged from ${payload.previousRun.periodLabel}.`
                        : `Your net pay is ${peso(Math.abs(netDelta))} ${netDelta > 0 ? "higher" : "lower"} than ${payload.previousRun.periodLabel}.`}
                  </span>
                </div>
              ) : (
                <div className="notice notice-blue">
                  <ShieldCheck size={14} />
                  <span>This is the first released payroll in your available history, so there is no earlier cutoff to compare yet.</span>
                </div>
              )}

              <div className="employee-pay-totals">
                <div>
                  <span>Current net</span>
                  <strong>{peso(explanation.currentNet)}</strong>
                </div>
                <div>
                  <span>Previous net</span>
                  <strong>{explanation.previousNet == null ? "No prior pay" : peso(explanation.previousNet)}</strong>
                </div>
                <div>
                  <span>Net change</span>
                  <strong>{netDelta == null ? "Not available" : signedPeso(netDelta)}</strong>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {visibleLines.map((line) => (
                  <div
                    key={`${line.code}-${line.label}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      gap: 12,
                      padding: "10px 0",
                      borderTop: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: "block" }}>{line.label}</strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                        {line.previous == null
                          ? `Current: ${peso(line.current)}`
                          : `${peso(line.previous)} → ${peso(line.current)}`}
                      </small>
                      <p style={{ margin: "5px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
                        {line.reason}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong className={(line.netEffectDelta ?? 0) < 0 ? "red-number" : (line.netEffectDelta ?? 0) > 0 ? "green-number" : ""}>
                        {line.netEffectDelta == null ? "Current pay" : signedPeso(line.netEffectDelta)}
                      </strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                        {line.netEffectDelta == null ? line.code : "effect on net"}
                      </small>
                    </div>
                  </div>
                ))}
              </div>

              {candidateLines.length > 4 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowAll((current) => !current)}
                  style={{ justifySelf: "start" }}
                >
                  {showAll ? "Show main changes" : `Show all ${candidateLines.length} pay components`}
                </button>
              )}

              <div className="employee-rule-note">
                <ShieldCheck size={12} /> Explanation from stored payroll data · rule version {payload.run.ruleVersion}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
