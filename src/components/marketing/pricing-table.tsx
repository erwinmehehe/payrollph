"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Minus, Plus } from "lucide-react";
import { money } from "@/components/workspace/ui";

export type PublicPlan = {
  id: number;
  name: string;
  monthlyBase: string;
  perEmployee: string;
  modules: unknown;
  version: string;
};

const BLURB: Record<string, string> = {
  Solo: "For independent and self-employed work",
  Core: "For small teams running one Philippine payroll",
  Scale: "For growing teams, approvals and multi-branch payroll",
  Enterprise: "For complex organizations and high-control payroll operations",
};

const BEST_FOR: Record<string, string> = {
  Core: "Best for 5–40 employees",
  Scale: "Best for 25–250 employees",
  Enterprise: "Best for larger or complex teams",
};

const HEADCOUNT_PRESETS = [10, 25, 50, 100];

const BUYER_POINTS: Record<string, string[]> = {
  Core: [
    "One Philippine payroll workspace",
    "Employee records, attendance and payslips",
    "SSS, PhilHealth, Pag-IBIG and TRAIN calculations",
  ],
  Scale: [
    "Everything in Core",
    "Checker approvals, audit trail and stronger controls",
    "Built for growing teams and multi-branch operations",
  ],
  Enterprise: [
    "Everything in Scale",
    "Advanced controls, migration and integration support",
    "For larger or more complex payroll operations",
  ],
};

export function PricingTable({ plans }: { plans: PublicPlan[] }) {
  const [headcount, setHeadcount] = useState(25);
  const solo = plans.find((plan) => plan.name === "Solo");
  const businessPlans = plans.filter((plan) => plan.name !== "Solo");

  function updateHeadcount(value: number) {
    setHeadcount(Math.min(500, Math.max(1, Math.round(value) || 1)));
  }

  return (
    <>
      <div className="pricing-estimator">
        <div>
          <span className="price-plan">Monthly estimate</span>
          <strong>{headcount} employees</strong>
          <small>Change headcount and every plan updates immediately.</small>
        </div>

        <div className="pricing-estimator-controls">
          <div className="pricing-presets" aria-label="Headcount presets">
            {HEADCOUNT_PRESETS.map((count) => (
              <button
                type="button"
                key={count}
                className={headcount === count ? "active" : ""}
                onClick={() => updateHeadcount(count)}
              >
                {count}
              </button>
            ))}
          </div>

          <div className="pricing-stepper-box">
            <button
              type="button"
              aria-label="Decrease headcount"
              onClick={() => updateHeadcount(headcount - 1)}
              disabled={headcount <= 1}
            >
              <Minus size={14} />
            </button>
            <label>
              <span>Employees</span>
              <input
                type="number"
                min={1}
                max={500}
                value={headcount}
                onChange={(event) => updateHeadcount(Number(event.target.value))}
                aria-label="Employee headcount"
              />
            </label>
            <button
              type="button"
              aria-label="Increase headcount"
              onClick={() => updateHeadcount(headcount + 1)}
              disabled={headcount >= 500}
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="pricing-grid business-pricing-grid">
        {businessPlans.map((plan) => {
          const total = Number(plan.monthlyBase) + Number(plan.perEmployee) * headcount;
          const featured = plan.name === "Scale";
          const buyerPoints = BUYER_POINTS[plan.name] ?? [];

          return (
            <article className={`price-card ${featured ? "featured" : ""}`} key={plan.id}>
              <div className="price-card-top">
                <div>
                  <span className="price-plan">{plan.name}</span>
                  <h2>{BLURB[plan.name] ?? "Philippine payroll and HRIS"}</h2>
                  <small className="price-best-for">{BEST_FOR[plan.name] ?? "Flexible team size"}</small>
                </div>
                {featured && <span className="popular-label">Recommended</span>}
              </div>

              <div className="price">
                <strong>{money(total)}</strong>
                <span>/ month</span>
              </div>

              <small className="price-formula">
                {money(plan.monthlyBase)} base + {money(plan.perEmployee)} × {headcount} employees
              </small>

              <ul className="price-features">
                {buyerPoints.map((point) => (
                  <li key={point}>
                    <Check size={13} aria-hidden />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <a className={featured ? "primary-button full" : "secondary-button full"} href="/signup">
                Start free <ArrowUpRight size={13} />
              </a>
            </article>
          );
        })}
      </div>

      {solo && (
        <div className="solo-price-row">
          <div>
            <span className="price-plan">Solo</span>
            <strong>Self-employed?</strong>
            <small>{BLURB.Solo}. No employee payroll seat required.</small>
          </div>
          <div className="solo-price-value">
            <strong>{money(solo.monthlyBase)}</strong>
            <span>/ month</span>
          </div>
          <a className="secondary-button" href="/signup">
            Start Solo <ArrowUpRight size={13} />
          </a>
        </div>
      )}
    </>
  );
}
