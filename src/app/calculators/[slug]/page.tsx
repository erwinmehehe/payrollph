import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PayrollCalculator } from "@/components/marketing/payroll-calculator";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { CALCULATORS, type CalculatorSlug } from "@/lib/calculators";

const relatedByCalculator: Partial<Record<CalculatorSlug, Array<{ label: string; href: string; copy: string }>>> = {
  "13th-month-pay": [
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review the payroll-rule context around premium and mandatory pay treatment." },
    { label: "Payroll software", href: "/", copy: "See how payroll calculations move through review and release." },
  ],
  "overtime-pay": [
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review overtime, rest-day and holiday premium context." },
    { label: "Time & attendance", href: "/time-and-attendance", copy: "See how worked time becomes payroll evidence." },
  ],
  "night-differential": [
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review night differential and premium-day payroll context." },
    { label: "Time & attendance", href: "/time-and-attendance", copy: "See how night minutes are derived from time ranges." },
  ],
  "holiday-pay": [
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review regular, special and rest-day premium context." },
    { label: "Retail payroll", href: "/industries/retail", copy: "See how holiday work fits a branch-heavy payroll workflow." },
  ],
  "sss-contribution": [
    { label: "SSS payroll compliance", href: "/compliance/sss", copy: "Review employee, employer and EC contribution handling." },
  ],
  "philhealth-contribution": [
    { label: "PhilHealth payroll compliance", href: "/compliance/philhealth", copy: "Review contribution bases, shares and validation controls." },
  ],
  "pag-ibig-contribution": [
    { label: "Pag-IBIG payroll compliance", href: "/compliance/pag-ibig", copy: "Review contribution timing, employer shares and validation controls." },
  ],
  "withholding-tax": [
    { label: "BIR payroll compliance", href: "/compliance/bir", copy: "Review withholding, annualization and filing-validation separation." },
  ],
  "payroll-cost": [
    { label: "Payroll pricing", href: "/pricing", copy: "Compare employer payroll cost with the current product plan catalog." },
    { label: "Payroll software ROI", href: "/resources/payroll-software-roi", copy: "Evaluate recurring payroll cost beyond subscription price." },
  ],
};

export function generateStaticParams() {
  return Object.keys(CALCULATORS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = CALCULATORS[slug as CalculatorSlug];
  if (!item) return {};
  return { title: `${item.title} | Linaw`, description: item.description, alternates: { canonical: `/calculators/${slug}` } };
}

export default async function CalculatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const calculatorSlug = slug as CalculatorSlug;
  const item = CALCULATORS[calculatorSlug];
  if (!item) notFound();
  const related = relatedByCalculator[calculatorSlug] ?? [];
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-white py-14 sm:py-16">
          <div className="mx-auto max-w-[980px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Payroll calculator</p>
            <h1 className="font-display mt-4 text-[42px] font-semibold tracking-[-0.045em] sm:text-[54px]">{item.title}</h1>
            <p className="mt-4 max-w-[760px] text-[15px] leading-relaxed text-[#5B6080]">{item.intro}</p>
          </div>
        </section>
        <section className="py-12 sm:py-16"><div className="mx-auto max-w-[980px] px-5 sm:px-8"><PayrollCalculator slug={calculatorSlug}/></div></section>
        {related.length ? (
          <section className="border-t border-[#EDEFF7] bg-white py-12 sm:py-14">
            <div className="mx-auto max-w-[980px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Use the estimate in context</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {related.map((item) => (
                  <Link key={item.href} href={item.href} className="rounded-[20px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:border-[#CFCFFF]">
                    <strong className="text-[14px] font-semibold text-[#11141F]">{item.label}</strong>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{item.copy}</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
