"use client";

import { useState } from "react";
import { ArrowRight, Check, Minus, Plus } from "lucide-react";
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
  Core: "The essentials for one Philippine payroll team",
  Scale: "More control for growing payroll operations",
  Enterprise: "Advanced controls for complex organizations",
};

const WHO_FOR: Record<string, string> = {
  Core: "One payroll team, usually 5–40 employees, that wants payroll, attendance and statutory calculations in one place.",
  Scale:
    "Growing companies that need checker approvals, an audit trail, or multiple locations without adding payroll spreadsheets.",
  Enterprise:
    "Larger or high-control organizations that need advanced access, migration support, integrations, or stricter operating controls.",
};

const BEST_FOR: Record<string, string> = {
  Core: "5–40 employees",
  Scale: "25–250 employees",
  Enterprise: "Complex or larger teams",
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
          <span className="price-plan">Estimate your monthly bill</span>
          <strong>{headcount} employees</strong>
          <small>Change headcount and the monthly estimate updates immediately.</small>
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

      <div className="pricing-comparison business-pricing-grid">
        {businessPlans.map((plan) => {
          const total = Number(plan.monthlyBase) + Number(plan.perEmployee) * headcount;
          const featured = plan.name === "Scale";
          const buyerPoints = BUYER_POINTS[plan.name] ?? [];

          return (
            <article className={`pricing-plan-row ${featured ? "featured" : ""}`} key={plan.id}>
              <div className="pricing-plan-identity">
                <div className="pricing-plan-heading">
                  <span className="price-plan">{plan.name}</span>
                  {featured && <span className="popular-label">Approval-ready</span>}
                </div>
                <h3>{BLURB[plan.name] ?? "Philippine payroll and HRIS"}</h3>
                <p>{WHO_FOR[plan.name] ?? "A flexible Philippine payroll setup for your team."}</p>
                <small className="price-best-for">Typical fit · {BEST_FOR[plan.name] ?? "Flexible team size"}</small>
              </div>

              <div className="pricing-plan-cost">
                <span>Estimated monthly</span>
                <div className="price">
                  <strong>{money(total)}</strong>
                  <span>/ month</span>
                </div>
                <small className="price-formula">
                  {money(plan.monthlyBase)} base + {money(plan.perEmployee)} × {headcount}
                </small>
              </div>

              <ul className="price-features" aria-label={`${plan.name} operating fit`}>
                {buyerPoints.map((point) => (
                  <li key={point}>
                    <Check size={13} aria-hidden />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>

              <a className={featured ? "primary-button pricing-plan-cta" : "secondary-button pricing-plan-cta"} href="/signup">
                Start free <ArrowRight size={13} />
              </a>
            </article>
          );
        })}
      </div>

      {solo && (
        <div className="solo-price-row">
          <div>
            <span className="price-plan">Solo</span>
            <strong>Self-employed or working independently?</strong>
            <small>{BLURB.Solo}. No employee payroll seat required.</small>
          </div>
          <div className="solo-price-value">
            <strong>{money(solo.monthlyBase)}</strong>
            <span>/ month</span>
          </div>
          <a className="secondary-button" href="/signup">
            Start Solo <ArrowRight size={13} />
          </a>
        </div>
      )}
    </>
  );
}
