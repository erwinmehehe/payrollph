"use client";

import { useEffect, useState } from "react";
import { readVerifiedSelfExplainPay, type SelfExplainPayPayload as ExplainPayload } from "@/lib/self-explain-pay-read";
import { essText, type EssLanguage } from "@/lib/ess-language";
import { ChevronDown, ChevronUp, FileSearch, LoaderCircle, ShieldCheck } from "lucide-react";

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

function signedPeso(value: number, language: EssLanguage) {
  if (Math.abs(value) < 0.005) return essText(language, "No net change");
  return `${value > 0 ? "+" : "-"}${peso(Math.abs(value))}`;
}

export function EmployeeExplainPay({
  entryId, period, organizationId, employeeId, language = "en",
}: {
  entryId: number; period: string; organizationId: number; employeeId: number; language?: EssLanguage;
}) {
  const t = (label: string) => essText(language, label);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [observation, setObservation] = useState<{
    scope: string; payload: ExplainPayload | null; error: string; loading: boolean;
  } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const scope = JSON.stringify([organizationId, employeeId, entryId, period, revision]);
  const current = observation?.scope === scope ? observation : null;
  const payload = current?.payload ?? null;
  const error = current?.error ?? "";
  const busy = open && (!current || current.loading);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const observedScope = scope;
    setObservation({ scope: observedScope, payload: null, error: "", loading: true });
    void readVerifiedSelfExplainPay({ organizationId, employeeId, entryId, periodLabel: period },
      fetch, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) setObservation({
          scope: observedScope, payload: value, error: "", loading: false,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setObservation({
          scope: observedScope, payload: null, error: t("We could not verify this payslip explanation. Retry."), loading: false,
        });
      });
    return () => controller.abort();
  // Language changes only affect the next error message, not the identity-bound request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, organizationId, employeeId, entryId, period]);

  function toggle() {
    setOpen(value => !value);
    setShowAll(false);
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
        {t("Why did my pay change?")}
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
              <span>{t("Comparing this payslip with your previous released pay...")}</span>
            </div>
          )}

          {error && (
            <div className="notice notice-amber">
              <span>{error}</span>
              <button className="secondary-button" type="button" onClick={() => setRevision(value => value + 1)}>Retry explanation</button>
            </div>
          )}

          {payload && explanation && (
            <>
              <div>
                <div className="card-kicker">{t("EXPLAIN MY PAY")}</div>
                <strong style={{ display: "block", marginTop: 4 }}>{period}</strong>
                <p style={{ margin: "5px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
                  {t("This uses the stored payroll calculation and compares it with your previous released cutoff. It does not recalculate your pay in the browser.")}
                </p>
              </div>

              {payload.previousRun ? (
                <div className={netDelta === 0 ? "notice notice-green" : "notice notice-blue"}>
                  <ShieldCheck size={14} />
                  <span>
                    {netDelta == null
                      ? t("Your previous released pay is available, but no net-pay comparison was produced.")
                      : netDelta === 0
                        ? `${t("Your net pay is unchanged from")} ${payload.previousRun.periodLabel}.`
                        : `${t("Your net pay is")} ${peso(Math.abs(netDelta))} ${t(netDelta > 0 ? "higher" : "lower")} ${t("than")} ${payload.previousRun.periodLabel}.`}
                  </span>
                </div>
              ) : (
                <div className="notice notice-blue">
                  <ShieldCheck size={14} />
                  <span>{t("This is the first released payroll in your available history, so there is no earlier cutoff to compare yet.")}</span>
                </div>
              )}

              <div className="employee-pay-totals">
                <div>
                  <span>{t("Current net")}</span>
                  <strong>{peso(explanation.currentNet)}</strong>
                </div>
                <div>
                  <span>{t("Previous net")}</span>
                  <strong>{explanation.previousNet == null ? t("No prior pay") : peso(explanation.previousNet)}</strong>
                </div>
                <div>
                  <span>{t("Net change")}</span>
                  <strong>{netDelta == null ? t("Not available") : signedPeso(netDelta, language)}</strong>
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
                          ? `${t("Current:")} ${peso(line.current)}`
                          : `${peso(line.previous)} → ${peso(line.current)}`}
                      </small>
                      <p style={{ margin: "5px 0 0", color: "var(--muted)", lineHeight: 1.45 }}>
                        {line.reason}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong className={(line.netEffectDelta ?? 0) < 0 ? "red-number" : (line.netEffectDelta ?? 0) > 0 ? "green-number" : ""}>
                        {line.netEffectDelta == null ? t("Current pay") : signedPeso(line.netEffectDelta, language)}
                      </strong>
                      <small style={{ display: "block", color: "var(--muted)", marginTop: 2 }}>
                        {line.netEffectDelta == null ? line.code : t("effect on net")}
                      </small>
                    </div>
                  </div>
                ))}
              </div>

              {candidateLines.length === 0 && (
                <div className="notice notice-blue">{t("No itemized pay components were recorded for this comparison.")}</div>
              )}
              {candidateLines.length > 4 && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowAll((current) => !current)}
                  style={{ justifySelf: "start" }}
                >
                  {showAll ? t("Show main changes") : `${t("Show all")} ${candidateLines.length} ${t("pay components")}`}
                </button>
              )}

              <div className="employee-rule-note">
                <ShieldCheck size={12} /> {t("Explanation from stored payroll data · rule version")} {payload.run.ruleVersion}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
