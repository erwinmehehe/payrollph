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
  Core: "For a small team on one payroll",
  Scale: "For growing operations and multi-branch payroll",
  Enterprise: "For complex organizations and bookkeeping practices",
};

/**
 * Pricing is read from the same persisted pricing rows used by checkout.
 */
export function PricingTable({ plans }: { plans: PublicPlan[] }) {
  const [headcount, setHeadcount] = useState(24);
  const fill = ((headcount - 1) / (500 - 1)) * 100;

  function updateHeadcount(value: number) {
    setHeadcount(Math.min(500, Math.max(1, Math.round(value) || 1)));
  }

  return (
    <>
      <div className="pricing-calculator">
        <div className="pricing-calculator-copy">
          <p className="eyebrow">Headcount</p>
          <h2>How many people are you paying?</h2>
          <p>Adjust the headcount and the monthly pricing updates automatically.</p>
        </div>

        <div className="pricing-headcount-control">
          <div className="pricing-headcount-value">
            <button
              type="button"
              className="pricing-stepper"
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
                inputMode="numeric"
                value={headcount}
                aria-label="Employee headcount"
                onChange={(event) => updateHeadcount(Number(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="pricing-stepper"
              aria-label="Increase headcount"
              onClick={() => updateHeadcount(headcount + 1)}
              disabled={headcount >= 500}
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="pricing-headcount-slider">
            <input
              type="range"
              min={1}
              max={500}
              value={headcount}
              aria-label="Headcount slider"
              style={{ ["--range-fill" as string]: `${fill}%` }}
              onChange={(event) => updateHeadcount(Number(event.target.value))}
            />
            <div className="pricing-range-labels" aria-hidden>
              <span>1</span>
              <span>500</span>
            </div>
          </div>
        </div>
      </div>

      <div className="pricing-grid">
        {plans.map((plan) => {
          const perSeat = plan.name === "Solo" ? 0 : headcount;
          const total = Number(plan.monthlyBase) + Number(plan.perEmployee) * perSeat;
          const modules = Array.isArray(plan.modules) ? (plan.modules as string[]) : [];
          const featured = plan.name === "Scale";

          return (
            <article className={`price-card ${featured ? "featured" : ""}`} key={plan.id}>
              <div className="price-card-top">
                <div>
                  <span className="price-plan">{plan.name}</span>
                  <h2>{BLURB[plan.name] ?? "Philippine payroll and HRIS"}</h2>
                </div>
                {featured && <span className="popular-label">Most chosen</span>}
              </div>

              <div className="price">
                <strong>{money(total)}</strong>
                <span>/ month</span>
              </div>

              <small className="price-formula">
                Base {money(plan.monthlyBase)}
                {plan.name === "Solo" ? "" : ` + ${money(plan.perEmployee)} per employee`}
              </small>

              {modules.length > 0 && (
                <ul className="price-features">
                  {modules.slice(0, 4).map((module) => (
                    <li key={module}>
                      <Check size={12} aria-hidden />
                      <span>{module}</span>
                    </li>
                  ))}
                </ul>
              )}

              <a className={featured ? "primary-button full" : "secondary-button full"} href="/signup">
                Start free <ArrowUpRight size={13} />
              </a>
            </article>
          );
        })}
      </div>
    </>
  );
}
