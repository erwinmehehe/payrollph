import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Calculator, Check, ShieldCheck } from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const dynamic = "force-dynamic";

const faq = [
  {
    question: "How is Linaw payroll software pricing calculated?",
    answer:
      "Each active plan comes from Linaw's persisted pricing catalog and can include a monthly base amount plus a per-employee amount. The pricing page calculates examples from those live values rather than maintaining separate marketing prices.",
  },
  {
    question: "Is the price shown on this page the same source used by the product?",
    answer:
      "Yes. The page loads active plans from the pricing_plans catalog. If the catalog changes, the public pricing page changes with it instead of relying on hard-coded brochure prices.",
  },
  {
    question: "Does the published price include every possible implementation or service cost?",
    answer:
      "No. Published software pricing covers the configured plan values. Migration assistance, managed payroll, custom integration work or other scoped services should be confirmed separately when they are needed.",
  },
  {
    question: "Can I try Linaw before moving real payroll data?",
    answer:
      "Yes. The public role-based demo uses sample data, and dedicated trial workspaces are provisioned through controlled access so you can evaluate the workflow before uploading production payroll information.",
  },
  {
    question: "Which plan should a growing payroll team choose?",
    answer:
      "Choose based on workflow complexity rather than headcount alone. Core fits simpler payroll operations, Scale adds stronger review and multi-branch controls, and Enterprise is intended for organizations that need more advanced access, integration or support requirements.",
  },
];

const planPositioning: Record<string, { label: string; fit: string; note: string }> = {
  Solo: {
    label: "Independent use",
    fit: "For self-employed or non-employee payroll use cases",
    note: "A zero-base plan in the current catalog. It is not positioned as a substitute for an employer payroll workspace.",
  },
  Core: {
    label: "Core payroll",
    fit: "For one Philippine payroll team with a straightforward operating model",
    note: "Start here when payroll, attendance and statutory calculations are the main requirement.",
  },
  Scale: {
    label: "Growing operations",
    fit: "For payroll teams that need stronger review, multi-branch control and approvals",
    note: "Best when the operating model has more handoffs, locations or control requirements.",
  },
  Enterprise: {
    label: "Complex organizations",
    fit: "For larger or more complex payroll environments",
    note: "Intended for advanced access, integration, migration and support requirements.",
  },
};

function peso(value: string | number) {
  return `₱${Number(value).toLocaleString("en-PH")}`;
}

