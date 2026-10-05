import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { industryPages } from "@/lib/seo-content";
import { industryWave2 } from "@/lib/seo-content-wave2";
import { industryWave6 } from "@/lib/seo-content-wave6";

const allIndustries = [
  { slug: "bpo", title: "BPO payroll", description: "Night work, rotating schedules, overtime, rest days and controlled release." },
  ...[...industryPages, ...industryWave2, ...industryWave6].map((page) => ({
    slug: page.slug,
    title: page.title,
    description: page.description,
  })),
];
const bySlug = new Map(allIndustries.map((industry) => [industry.slug, industry]));

const industryGroups = [
  {
    title: "Shift-heavy and frontline operations",
    description: "Payroll where schedules, attendance, overtime, night work, weekends and holiday context drive the calculation.",
    slugs: ["bpo", "retail", "healthcare", "hospitality", "manufacturing", "logistics", "shopping-centers"],
  },
  {
    title: "Distributed and field workforces",
    description: "Teams spread across sites, assignments or client locations where employee scope, attendance and recurring roster changes matter.",
    slugs: ["construction", "real-estate", "manpower"],
  },
  {
    title: "Professional and institutional organizations",
    description: "Organizations where client separation, auditability, sensitive access, reporting and role boundaries are central to payroll operations.",
    slugs: ["accounting-firms", "banking-finance", "education", "ngo", "media"],
  },
] as const;

export const metadata: Metadata = {
  title: "Payroll Software by Industry Philippines | Linaw",
  description: "Industry payroll workflows for BPO, construction, logistics, manpower, manufacturing, retail, healthcare, hospitality, finance, education and other Philippine teams.",
  alternates: { canonical: "/industries" },
};

export default function IndustriesPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Industries", path: "/industries" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Industry payroll</p>
            <h1 className="font-display mt-4 max-w-[880px] text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              Payroll workflows shaped by how your workforce actually operates.
            </h1>
            <p className="mt-5 max-w-[790px] text-[16px] leading-relaxed text-[#5B6080]">
              Start with the operating pattern closest to your business: shift-heavy work, distributed field teams, or professional and institutional payroll.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-[1180px] px-5 py-14 sm:px-8 sm:py-18">
          <nav aria-label="Industry groups" className="flex flex-wrap gap-2 border-b border-[#EDEFF7] pb-8">
            {industryGroups.map((group, index) => (
              <a key={group.title} href={`#industry-group-${index + 1}`} className="rounded-full bg-[#F4F5FA] px-4 py-2 text-[12px] font-semibold text-[#4F556D] hover:bg-[#ECECFF] hover:text-[#4A4AE0]">
                {group.title}
              </a>
            ))}
          </nav>

          <div className="divide-y divide-[#EDEFF7]">
            {industryGroups.map((group, index) => (
              <section key={group.title} id={`industry-group-${index + 1}`} className="scroll-mt-24 py-12 sm:py-14">
                <div className="grid gap-5 lg:grid-cols-[.72fr_1.28fr] lg:gap-10">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Operating model {index + 1}</p>
                    <h2 className="font-display mt-2 text-[30px] font-semibold tracking-[-0.035em]">{group.title}</h2>
                    <p className="mt-3 max-w-[430px] text-[14px] leading-relaxed text-[#5B6080]">{group.description}</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {group.slugs.map((slug) => {
                      const item = bySlug.get(slug);
                      if (!item) return null;
                      return (
                        <Link key={item.slug} href={`/industries/${item.slug}`} className="group rounded-[20px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:-translate-y-0.5 hover:border-[#CFCFFF] hover:bg-white">
                          <h3 className="font-display text-[19px] font-semibold leading-snug tracking-[-0.02em]">{item.title}</h3>
                          <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-[#6B718C]">{item.description}</p>
                          <span className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#4A4AE0]">Explore industry <ArrowRight size={13} /></span>
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
