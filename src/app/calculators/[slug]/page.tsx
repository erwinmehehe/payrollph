import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdvancedPayrollCalculator } from "@/components/marketing/advanced-payroll-calculator";
import { PayrollCalculator } from "@/components/marketing/payroll-calculator";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { CALCULATORS, isAdvancedCalculatorSlug, type CalculatorSlug } from "@/lib/calculators";

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

  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll calculators", path: "/calculators" }, { name: item.title, path }]}
        webApplication={{ name: item.title, description: item.description, path }}
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
      </main>
      <SiteFooter />
    </div>
  );
}
