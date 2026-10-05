import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdvancedPayrollCalculator } from "@/components/marketing/advanced-payroll-calculator";
import { PayrollCalculator } from "@/components/marketing/payroll-calculator";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { CALCULATOR_GUIDES, CALCULATORS, isAdvancedCalculatorSlug, type CalculatorSlug } from "@/lib/calculators";

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
  return { title: `${item.title} | Linaw`, description: item.description, alternates: { canonical: `/calculators/${slug}` } };
}

export default async function CalculatorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const typedSlug = slug as CalculatorSlug;
  const item = CALCULATORS[typedSlug];
  if (!item) notFound();
  const path = `/calculators/${slug}`;
  const related = relatedByCalculator[typedSlug] ?? [];
  const guide = CALCULATOR_GUIDES[typedSlug];

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
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Payroll calculator</p>
            <h1 className="font-display mt-4 text-[42px] font-semibold tracking-[-0.045em] sm:text-[54px]">{item.title}</h1>
            <p className="mt-4 max-w-[760px] text-[15px] leading-relaxed text-[#5B6080]">{item.intro}</p>
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
          <div className="mx-auto grid max-w-[980px] gap-5 px-5 sm:px-8 lg:grid-cols-2">
            <article className="rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6 sm:p-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">How this estimate works</p>
              <h2 className="font-display mt-2 text-[25px] font-semibold tracking-[-0.03em]">Follow the calculation path.</h2>
              <ol className="mt-5 grid gap-3">
                {guide.steps.map((step, index) => (
                  <li key={step} className="flex gap-3 text-[13.5px] leading-relaxed text-[#4A5068]">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#EEEEFF] text-[11px] font-bold text-[#4A4AE0]">{index + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
            </article>

            <article className="rounded-[24px] border border-[#E4E6F0] bg-white p-6 sm:p-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Before you use the result</p>
              <h2 className="font-display mt-2 text-[25px] font-semibold tracking-[-0.03em]">Verify the payroll context.</h2>
              <ul className="mt-5 grid gap-3">
                {guide.verify.map((item) => (
                  <li key={item} className="flex gap-3 text-[13.5px] leading-relaxed text-[#4A5068]">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#12B76A]" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section className="border-t border-[#EDEFF7] bg-[#FAFBFD] py-14 sm:py-16">
          <div className="mx-auto max-w-[880px] px-5 sm:px-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Calculator questions</p>
            <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">What to know before relying on the estimate.</h2>
            <div className="mt-7 divide-y divide-[#E2E4EC] border-y border-[#E2E4EC]">
              {guide.faq.map((item) => (
                <article key={item.question} className="py-5">
                  <h3 className="text-[15px] font-semibold text-[#171A27]">{item.question}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-[#5B6080]">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {related.length ? (
          <section className="border-t border-[#EDEFF7] bg-white py-12 sm:py-14">
            <div className="mx-auto max-w-[980px] px-5 sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Use the estimate in context</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {related.map((link) => (
                  <Link key={link.href} href={link.href} className="rounded-[20px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:border-[#CFCFFF]">
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