function planModules(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export const metadata: Metadata = {
  title: "Payroll Software Pricing Philippines | Plans & Costs | Linaw",
  description: "See Linaw payroll software pricing for Philippine businesses, with current plan details, controlled trial access, live demo options and payroll outsourcing.",
  alternates: { canonical: "/pricing" },
};

export default async function PricingPage() {
  const plans = await getPublicPricingPlans();

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Payroll software pricing", path: "/pricing" },
        ]}
        webApplication={{
          name: "Linaw Payroll Software",
          description:
            "Philippine payroll software with role-based approvals, payroll calculations, attendance workflows and controlled payroll outputs.",
          path: "/",
        }}
        faq={faq}
      />

      <SiteNav />

      <main>
        <section className="relative overflow-hidden border-b border-[#EDEFF7] py-16 sm:py-20">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -right-40 -top-52 h-[620px] w-[700px] rounded-full bg-gradient-to-br from-[#ECECFF] via-[#EAF4FF] to-[#E3FAF0] opacity-75 blur-3xl" />
          </div>

          <div className="relative mx-auto grid max-w-[1180px] gap-9 px-5 sm:px-8 lg:grid-cols-[1fr_.72fr] lg:items-end">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">
                Payroll software pricing Philippines
              </p>
              <h1 className="font-display mt-4 max-w-[820px] text-balance text-[44px] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[60px]">
                Published payroll pricing without the mystery quote.
              </h1>
              <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">
                Plan values below come from the same persisted pricing catalog used by Linaw. Compare the base fee,
                per-employee amount, included modules and the operating model each plan is designed to support.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="/trial" className="rounded-full bg-[#6161FF] px-6 py-3.5 text-[14px] font-semibold text-white">
                  Request trial access
                </Link>
                <Link
                  href="/demo"
                  className="inline-flex items-center gap-2 rounded-full border border-[#D9DCEC] bg-white px-6 py-3.5 text-[14px] font-semibold"
                >
                  Try live demo <ArrowRight size={14} />
                </Link>
              </div>
            </div>

            <aside className="rounded-[24px] border border-[#E2E4F0] bg-white/90 p-5 shadow-[0_18px_60px_-42px_rgba(30,34,70,.45)] backdrop-blur">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECECFF] text-[#4A4AE0]">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">Pricing source</p>
                  <p className="mt-1 text-[14px] font-semibold text-[#25293A]">Live product catalog</p>
                </div>
              </div>
              <p className="mt-4 text-[13px] leading-relaxed text-[#5B6080]">
                These are not copied brochure figures. Active plans are read from the same pricing configuration the
                application uses, including the current catalog version.
              </p>
            </aside>
          </div>
        </section>

        <section className="py-14 sm:py-16">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => {
                const modules = planModules(plan.modules);
                const positioning = planPositioning[plan.name] ?? {
                  label: "Payroll plan",
                  fit: "For a Philippine payroll workflow",
                  note: "Review the active modules and current catalog pricing below.",
                };
                const base = Number(plan.monthlyBase);
                const perEmployee = Number(plan.perEmployee);
                const exampleHeads = 25;
                const exampleTotal = base + perEmployee * exampleHeads;

                return (
                  <article
                    key={plan.id}
                    className="flex h-full flex-col rounded-[24px] border border-[#E2E4F0] bg-[#FAFBFD] p-6"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#7C82A1]">{positioning.label}</p>
                    <h2 className="font-display mt-2 text-[26px] font-semibold tracking-[-0.03em]">{plan.name}</h2>
                    <p className="mt-2 min-h-[44px] text-[13px] leading-relaxed text-[#5B6080]">{positioning.fit}</p>

                    <div className="my-5 h-px bg-[#E6E8F0]" />

                    <p className="text-[12px] font-semibold text-[#7C82A1]">Published monthly pricing</p>
                    <p className="mt-1 font-display text-[31px] font-semibold tracking-[-0.035em]">
                      {peso(plan.monthlyBase)}
                      <span className="text-[12px] font-medium text-[#7C82A1]"> base</span>
                    </p>
                    <p className="mt-1 text-[13px] text-[#5B6080]">
                      + {peso(plan.perEmployee)} per employee
                    </p>

                    <div className="mt-5 rounded-2xl border border-[#E6E8F0] bg-white p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">
                        Example at {exampleHeads} employees
                      </p>
                      <p className="mt-1 font-display text-[22px] font-semibold">{peso(exampleTotal)} / month</p>
                    </div>

                    {modules.length ? (
                      <div className="mt-5">
                        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8B90AA]">Included modules</p>
                        <ul className="mt-3 grid gap-2.5">
                          {modules.map((module) => (
                            <li key={module} className="flex gap-2 text-[12.5px] leading-relaxed text-[#34394F]">
                              <Check size={14} className="mt-0.5 shrink-0 text-[#0A8A53]" />
                              {module}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <p className="mt-5 text-[12px] leading-relaxed text-[#6B718C]">{positioning.note}</p>
                    <p className="mt-auto pt-5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#A0A5B8]">
                      Catalog version {plan.version}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[1080px] px-5 sm:px-8">
            <div className="grid gap-8 lg:grid-cols-[.72fr_1.28fr]">
              <div>
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ECECFF] text-[#4A4AE0]">
                  <Calculator size={18} />
                </span>
                <h2 className="font-display mt-4 text-[31px] font-semibold tracking-[-0.035em]">
                  How to read the price.
                </h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">
                  The software catalog uses a transparent pricing formula. The final commercial scope can still depend
                  on migration, managed payroll or custom integration work outside the published software plan.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ["1", "Monthly base", "The fixed monthly amount configured for the active plan."],
                  ["2", "Per employee", "The configured employee amount is added for the headcount covered by the plan."],
                  ["3", "Scoped services", "Migration, managed payroll or custom work is confirmed separately when required."],
                ].map(([step, title, body]) => (
                  <article key={step} className="rounded-[20px] border border-[#E2E4F0] bg-white p-5">
                    <span className="text-[11px] font-bold text-[#6161FF]">0{step}</span>
                    <h3 className="font-display mt-2 text-[19px] font-semibold">{title}</h3>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{body}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-[920px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Pricing FAQ</p>
            <h2 className="font-display mt-2 text-[34px] font-semibold tracking-[-0.035em] sm:text-[42px]">
              Questions to settle before choosing a plan.
            </h2>

            <div className="mt-8 divide-y divide-[#E6E8F0] border-y border-[#E6E8F0]">
              {faq.map((item) => (
                <article key={item.question} className="py-6">
                  <h3 className="font-display text-[19px] font-semibold tracking-[-0.02em]">{item.question}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#5B6080]">{item.answer}</p>
                </article>
              ))}
            </div>

            <div className="mt-9 flex flex-col gap-4 rounded-[26px] bg-[#11141F] p-7 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-[24px] font-semibold">See the workflow before choosing a plan.</h2>
                <p className="mt-2 max-w-[620px] text-[13.5px] leading-relaxed text-white/60">
                  Start with the sample-data demo, then request a controlled workspace if you want to evaluate your own operating model.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2.5">
                <Link href="/demo" className="rounded-full bg-white px-5 py-3 text-[13.5px] font-semibold text-[#11141F]">
                  Try live demo
                </Link>
                <Link href="/trial" className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-[13.5px] font-semibold text-white">
                  Request trial
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
