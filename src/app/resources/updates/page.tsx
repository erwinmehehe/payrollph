import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { regulatoryUpdates } from "@/lib/seo-content-wave3";

export const metadata: Metadata = {
  title: "Philippine Payroll Regulatory Updates Archive | Linaw",
  description: "Dated Philippine payroll regulatory updates with official sources and links back to evergreen payroll guidance.",
  alternates: { canonical: "/resources/updates" },
};

export default function RegulatoryUpdatesPage() {
  const updates = [...regulatoryUpdates].sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Resources", path: "/resources" }, { name: "Regulatory updates", path: "/resources/updates" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1000px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Regulatory update archive</p>
            <h1 className="font-display mt-4 text-[44px] font-semibold tracking-[-0.045em] sm:text-[58px]">Dated payroll updates, separate from evergreen guidance.</h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">Each update records the issuing agency, publication date, source and affected payroll workflow so permanent guide pages do not become stale annual URLs.</p>
          </div>
        </section>
        <section className="py-14">
          <div className="mx-auto grid max-w-[1000px] gap-4 px-5 sm:px-8">
            {updates.map((update) => (
              <Link key={update.slug} href={`/resources/updates/${update.slug}`} className="rounded-[22px] border border-[#E3E5EF] bg-[#FAFBFD] p-6 transition hover:border-[#b7d6ff]">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#7C82A1]">{update.agency} · {update.publishedDate}</p>
                <h2 className="font-display mt-2 text-[23px] font-semibold">{update.title}</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-[#5B6080]">{update.summary}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-[12.5px] font-semibold text-[#0868dc]">Read update <ArrowRight size={13} /></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
