import { useState } from "react";
import { ArrowRight, Minus, Plus, Sparkles, Star } from "lucide-react";
import { CheckItem, Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";
import type { PublicPlan } from "../App";

const PLAN_COPY = {
  Core: {
    tagline: "The essentials for one Philippine payroll team",
    desc: "One payroll team, usually 5–40 employees, that wants payroll, attendance and statutory calculations in one place.",
    typical: "Typical fit: 5–40 employees",
    features: [
      "One Philippine payroll workspace",
      "Employee records, attendance and payslips",
      "SSS, PhilHealth, Pag-IBIG and TRAIN calculations",
    ],
  },
  Scale: {
    tagline: "More control for growing payroll operations",
    desc: "Growing companies that need checker approvals, an audit trail, or multiple locations without adding payroll spreadsheets.",
    typical: "Typical fit: 25–250 employees",
    features: [
      "Everything in Core",
      "Checker approvals, audit trail and stronger controls",
      "Built for growing teams and multi-branch operations",
    ],
  },
  Enterprise: {
    tagline: "Advanced controls for complex organizations",
    desc: "Larger or high-control organizations that need advanced access, migration support, integrations, or stricter operating controls.",
    typical: "Typical fit: Complex or larger teams",
    features: [
      "Everything in Scale",
      "Advanced controls, migration and integration support",
      "For larger or more complex payroll operations",
    ],
  },
} as const;

const presets = [10, 25, 50, 100];

function peso(n: number) {
  return "₱" + n.toLocaleString("en-PH");
}

export default function Pricing({ plans }: { plans: PublicPlan[] }) {
  const [heads, setHeads] = useState(25);
  const clamp = (v: number) => Math.min(500, Math.max(1, v));
  const businessPlans = plans.filter((plan) => plan.name !== "Solo");
  const hasSolo = plans.some((plan) => plan.name === "Solo");

  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <SectionHeading
          title={<>Know what payroll will cost before you talk to anyone.</>}
          description="Set your headcount and compare the operating model that fits your team."
        />

        <Reveal delay={150}>
          <div className="mt-10 flex flex-col gap-5 rounded-3xl border border-[#E2E4F0] bg-[#FAFBFD] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#7C82A1]">Estimate your monthly bill</p>
              <p className="pricing-headcount font-display mt-1 text-[28px] font-extrabold">
                {heads} <span className="text-[18px] font-bold text-[#5B6080]">employee{heads === 1 ? "" : "s"}</span>
              </p>
              <p className="mt-0.5 text-[13px] text-[#7C82A1]">Change headcount and the monthly estimate updates immediately.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => setHeads(p)}
                  aria-pressed={heads === p}
                  data-headcount={p}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[13.5px] font-bold transition-all",
                    heads === p
                      ? "border-[#6161FF] bg-[#6161FF] text-white shadow-md"
                      : "border-[#E2E4F0] bg-white text-[#2B2F45] hover:border-[#B9BDE0]"
                  )}
                >
                  {p}
                </button>
              ))}
              <div className="ml-1 flex items-center gap-1 rounded-full border border-[#E2E4F0] bg-white p-1">
                <button
                  onClick={() => setHeads((h) => clamp(h - 1))}
                  aria-label="Decrease headcount"
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#F1F2F8]"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <span className="w-12 text-center text-[14px] font-extrabold tabular-nums" aria-live="polite">{heads}</span>
                <button
                  onClick={() => setHeads((h) => clamp(h + 1))}
                  aria-label="Increase headcount"
                  className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#F1F2F8]"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </Reveal>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {businessPlans.map((plan, i) => {
            const copy = PLAN_COPY[plan.name as keyof typeof PLAN_COPY] ?? PLAN_COPY.Core;
            const base = Number(plan.monthlyBase);
            const perHead = Number(plan.perEmployee);
            const total = base + perHead * heads;
            const featured = plan.name === "Scale";
            return (
              <Reveal key={plan.id} delay={i * 100}>
                <article
                  className={cn(
                    "pricing-plan-card relative flex h-full flex-col overflow-hidden rounded-3xl border p-7 transition-all duration-300 hover:-translate-y-1.5",
                    featured
                      ? "border-[#11141F] bg-[#11141F] text-white shadow-[0_28px_64px_-20px_rgba(17,20,31,0.5)]"
                      : "card-hover border-[#E8EAF3] bg-white"
                  )}
                >
                  {featured && (
                    <span className="absolute right-5 top-5 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-[#11141F]">
                      <Sparkles className="h-3 w-3" aria-hidden /> Most popular
                    </span>
                  )}
                  <p className={cn("text-[11px] font-extrabold uppercase tracking-[0.16em]", featured ? "text-white/60" : "text-[#7C82A1]")}>{plan.name}</p>
                  <h3 className="font-display mt-2 text-[22px] font-extrabold leading-tight">{copy.tagline}</h3>
                  <p className={cn("mt-2.5 text-[13.5px] leading-relaxed", featured ? "text-white/65" : "text-[#5B6080]")}>{copy.desc}</p>
                  <p className={cn("mt-2 text-[12px] font-semibold", featured ? "text-white/50" : "text-[#9AA0BB]")}>{copy.typical}</p>

                  <div className={cn("my-5 h-px", featured ? "bg-white/12" : "bg-[#EDEFF7]")} aria-hidden />

                  <p className={cn("text-[12px] font-semibold", featured ? "text-white/60" : "text-[#7C82A1]")}>Estimated monthly</p>
                  <p className="mt-1 flex items-baseline gap-1.5">
                    <span key={total} className="pricing-amount font-display text-[36px] font-extrabold tabular-nums">{peso(total)}</span>
                    <span className={cn("text-[13px] font-medium", featured ? "text-white/55" : "text-[#7C82A1]")}>/month</span>
                  </p>
                  <p className={cn("mt-1 font-mono text-[11.5px]", featured ? "text-white/45" : "text-[#9AA0BB]")}>
                    {peso(base)} base + {peso(perHead)} × {heads}
                  </p>

                  <ul className={cn("mt-5 space-y-2.5", featured && "[&_li]:text-white/85")}>
                    {copy.features.map((f) => (
                      <CheckItem key={f}>{f}</CheckItem>
                    ))}
                  </ul>

                  <a
                    href="/signup"
                    className={cn(
                      "group mt-6 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[14px] font-bold transition-all",
                      featured
                        ? "bg-white text-[#11141F] hover:bg-[#E8EAF3]"
                        : "border border-[#D9DCEC] bg-white text-[#0B0D1A] hover:border-[#11141F] hover:bg-[#11141F] hover:text-white"
                    )}
                  >
                    Start free
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </a>
                </article>
              </Reveal>
            );
          })}
        </div>

        {hasSolo && (
          <Reveal delay={150}>
            <div className="mt-4 flex flex-col items-start justify-between gap-4 rounded-3xl border border-[#E2E4F0] bg-gradient-to-r from-[#E3FAF0]/60 via-white to-[#ECECFF]/60 p-6 sm:flex-row sm:items-center">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#0A8A53]">Solo · Free</p>
                <p className="font-display mt-1 text-[19px] font-extrabold">Self-employed or working independently?</p>
                <p className="mt-0.5 text-[13.5px] text-[#5B6080]">For independent and self-employed use. No employee payroll seat required.</p>
              </div>
              <div className="flex items-center gap-4">
                <p className="font-display text-[26px] font-extrabold">₱0 <span className="text-[13px] font-semibold text-[#7C82A1]">/month</span></p>
                <a href="/signup" className="rounded-full border border-[#D9DCEC] bg-white px-5 py-2.5 text-[13.5px] font-bold shadow-sm transition-all hover:border-[#11141F]">
                  Start Solo
                </a>
              </div>
            </div>
          </Reveal>
        )}

        <Reveal delay={100}>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center text-[13px] font-medium text-[#7C82A1]">
            <span className="inline-flex items-center gap-1.5">
              <span className="flex" aria-label="4.9 out of 5 stars">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-[#FFB020] text-[#FFB020]" aria-hidden />
                ))}
              </span>
              4.9 from payroll teams
            </span>
            <span>No credit card to start</span>
            <span>Cancel anytime</span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
