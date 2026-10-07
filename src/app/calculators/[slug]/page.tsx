import { MonthlyTaxPage } from "@/components/marketing/monthly-tax-page";
import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { AdvancedPayrollCalculator } from "@/components/marketing/advanced-payroll-calculator";
import { PayrollCalculator } from "@/components/marketing/payroll-calculator";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import {
  CALCULATORS,
  CALCULATOR_GUIDES,
  CALCULATOR_LAST_REVIEWED,
  CALCULATOR_SOURCES,
  isAdvancedCalculatorSlug,
  type CalculatorSlug,
} from "@/lib/calculators";

const relatedByCalculator: Partial<Record<CalculatorSlug, Array<{ label: string; href: string; copy: string }>>> = {
  "13th-month-pay": [
    { label: "13th-month pay guide", href: "/resources/13th-month-pay-philippines", copy: "Review the statutory base, timing, proration and separation context behind the estimate." },
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review the wider pay-rule context and official-source discipline." },
  ],
  "overtime-pay": [
    { label: "Overtime pay guide", href: "/resources/overtime-pay-philippines", copy: "Review day type, worked-time evidence, approvals and premium context behind the estimate." },
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review overtime, rest-day and holiday premium rules in the wider compliance workflow." },
  ],
  "night-differential": [
    { label: "Night differential guide", href: "/resources/night-differential-philippines", copy: "Review covered hours, overtime overlap and premium-day context behind the estimate." },
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review the wider statutory payroll context for night work and premium pay." },
  ],
  "holiday-pay": [
    { label: "Holiday pay guide", href: "/resources/holiday-pay-philippines", copy: "Review regular, special, rest-day and attendance context behind the estimate." },
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review premium-pay rules in the wider Philippine payroll compliance workflow." },
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
    { label: "Withholding tax compliance", href: "/compliance/withholding-tax", copy: "Review taxable compensation, payroll-frequency tables and annualization context." },
    { label: "Payroll annualization", href: "/resources/payroll-annualization", copy: "See how regular payroll withholding is reconciled at year-end." },
  ],
  "payroll-cost": [
    { label: "Payroll pricing", href: "/pricing", copy: "Compare employer payroll cost with the current product plan catalog." },
    { label: "Payroll software ROI", href: "/resources/payroll-software-roi", copy: "Evaluate recurring payroll cost beyond subscription price." },
  ],
  "final-pay": [
    { label: "Final pay guide", href: "/resources/final-pay-philippines", copy: "Review timing, known components and the closeout controls around final pay." },
    { label: "13th-month pay guide", href: "/resources/13th-month-pay-philippines", copy: "Review the prorated 13th-month component that can appear in final pay." },
  ],
  "daily-rate": [
    { label: "DOLE payroll guide", href: "/compliance/dole", copy: "Review wage and premium-pay context before choosing a divisor." },
    { label: "Payroll implementation", href: "/implementation", copy: "Document the employer-specific payroll basis during migration and setup." },
  ],
  "hourly-rate": [
    { label: "Overtime pay guide", href: "/resources/overtime-pay-philippines", copy: "See why the hourly basis matters when pricing overtime." },
    { label: "Night differential guide", href: "/resources/night-differential-philippines", copy: "Use the hourly basis in the wider night-work payroll context." },
  ],
  "payroll-outsourcing-roi": [
    { label: "Payroll software vs outsourcing", href: "/resources/payroll-software-vs-outsourcing", copy: "Compare the operating models before relying on the cost estimate." },
    { label: "Payroll outsourcing", href: "/payroll-outsourcing", copy: "See the managed payroll workflow and approval model." },
  ],
};

export function generateStaticParams() {
  return Object.keys(CALCULATORS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const item = CALCULATORS[slug as CalculatorSlug];
  if (!item) return {};
  const guide = CALCULATOR_GUIDES[slug as CalculatorSlug];
  return { title: guide.metaTitle, description: item.description, alternates: { canonical: `/calculators/${slug}` } };
}

export default async function CalculatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === "withholding-tax") return <MonthlyTaxPage />;
  const typedSlug = slug as CalculatorSlug;
  const item = CALCULATORS[typedSlug];
  if (!item) notFound();
  const path = `/calculators/${slug}`;
  const guide = CALCULATOR_GUIDES[typedSlug];
  const related = relatedByCalculator[typedSlug] ?? [];
  const sources = CALCULATOR_SOURCES[typedSlug] ?? [];

  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll calculators", path: "/calculators" }, { name: item.title, path }]}
        webApplication={{ name: item.title, description: item.description, path }}
        faq={guide.faq}
      />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-white py-14 sm:py-16">
          <div className="mx-auto max-w-[980px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Payroll calculator</p>
            <h1 className="font-display mt-4 text-[42px] font-semibold tracking-[-0.045em] sm:text-[54px]">{item.title}</h1>
            <p className="mt-4 max-w-[760px] text-[15px] leading-relaxed text-[#5B6080]">{item.intro}</p>
            <p className="mt-3 text-[11.5px] font-medium text-[#8B90AA]">
              Last reviewed: {CALCULATOR_LAST_REVIEWED}
            </p>
          </div>
        </section>
        <section className="py-12 sm:py-16">
          <div className="mx-auto max-w-[980px] px-5 sm:px-8">
            {isAdvancedCalculatorSlug(typedSlug)
              ? <AdvancedPayrollCalculator slug={typedSlug} />
              : <PayrollCalculator slug={typedSlug} />}
          </div>
        </section>
        <section className="border-t border-[#EDEFF7] bg-white py-14 sm:py-16">
          <div className="mx-auto grid max-w-[980px] gap-5 px-5 sm:px-8 lg:grid-cols-[1.05fr_.95fr]">
            <article className="rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6 sm:p-7">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">How this estimate works</p>
              <h2 className="font-display mt-2 text-[27px] font-semibold tracking-[-0.03em]">Understand the inputs before you use the result.</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">{guide.howItWorks}</p>
            </article>
            <article className="rounded-[24px] border border-[#E4E6F0] bg-white p-6 sm:p-7">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Assumptions and limits</p>
              <ul className="mt-4 grid gap-3">
                {guide.assumptions.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13.5px] leading-relaxed text-[#4A5068]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0877ff]" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="border-t border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[860px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Common questions</p>
            <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">Use the estimate in the right payroll context.</h2>
            <div className="mt-7 divide-y divide-[#E2E4EC] border-y border-[#E2E4EC]">
              {guide.faq.map((item) => (
                <article key={item.question} className="py-5">
                  <h3 className="text-[15px] font-semibold text-[#202435]">{item.question}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-[#5B6080]">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {sources.length ? (
          <section className="border-t border-[#EDEFF7] bg-white py-12 sm:py-14">
            <div className="mx-auto max-w-[980px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Official references</p>
              <p className="mt-2 max-w-[760px] text-[13px] leading-relaxed text-[#6B718C]">
                These official references are used to review the public estimate. The calculator remains an educational
                tool and does not replace employer review, agency filing, remittance or legal advice.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                {sources.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-[#DFE2EC] bg-[#FAFBFD] px-4 py-2.5 text-[12px] font-semibold text-[#34394F]"
                  >
                    {source.label} <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {related.length ? (
          <section className="border-t border-[#EDEFF7] bg-white py-12 sm:py-14">
            <div className="mx-auto max-w-[980px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Use the estimate in context</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {related.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-[20px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:border-[#b7d6ff]">
                    <strong className="text-[14px] font-semibold text-[#11141F]">{link.label}</strong>
                    <p className="mt-2 text-[12.5px] leading-relaxed text-[#6B718C]">{link.copy}</p>
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
