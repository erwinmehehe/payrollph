"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Calculator, LoaderCircle, ShieldCheck } from "lucide-react";
import { estimateMonthlyTakeHome } from "@/lib/take-home-estimate";
import {
  employeeTakeHomeReadError, parseEmployeeTakeHomeBaseline,
  type EmployeeTakeHomeBaselinePayload,
} from "@/lib/employee-take-home-baseline";
import { essText, type EssLanguage } from "@/lib/ess-language";

const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value || 0);
const signedPeso = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${peso(Math.abs(value))}`;

function numberInput(value: string) {
  const trimmed = value.replace(/,/g, "").trim();
  return trimmed === "" ? 0 : Number(trimmed);
}

export function EmployeeTakeHomeEstimator({ language = "en" }: { language?: EssLanguage }) {
  const t = (text: string) => essText(language, text);
  const headingId = useId();
  const [payload, setPayload] = useState<EmployeeTakeHomeBaselinePayload | null>(null);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [basic, setBasic] = useState("");
  const [taxableAllowances, setTaxableAllowances] = useState("0");
  const [deMinimis, setDeMinimis] = useState("0");
  const [voluntaryPagIbig, setVoluntaryPagIbig] = useState("0");

  useEffect(() => {
    const controller = new AbortController();
    setPayload(null);
    setError("");
    setUnauthorized(false);

    async function loadBaseline() {
      try {
        const response = await fetch("/api/self/take-home-estimate", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        if (!response.ok) {
          setUnauthorized(response.status === 401);
          setError(employeeTakeHomeReadError(response.status));
          return;
        }

        // A 200 response is still unusable if an intermediary returned HTML,
        // incomplete JSON, or inconsistent salary/withholding amounts.
        if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
          setError("The pay baseline response was invalid. Please retry.");
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        const verified = parseEmployeeTakeHomeBaseline(body);
        if (controller.signal.aborted) return;
        if (!verified) {
          setError("The pay baseline response was invalid. Please retry.");
          return;
        }
        setBasic(String(verified.baseline.monthlyBasic));
        setPayload(verified);
      } catch {
        if (!controller.signal.aborted) {
          setError("We could not reach the server to load your pay baseline.");
        }
      }
    }

    void loadBaseline();
    return () => controller.abort();
  }, [reloadCount]);

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
    <article className="employee-list-card" aria-labelledby={headingId}>
      <div className="employee-list-card-head">
        <div>
          <span className="card-kicker">{t("TAKE-HOME ESTIMATOR")}</span>
          <h3 id={headingId}>{t("What if my pay changes?")}</h3>
        </div>
        <Calculator size={18} aria-hidden="true" />
      </div>

      {!payload && !error && (
        <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 14px" }}>
          <LoaderCircle size={15} className="i-blue" />
          <span>{t("Loading your current pay baseline...")}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="notice notice-amber" style={{ margin: "13px 14px" }}>
          <span>{t(error)}</span>
          {unauthorized ? (
            <a className="clean-link" href="/login">{t("Sign in")}</a>
          ) : (
            <button type="button" className="clean-link"
              onClick={() => setReloadCount((count) => count + 1)}>
              {t("Retry loading")}
            </button>
          )}
        </div>
      )}

      {payload && current && (
        <div style={{ display: "grid", gap: 12, padding: "13px 14px" }}>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
            {t("Try a raise or a new allowance and see the monthly effect after SSS, PhilHealth, Pag-IBIG and withholding tax. Everything is calculated on this device; nothing you type is sent or saved.")}
          </p>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <label className="field">
              <span>{t("Monthly basic salary")}</span>
              <input inputMode="decimal" value={basic} onChange={(event) => setBasic(event.target.value)} />
            </label>
            <label className="field">
              <span>{t("Taxable allowances / month")}</span>
              <input inputMode="decimal" value={taxableAllowances} onChange={(event) => setTaxableAllowances(event.target.value)} />
            </label>
            <label className="field">
              <span>{t("De minimis / month")}</span>
              <input inputMode="decimal" value={deMinimis} onChange={(event) => setDeMinimis(event.target.value)} />
            </label>
            <label className="field">
              <span>{t("Voluntary Pag-IBIG / month")}</span>
              <input inputMode="decimal" value={voluntaryPagIbig} onChange={(event) => setVoluntaryPagIbig(event.target.value)} />
            </label>
          </div>

          {scenario ? (
            <>
              <div className="employee-pay-totals">
                <div><span>{t("Current estimate")}</span><strong>{peso(current.netPay)}</strong></div>
                <div><span>{t("Scenario estimate")}</span><strong>{peso(scenario.netPay)}</strong></div>
                <div>
                  <span>{t("Monthly change")}</span>
                  <strong className={delta < 0 ? "red-number" : delta > 0 ? "green-number" : ""}>{signedPeso(delta)}</strong>
                </div>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span>{t("Gross pay")}</span>
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
                    <span>{t(label as string)}</span>
                    <strong className={(value as number) < 0 ? "red-number" : ""}>{signedPeso(value as number)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div role="alert" className="notice notice-amber"><span>{t("Enter amounts from 0 to 100,000,000.")}</span></div>
          )}

          <div className="employee-rule-note">
            <ShieldCheck size={12} /> {payload.note}{payload.baseline.mwe ? " " + t("You are classified as a minimum wage earner, so only supplementary taxable pay is taxed.") : ""}
          </div>
        </div>
      )}
    </article>
  );
}
