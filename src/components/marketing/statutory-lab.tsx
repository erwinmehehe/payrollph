"use client";

import { useState } from "react";
import { Calculator, Info } from "lucide-react";
import {
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
} from "@/lib/payroll-rules";
import { moneyExact } from "@/components/workspace/ui";

/**
 * A salary slider wired straight into the repo's statutory functions. Nothing
 * is re-derived here: change the salary and you are watching
 * `src/lib/payroll-rules.ts` run.
 */
export function StatutoryLab() {
  const [monthly, setMonthly] = useState(38500);
  const [mwe, setMwe] = useState(false);

  const sss = computeSss(monthly);
  const philHealth = computePhilHealth(monthly);
  const pagIbig = computePagIbig(monthly);

  // The engine splits monthly contributions across the two semi-monthly cutoffs.
  const halfGross = monthly / 2;
  const halfSss = sss.employee / 2;
  const halfPhic = philHealth.employee / 2;
  const halfHdmf = pagIbig.employee / 2;
  const taxable = Math.max(halfGross - halfSss - halfPhic - halfHdmf, 0);
  const withholding = computeSemiMonthlyWithholdingTax(taxable, mwe);

  const employeeDeductions = halfSss + halfPhic + halfHdmf + withholding;
  const net = halfGross - employeeDeductions;
  const employerCost = halfGross + sss.employerTotal / 2 + philHealth.employer / 2 + pagIbig.employer / 2;

  const fill = ((monthly - 8000) / (150000 - 8000)) * 100;

  return (
    <div className="simulator-card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span className="feature-icon" style={{ width: 32, height: 32, marginBottom: 0, borderRadius: 9 }} aria-hidden>
          <Calculator size={16} className="i-green" />
        </span>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>
            Statutory engine
          </p>
          <h3 style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>
            One semi-monthly cutoff, computed live
          </h3>
        </div>
      </div>

      <div className="range-row" style={{ marginTop: 18 }}>
        <div>
          <label htmlFor="lab-salary">Monthly basic salary</label>
          <output htmlFor="lab-salary">{moneyExact(monthly)}</output>
        </div>
        <input
          id="lab-salary"
          type="range"
          min={8000}
          max={150000}
          step={500}
          value={monthly}
          style={{ ["--range-fill" as string]: `${fill}%` }}
          onChange={(event) => setMonthly(Number(event.target.value))}
        />
      </div>

      <label className="switch">
        <input type="checkbox" checked={mwe} onChange={(event) => setMwe(event.target.checked)} />
        <i aria-hidden />
        <span>Treat as a minimum-wage earner (MWE)</span>
      </label>

      <div className="sim-grid">
        <div>
          <p className="eyebrow">Employee deductions · this cutoff</p>
          <div className="sim-breakdown-row">
            <span>
              SSS
              <em>RA 11199 contribution table, employee share</em>
            </span>
            <strong>{moneyExact(halfSss)}</strong>
          </div>
          <div className="sim-breakdown-row">
            <span>
              PhilHealth
              <em>RA 11223 premium, split with the employer</em>
            </span>
            <strong>{moneyExact(halfPhic)}</strong>
          </div>
          <div className="sim-breakdown-row">
            <span>
              Pag-IBIG
              <em>RA 9679 member contribution</em>
            </span>
            <strong>{moneyExact(halfHdmf)}</strong>
          </div>
          <div className="sim-breakdown-row">
            <span>
              Withholding tax
              <em>{mwe ? "MWE, fully exempt" : "TRAIN semi-monthly bracket on taxable pay"}</em>
            </span>
            <strong>{moneyExact(withholding)}</strong>
          </div>
          <div className="sim-breakdown-row">
            <span>Total deductions</span>
            <strong className="red-number">{moneyExact(employeeDeductions)}</strong>
          </div>
        </div>

        <div>
          <p className="eyebrow">Result</p>
          <div className="run-stats statutory-result-stats" style={{ margin: 0 }}>
            <div>
              <span>Gross this cutoff</span>
              <strong>{moneyExact(halfGross)}</strong>
            </div>
            <div>
              <span>Net take-home</span>
              <strong className="green-number">{moneyExact(net)}</strong>
            </div>
          </div>
          <div className="sim-breakdown-row" style={{ marginTop: 14 }}>
            <span>
              Employer cost
              <em>gross plus the employer share of all three contributions</em>
            </span>
            <strong>{moneyExact(employerCost)}</strong>
          </div>
          <div className="notice notice-blue" style={{ marginBottom: 0 }}>
            <Info size={14} className="i-blue" />
            <span>
              These figures call <span className="mono">computeSss</span>, <span className="mono">computePhilHealth</span>,{" "}
              <span className="mono">computePagIbig</span> and <span className="mono">computeSemiMonthlyWithholdingTax</span>{" "}
              from the payroll library, the same functions a real run uses, covered by{" "}
              <span className="mono">tests/payroll-rules.test.ts</span>.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
