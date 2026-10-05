import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { industryPages } from "@/lib/seo-content";
import { industryWave2 } from "@/lib/seo-content-wave2";
import { industryWave6 } from "@/lib/seo-content-wave6";

const allIndustries = [
  { slug: "bpo", title: "BPO payroll", description: "Night work, rotating schedules, overtime, rest days and controlled release." },
  ...[...industryPages, ...industryWave2, ...industryWave6].map((page) => ({ slug: page.slug, title: page.title, description: page.description })),
];

export const metadata: Metadata = {
  title: "Payroll Software by Industry Philippines | Linaw",
  description: "Industry payroll workflows for BPO, construction, manpower, manufacturing, retail, healthcare, hospitality, finance, education, real estate and other Philippine teams.",
  alternates: { canonical: "/industries" },
};

export default function IndustriesPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Industry payroll</p>
            <h1 className="font-display mt-4 max-w-[850px] text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              Payroll workflows built around the way different Philippine teams actually work.
            </h1>
          </div>
        </section>
        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1180px] gap-4 px-5 sm:px-8 md:grid-cols-2">
            {allIndustries.map((item) => (
              <Link key={item.slug} href={`/industries/${item.slug}`} className="group rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6 transition hover:-translate-y-0.5 hover:border-[#CFCFFF]">
                <h2 className="font-display text-[24px] font-semibold tracking-[-0.03em]">{item.title}</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{item.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#4A4AE0]">Explore industry <ArrowRight size={14} /></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
