"use client";

import { useEffect, useMemo, useState } from "react";
import { Calculator, LoaderCircle, ShieldCheck } from "lucide-react";
import { estimateMonthlyTakeHome, type TakeHomeEstimate } from "@/lib/take-home-estimate";

type Baseline = { monthlyBasic: number; payBasis: string; mwe: boolean };
type BaselinePayload = { asOf: string; baseline: Baseline; estimate: TakeHomeEstimate; note: string };

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const signedPeso = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${peso(Math.abs(value))}`;

function numberInput(value: string) {
  const trimmed = value.replace(/,/g, "").trim();
  return trimmed === "" ? 0 : Number(trimmed);
}

export function EmployeeTakeHomeEstimator() {
  const [payload, setPayload] = useState<BaselinePayload | null>(null);
  const [error, setError] = useState("");
  const [basic, setBasic] = useState("");
  const [taxableAllowances, setTaxableAllowances] = useState("0");
  const [deMinimis, setDeMinimis] = useState("0");
  const [voluntaryPagIbig, setVoluntaryPagIbig] = useState("0");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/self/take-home-estimate", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError(body.error ?? "We could not load your pay baseline.");
          return;
        }
        setPayload(body as BaselinePayload);
        setBasic(String((body as BaselinePayload).baseline.monthlyBasic));
      })
      .catch(() => {
        if (!cancelled) setError("We could not reach the server to load your pay baseline.");
      });
    return () => { cancelled = true; };
  }, []);

  const scenario = useMemo(() => {
    if (!payload) return null;
    try {
      return estimateMonthlyTakeHome({
        monthlyBasic: numberInput(basic),
        taxableAllowances: numberInput(taxableAllowances),
        nonTaxableAllowances: numberInput(deMinimis),
        voluntaryPagIbig: numberInput(voluntaryPagIbig),
        mwe: payload.baseline.mwe,
        asOf: payload.asOf,
      });
    } catch {
      return null;
    }
  }, [payload, basic, taxableAllowances, deMinimis, voluntaryPagIbig]);

  const current = payload?.estimate ?? null;
  const delta = scenario && current ? scenario.netPay - current.netPay : 0;

  return (
    <article className="employee-list-card">
      <div className="employee-list-card-head">
        <div>
          <span className="card-kicker">TAKE-HOME ESTIMATOR</span>
          <h3>What if my pay changes?</h3>
        </div>
        <Calculator size={18} aria-hidden="true" />
      </div>

      {!payload && !error && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 14px" }}>
          <LoaderCircle size={15} className="i-blue" />
          <span>Loading your current pay baseline...</span>
        </div>
      )}
      {error && <div className="notice notice-amber" style={{ margin: "13px 14px" }}><span>{error}</span></div>}

      {payload && current && (
        <div style={{ display: "grid", gap: 12, padding: "13px 14px" }}>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
            Try a raise or a new allowance and see the monthly effect after SSS, PhilHealth, Pag-IBIG and withholding tax.
            Everything is calculated on this device; nothing you type is sent or saved.
          </p>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <label className="field">
              <span>Monthly basic salary</span>
              <input inputMode="decimal" value={basic} onChange={(event) => setBasic(event.target.value)} />
            </label>
            <label className="field">
              <span>Taxable allowances / month</span>
              <input inputMode="decimal" value={taxableAllowances} onChange={(event) => setTaxableAllowances(event.target.value)} />
            </label>
            <label className="field">
              <span>De minimis / month</span>
              <input inputMode="decimal" value={deMinimis} onChange={(event) => setDeMinimis(event.target.value)} />
            </label>
            <label className="field">
              <span>Voluntary Pag-IBIG / month</span>
              <input inputMode="decimal" value={voluntaryPagIbig} onChange={(event) => setVoluntaryPagIbig(event.target.value)} />
            </label>
          </div>

          {scenario ? (
            <>
              <div className="employee-pay-totals">
                <div><span>Current estimate</span><strong>{peso(current.netPay)}</strong></div>
                <div><span>Scenario estimate</span><strong>{peso(scenario.netPay)}</strong></div>
                <div>
                  <span>Monthly change</span>
                  <strong className={delta < 0 ? "red-number" : delta > 0 ? "green-number" : ""}>{signedPeso(delta)}</strong>
                </div>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>Gross pay</span>
                  <strong>{peso(scenario.gross)}</strong>
                </div>
                {[
                  ["SSS (employee share)", -scenario.sss],
                  ["PhilHealth (employee share)", -scenario.philHealth],
                  ["Pag-IBIG (employee share)", -scenario.pagIbig],
                  ["Voluntary Pag-IBIG", -scenario.voluntaryPagIbig],
                  ["Withholding tax", -scenario.withholdingTax],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                    <span>{label}</span>
                    <strong className={(value as number) < 0 ? "red-number" : ""}>{signedPeso(value as number)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="notice notice-amber"><span>Enter amounts from 0 to 100,000,000.</span></div>
          )}

          <div className="employee-rule-note">
            <ShieldCheck size={12} /> {payload.note}{payload.baseline.mwe ? " You are classified as a minimum wage earner, so only supplementary taxable pay is taxed." : ""}
          </div>
        </div>
      )}
    </article>
  );
}
