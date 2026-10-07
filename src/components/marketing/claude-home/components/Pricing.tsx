import { useState } from "react";
import { ArrowRight, Minus, Plus, Sparkles } from "lucide-react";
import { CheckItem, Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";
import type { PublicPlan } from "../App";

const PLAN_COPY = {
  Core: {
    tagline: "The essentials for one Philippine payroll team",
    fit: "Best for 5–40 employees",
    features: [
      "Payroll, attendance and employee records in one workspace",
      "SSS, PhilHealth, Pag-IBIG and TRAIN calculations",
      "Payslips and clearly labelled government worksheet data",
    ],
  },
  Scale: {
    tagline: "More control for growing payroll operations",
    fit: "Best for 25–250 employees",
    features: [
      "Everything in Core",
      "Checker approvals, audit trail and stronger controls",
      "Multi-branch payroll without extra spreadsheets",
    ],
  },
  Enterprise: {
    tagline: "Advanced controls for complex organizations",
    fit: "Best for complex or larger teams",
    features: [
      "Everything in Scale",
      "Advanced access, migration and integration support",
      "Higher-control workflows for larger payroll operations",
    ],
  },
} as const;

const presets = [10, 25, 50, 100];

function peso(n: number) {
  return "₱" + n.toLocaleString("en-PH");
}

export default function Pricing({ plans }: { plans: PublicPlan[] }) {
  const [heads, setHeads] = useState(25);
  const clamp = (value: number) => Math.min(500, Math.max(1, value));
  const businessPlans = plans.filter((plan) => plan.name !== "Solo");
  const hasSolo = plans.some((plan) => plan.name === "Solo");

  return (
    <section id="pricing" className="scroll-mt-20 py-16 sm:py-20">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <div className="grid gap-7 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <SectionHeading
            title={<>Know what payroll will cost before you talk to anyone.</>}
            description="Choose a headcount, then compare the operating model that fits your team. The figures below come from Linaw's persisted pricing."
          />
          <Reveal delay={100}>
            <div className="flex flex-col gap-4 rounded-[24px] border border-[#E2E4F0] bg-[#FAFBFD] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.13em] text-[#8B90AA]">Monthly estimate</p>
                <p className="pricing-headcount font-display mt-1 text-[30px] font-semibold">
                  {heads} <span className="text-[17px] font-medium text-[#5B6080]">employee{heads === 1 ? "" : "s"}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setHeads(preset)}
                    aria-pressed={heads === preset}
                    data-headcount={preset}
                    className={cn(
                      "rounded-full border px-4 py-2 text-[13.5px] font-semibold transition-all",
                      heads === preset
                        ? "border-[#0877ff] bg-[#0877ff] text-white shadow-md"
                        : "border-[#E2E4F0] bg-white text-[#2B2F45] hover:border-[#B9BDE0]"
                    )}
                  >
                    {preset}
                  </button>
                ))}
                <div className="ml-1 flex items-center gap-1 rounded-full border border-[#E2E4F0] bg-white p-1">
                  <button
                    onClick={() => setHeads((current) => clamp(current - 1))}
                    aria-label="Decrease headcount"
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#F1F2F8]"
                  >
                    <Minus className="h-4 w-4" aria-hidden />
                  </button>
                  <span className="w-11 text-center text-[14px] font-semibold tabular-nums" aria-live="polite">{heads}</span>
                  <button
                    onClick={() => setHeads((current) => clamp(current + 1))}
                    aria-label="Increase headcount"
                    className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#F1F2F8]"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-7 grid gap-4 lg:grid-cols-3">
          {businessPlans.map((plan, index) => {
            const copy = PLAN_COPY[plan.name as keyof typeof PLAN_COPY] ?? PLAN_COPY.Core;
            const base = Number(plan.monthlyBase);
            const perHead = Number(plan.perEmployee);
            const total = base + perHead * heads;
            const featured = plan.name === "Scale";

            return (
              <Reveal key={plan.id} delay={index * 90}>
                <article
                  className={cn(
                    "pricing-plan-card relative flex h-full flex-col overflow-hidden rounded-[24px] border bg-white p-6 transition-all duration-300 hover:-translate-y-1",
                    featured
                      ? "border-[#b7d6ff] shadow-[0_18px_50px_-26px_rgba(8,119,255,0.38)] ring-1 ring-[#E7E7FF]"
                      : "card-hover border-[#E8EAF3]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={cn("text-[12px] font-bold uppercase tracking-[0.14em]", featured ? "text-[#0877ff]" : "text-[#7C82A1]")}>
                        {plan.name}
                      </p>
                      <h3 className="font-display mt-2 text-[21px] font-semibold leading-tight">{copy.tagline}</h3>
                    </div>
                    {featured && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#cddfff] bg-[#f2f7ff] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#0868dc]">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        Popular
                      </span>
                    )}
                  </div>

                  <p className="mt-3 text-[13.5px] font-medium text-[#7C82A1]">{copy.fit}</p>

                  <div className="my-5 h-px bg-[#EDEFF7]" aria-hidden />

                  <p className="text-[12px] font-medium text-[#7C82A1]">Estimated monthly</p>
                  <p className="mt-1 flex items-baseline gap-1.5">
                    <span key={total} className="pricing-amount font-display text-[36px] font-semibold tracking-[-0.035em] tabular-nums text-[#11141F]">{peso(total)}</span>
                    <span className="text-[13px] font-medium text-[#7C82A1]">/mo</span>
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-[#8B90AA]">
                    {peso(base)} base + {peso(perHead)} × {heads}
                  </p>

                  <ul className="mt-5 space-y-3">
                    {copy.features.map((feature) => (
                      <CheckItem key={feature}>{feature}</CheckItem>
                    ))}
                  </ul>

                  <a
                    href="/signup"
                    className={cn(
                      "group mt-6 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[14px] font-semibold transition-all",
                      featured
                        ? "border border-[#0877ff] bg-[#0877ff] text-white shadow-[0_10px_24px_-12px_rgba(8,119,255,.6)] hover:bg-[#4F4FE6]"
                        : "border border-[#D9DCEC] bg-white text-[#2B2F45] hover:border-[#B9BDE0] hover:bg-[#F7F8FC]"
                    )}
                  >
                    Request trial access
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </a>
                </article>
              </Reveal>
            );
          })}
        </div>

        {hasSolo && (
          <Reveal delay={120}>
            <div className="mt-4 flex flex-col items-start justify-between gap-4 rounded-[24px] border border-[#E2E4F0] bg-gradient-to-r from-[#e5f8f2]/60 via-white to-[#e5f0ff]/60 p-5 sm:flex-row sm:items-center">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.13em] text-[#00886e]">Solo · Free</p>
                <p className="font-display mt-1 text-[19px] font-semibold">Self-employed or working independently?</p>
                <p className="mt-1 text-[14px] text-[#5B6080]">Use Linaw without an employee payroll seat.</p>
              </div>
              <div className="flex items-center gap-4">
                <p className="font-display text-[28px] font-semibold">₱0 <span className="text-[13px] font-medium text-[#7C82A1]">/month</span></p>
                <a href="/signup" className="rounded-full border border-[#D9DCEC] bg-white px-5 py-2.5 text-[13.5px] font-semibold shadow-sm transition-all hover:border-[#11141F]">
                  Request solo access
                </a>
              </div>
            </div>
          </Reveal>
        )}

        <Reveal delay={90}>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center text-[13.5px] font-medium text-[#7C82A1]">
            <span>Pricing uses the current plan configuration</span>
            <span>Trial workspace access is controlled</span>
            <span>No payroll file needed to request access</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
