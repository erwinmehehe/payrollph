"use client";

import { useState } from "react";
import { ArrowUpRight, Minus, Plus, Users } from "lucide-react";
import { money } from "@/components/workspace/ui";

export type PublicPlan = { id: number; name: string; monthlyBase: string; perEmployee: string; modules: unknown; version: string };

const BLURB: Record<string, string> = {
  Solo: "For independent and self-employed work",
  Core: "For a small team on one payroll",
  Scale: "For growing operations and multi-branch payroll",
  Enterprise: "For complex organizations and bookkeeping practices",
};

/**
 * Pricing read from the `pricing_plans` table, the same rows the in-app
 * checkout uses. Nothing here is a marketing number.
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
        <p className="eyebrow" style={{ margin: 0 }}>
          Headcount calculator
        </p>
        <h2>How many people are you paying in the Philippines?</h2>
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
        <div className="calc-note">
          <Users size={16} className="i-purple" />
          <span>
            Every figure below is the plan&apos;s stored base plus its per-employee rate at this headcount. Solo is priced for
            one person, so headcount does not change it.
          </span>
        </div>
      </div>

      <div className="pricing-grid">
        {plans.map((plan) => {
          const perSeat = plan.name === "Solo" ? 0 : headcount;
          const total = Number(plan.monthlyBase) + Number(plan.perEmployee) * perSeat;
          const modules = Array.isArray(plan.modules) ? (plan.modules as string[]) : [];
          return (
            <article className={`price-card ${plan.name === "Scale" ? "featured" : ""}`} key={plan.id}>
              {plan.name === "Scale" && <div className="popular-label">Most chosen</div>}
              <span className="price-plan">{plan.name}</span>
              <h2>{BLURB[plan.name] ?? "Philippine payroll and HRIS"}</h2>
              {modules.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 16, color: "var(--muted)", fontSize: 11.5, lineHeight: 1.75 }}>
                  {modules.slice(0, 5).map((module) => (
                    <li key={module}>{module}</li>
                  ))}
                </ul>
              )}
              <div className="price" aria-live="polite">
                <strong>{money(total)}</strong>
                <span>/ month</span>
              </div>
              <small>
                Base {money(plan.monthlyBase)}
                {plan.name === "Solo" ? "" : ` + ${money(plan.perEmployee)} per employee`} · pricing table v{plan.version}
              </small>
              <a className={plan.name === "Scale" ? "primary-button full" : "secondary-button full"} href="/signup">
                Create account <ArrowUpRight size={14} />
              </a>
            </article>
          );
        })}
      </div>
    </>
  );
}
