import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { CALCULATORS } from "@/lib/calculators";

export const metadata: Metadata = {
  title: "Payroll Calculators Philippines | SSS, Tax & OT | Linaw",
  description: "Philippine payroll calculators for 13th-month pay, overtime, night differential, SSS, PhilHealth, Pag-IBIG and withholding tax using shared rule helpers.",
  alternates: { canonical: "/calculators" },
};

export default function CalculatorsPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Philippine payroll calculators</p>
            <h1 className="font-display mt-4 max-w-[850px] text-[44px] font-semibold tracking-[-0.045em] sm:text-[58px]">Useful payroll estimates built from the same rule helpers as the product.</h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">These tools are educational estimates, not filing or legal advice. They intentionally share Linaw payroll functions where the product already has tested rule logic.</p>
          </div>
        </section>
        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1180px] gap-4 px-5 sm:px-8 md:grid-cols-2">
            {Object.entries(CALCULATORS).map(([slug, item]) => (
              <Link key={slug} href={`/calculators/${slug}`} className="group rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6 transition hover:-translate-y-0.5 hover:border-[#CFCFFF]">
                <h2 className="font-display text-[24px] font-semibold">{item.title}</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{item.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#4A4AE0]">Open calculator <ArrowRight size={14}/></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
