import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { MonthlyTaxCalculator } from "@/components/marketing/monthly-tax-calculator";
import { StructuredData } from "@/components/marketing/structured-data";
import { CALCULATORS, type CalculatorSlug } from "@/lib/calculators";

const calculatorGroups: Array<{
  title: string;
  description: string;
  slugs: CalculatorSlug[];
}> = [
  {
    title: "Pay, time and final-pay estimates",
    description: "Estimate common employee pay components and rate conversions using explicit day, hour and payroll-basis inputs.",
    slugs: ["13th-month-pay", "overtime-pay", "night-differential", "holiday-pay", "final-pay", "daily-rate", "hourly-rate"],
  },
  {
    title: "Statutory contribution estimates",
    description: "Estimate employee and employer statutory shares using the same contribution helpers used by the product.",
    slugs: ["sss-contribution", "philhealth-contribution", "pag-ibig-contribution"],
  },
  {
    title: "Tax and employer-cost planning",
    description: "Estimate monthly withholding, core employer payroll cost and the operating-cost difference between in-house and managed payroll.",
    slugs: ["withholding-tax", "payroll-cost", "payroll-outsourcing-roi"],
  },
];

export const metadata: Metadata = {
  title: "Payroll Calculators Philippines | SSS, Tax & OT | Linaw",
  description: "Philippine payroll calculators for 13th-month pay, overtime, night differential, SSS, PhilHealth, Pag-IBIG and withholding tax using shared rule helpers.",
  alternates: { canonical: "/calculators" },
};

export default function CalculatorsPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll calculators", path: "/calculators" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Philippine payroll calculators</p>
            <h1 className="font-display mt-4 max-w-[860px] text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              Start with the payroll question you need to estimate.
            </h1>
            <p className="mt-5 max-w-[780px] text-[16px] leading-relaxed text-[#5B6080]">
              These tools are educational estimates, not filing or legal advice. Where Linaw already has tested payroll logic, the public calculator reuses the same rule helper instead of maintaining a separate marketing formula.
            </p>
          </div>
        </section>

        <section className="linaw-company"><h2 className="text-3xl font-semibold">Monthly withholding tax, made clearer.</h2><MonthlyTaxCalculator/><Link href="/calculators/withholding-tax" className="text-[#0877ff] text-sm">Review the calculation context and official source ↗</Link></section>
        <div className="mx-auto max-w-[1180px] px-5 py-14 sm:px-8 sm:py-18">
          <nav aria-label="Calculator groups" className="flex flex-wrap gap-2 border-b border-[#EDEFF7] pb-8">
            {calculatorGroups.map((group, index) => (
              <a key={group.title} href={`#calculator-group-${index + 1}`} className="rounded-full bg-[#F4F5FA] px-4 py-2 text-[12px] font-semibold text-[#4F556D] hover:bg-[#e5f0ff] hover:text-[#0868dc]">
                {group.title}
              </a>
            ))}
          </nav>

          <div className="divide-y divide-[#EDEFF7]">
            {calculatorGroups.map((group, index) => (
              <section key={group.title} id={`calculator-group-${index + 1}`} className="scroll-mt-24 py-12 sm:py-14">
                <div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr] lg:gap-10">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Calculator group {index + 1}</p>
                    <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">{group.title}</h2>
                    <p className="mt-3 max-w-[430px] text-[14px] leading-relaxed text-[#5B6080]">{group.description}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.slugs.map((slug) => {
                      const item = CALCULATORS[slug];
                      return (
                        <Link key={slug} href={`/calculators/${slug}`} className="group rounded-[20px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:-translate-y-0.5 hover:border-[#b7d6ff] hover:bg-white">
                          <h3 className="font-display text-[19px] font-semibold leading-snug tracking-[-0.02em]">{item.title}</h3>
                          <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{item.description}</p>
                          <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#0868dc]">Open calculator <ArrowRight size={13} /></span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
