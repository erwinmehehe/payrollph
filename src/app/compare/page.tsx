import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

const comparisons = [
  { title: "Salarium alternative", href: "/resources/salarium-alternative", description: "Compare employee records, timekeeping, statutory outputs, payroll controls, integrations and implementation using current official evidence." },
  { title: "Sprout Payroll alternative", href: "/resources/sprout-payroll-alternative", description: "Compare product scope, payroll controls, compliance workflow, integrations and implementation using current public evidence." },
  { title: "Payroll system comparison", href: "/resources/payroll-system-comparison", description: "Use one evaluation matrix for calculations, controls, implementation, integrations, security and evidence." },
  { title: "HRIS vs payroll system", href: "/resources/hris-vs-payroll-system", description: "Compare employee-information workflows with payroll calculation, compliance and release responsibilities." },
  { title: "Payroll software vs outsourcing", href: "/resources/payroll-software-vs-outsourcing", description: "Compare operating ownership, staffing, approvals and exception handling." },
  { title: "Manual / Excel payroll vs software", href: "/resources/payroll-software-vs-excel", description: "Compare spreadsheet flexibility with controlled payroll workflow, approvals and repeatability." },
  { title: "Cloud vs on-premise payroll", href: "/resources/cloud-vs-on-premise-payroll", description: "Compare infrastructure, updates, access and continuity responsibilities." },
  { title: "Build vs buy payroll software", href: "/resources/build-vs-buy-payroll-software", description: "Compare permanent internal engineering ownership with purchasing a dedicated platform." },
];

export const metadata: Metadata = {
  title: "Payroll Software Comparisons Philippines | Linaw",
  description: "Compare Philippine payroll systems, HRIS, outsourcing, spreadsheets, cloud vs on-premise deployment and build-vs-buy operating models.",
  alternates: { canonical: "/compare" },
};

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll comparisons", path: "/compare" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1000px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Payroll comparisons</p>
            <h1 className="font-display mt-4 text-[44px] font-semibold tracking-[-0.045em] sm:text-[58px]">Compare the operating model, not just the feature list.</h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">These guides focus on ownership, controls, implementation and recurring work rather than declaring one option universally right for every employer.</p>
          </div>
        </section>
        <section className="py-16">
          <div className="mx-auto grid max-w-[1000px] gap-4 px-5 sm:px-8 md:grid-cols-2">
            {comparisons.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-[22px] border border-[#E3E5EF] bg-[#FAFBFD] p-6 transition hover:border-[#CFCFFF]">
                <h2 className="font-display text-[23px] font-semibold">{item.title}</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{item.description}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-[12.5px] font-semibold text-[#4A4AE0]">Compare options <ArrowRight size={13}/></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
