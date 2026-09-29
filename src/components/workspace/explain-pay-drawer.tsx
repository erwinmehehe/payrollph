"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CircleDollarSign, X } from "lucide-react";
import type { Employee } from "@/components/workspace/types";
import type { ExplainPayModel } from "@/lib/payroll-explain";
import { moneyExact } from "@/components/workspace/ui";
import styles from "./explain-pay-drawer.module.css";

type ExplainPayPayload = {
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
  explanation: ExplainPayModel;
};

export function ExplainPayDrawer({
  runId,
  employee,
  onClose,
}: {
  runId: number;
  employee: Employee;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<ExplainPayPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    setPayload(null);

    void fetch(`/api/payroll-runs/${runId}/explain/${employee.id}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("explain pay failed");
        return response.json() as Promise<ExplainPayPayload>;
      })
      .then((data) => {
        if (alive) setPayload(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [runId, employee.id]);

  const inputCards = useMemo(() => {
    const context = payload?.explanation.context;
    if (!context) return [];

    const cards: Array<{ label: string; value: string }> = [];
    if (context.monthlyBasicRate != null) cards.push({ label: "Monthly basic", value: moneyExact(context.monthlyBasicRate) });
    if (context.punches != null) cards.push({ label: "Attendance records", value: String(context.punches) });
    if (context.regularMinutes != null) cards.push({ label: "Regular hours", value: formatHours(context.regularMinutes) });
    if (context.overtimeMinutes != null) cards.push({ label: "Overtime", value: formatHours(context.overtimeMinutes) });
    if (context.nightMinutes != null) cards.push({ label: "Night diff", value: formatHours(context.nightMinutes) });
    if (context.tardinessMinutes != null || context.undertimeMinutes != null) {
      cards.push({
        label: "Late / undertime",
        value: `${context.tardinessMinutes ?? 0}m / ${context.undertimeMinutes ?? 0}m`,
      });
    }
    if (context.taxableCompensation != null) cards.push({ label: "Taxable compensation", value: moneyExact(context.taxableCompensation) });
    if (context.region) cards.push({ label: "Region", value: context.region });
    return cards;
  }, [payload]);

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={`Explain pay for ${employee.firstName} ${employee.lastName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <span className={styles.kicker}>Explain this pay</span>
            <h2>{employee.firstName} {employee.lastName}</h2>
            <p>{employee.employeeNo} · {payload?.run.periodLabel ?? "Payroll cutoff"}</p>
          </div>
          <button className={styles.close} onClick={onClose} aria-label="Close pay explanation">
            <X size={17} />
          </button>
        </div>

        {loading ? (
          <div className={styles.state}>Building the stored-pay explanation…</div>
        ) : failed || !payload ? (
          <div className={styles.error}>
            <AlertTriangle size={16} />
            <span>The pay explanation could not be loaded. The stored payslip breakdown is still available in the register.</span>
          </div>
        ) : (
          <>
            <section className={styles.summary}>
              <div>
                <span>Net pay</span>
                <strong>{moneyExact(payload.explanation.currentNet)}</strong>
                <small>current cutoff</small>
              </div>
              <div>
                <span>Previous net</span>
                <strong>{payload.explanation.previousNet == null ? "—" : moneyExact(payload.explanation.previousNet)}</strong>
                <small>{payload.previousRun?.periodLabel ?? "no released baseline"}</small>
              </div>
              <div>
                <span>Change</span>
                <strong className={
                  payload.explanation.netDelta == null
                    ? styles.neutral
                    : payload.explanation.netDelta >= 0
                      ? styles.positive
                      : styles.negative
                }>
                  {payload.explanation.netDelta == null
                    ? "—"
                    : `${payload.explanation.netDelta > 0 ? "+" : ""}${moneyExact(payload.explanation.netDelta)}`}
                </strong>
                <small>
                  {payload.explanation.netPercent == null
                    ? "first comparable cutoff"
                    : `${payload.explanation.netPercent > 0 ? "+" : ""}${payload.explanation.netPercent.toFixed(1)}% vs previous`}
                </small>
              </div>
            </section>

            {inputCards.length > 0 && (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>
                  <strong>Inputs used</strong>
                  <span>Stored with this calculation</span>
                </div>
                <div className={styles.inputGrid}>
                  {inputCards.map((card) => (
                    <div key={card.label}>
                      <span>{card.label}</span>
                      <strong>{card.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <strong>{payload.previousRun ? "What changed" : "How this pay was built"}</strong>
                <span>{payload.previousRun ? "Previous → current cutoff" : "Current cutoff components"}</span>
              </div>

              <div className={styles.lines}>
                {payload.explanation.lines.map((line) => {
                  const impact = line.netEffectDelta;
                  const deltaClass = impact == null
                    ? styles.neutral
                    : impact > 0
                      ? styles.positive
                      : impact < 0
                        ? styles.negative
                        : styles.neutral;

                  return (
                    <article className={styles.line} key={`${line.code}-${line.label}`}>
                      <div className={styles.lineTop}>
                        <div>
                          <code>{line.code}</code>
                          <strong>{line.label}</strong>
                        </div>
                        <div className={styles.amounts}>
                          <span>
                            {line.previous == null ? "—" : moneyExact(line.previous)}
                            <b>→</b>
                            {moneyExact(line.current)}
                          </span>
                          {line.delta != null && Math.abs(line.delta) >= 0.01 && (
                            <small className={deltaClass}>
                              {line.delta > 0 ? "+" : ""}{moneyExact(line.delta)}
                              {line.direction === "deduction" ? " deduction" : ""}
                            </small>
                          )}
                        </div>
                      </div>
                      <p>{line.reason}</p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className={styles.ruleBox}>
              <CircleDollarSign size={16} />
              <div>
                <strong>Ruleset {payload.explanation.ruleVersion ?? payload.run.ruleVersion}</strong>
                <p>
                  {payload.explanation.context.withholdingTable
                    ? `Tax basis: ${payload.explanation.context.withholdingTable}. `
                    : ""}
                  This view explains stored payroll line items and engine trace data. It does not recalculate the payslip in the browser.
                </p>
              </div>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function formatHours(minutes: number) {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours.toLocaleString("en-PH", { maximumFractionDigits: 2 })}h`;
}
