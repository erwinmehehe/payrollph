import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { resourcePages } from "@/lib/seo-content";
import { resourceWave2 } from "@/lib/seo-content-wave2";
import { resourceWave3 } from "@/lib/seo-content-wave3";
import { resourceWave14 } from "@/lib/seo-content-wave14";
import { resourceWave16 } from "@/lib/seo-content-wave16";

const resources = [...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16];

export const metadata: Metadata = {
  title: "Philippine Payroll Guides & Buyer Resources | Linaw",
  description: "Philippine payroll guides for software buying, migration, compliance, operations, security, outsourcing decisions and payroll teams.",
  alternates: { canonical: "/resources" },
};

export default function ResourcesPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Resources", path: "/resources" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#6161FF]">Payroll resources</p>
            <h1 className="font-display mt-4 max-w-[900px] text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[58px]">
              Practical guidance for buying, migrating and operating Philippine payroll.
            </h1>
            <p className="mt-5 max-w-[780px] text-[16px] leading-relaxed text-[#5B6080]">
              Use evergreen payroll guides for permanent concepts, calculators for estimates, and the regulatory-update archive for dated government changes.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/resources/updates" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Regulatory updates</Link>
              <Link href="/glossary" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Payroll glossary</Link>
              <Link href="/calculators" className="rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Calculators</Link>
            </div>
          </div>
        </section>
        <section className="py-16 sm:py-20">
          <div className="mx-auto grid max-w-[1180px] gap-4 px-5 sm:px-8 md:grid-cols-2">
            {resources.map((page) => (
              <Link key={page.slug} href={`/resources/${page.slug}`} className="group rounded-[24px] border border-[#E4E6F0] bg-[#FAFBFD] p-6 transition hover:-translate-y-0.5 hover:border-[#CFCFFF]">
                <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[#7C82A1]">{page.eyebrow}</p>
                <h2 className="font-display mt-2 text-[24px] font-semibold tracking-[-0.03em]">{page.title}</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{page.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-[13px] font-semibold text-[#4A4AE0]">Read guide <ArrowRight size={14} /></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
