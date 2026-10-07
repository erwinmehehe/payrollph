import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { glossaryEntries } from "@/lib/seo-content-wave3";

export const metadata: Metadata = {
  title: "Philippine Payroll Glossary | Linaw",
  description: "Plain-English definitions for Philippine payroll terms including gross pay, net pay, taxable compensation, withholding tax, MSC, annualization and more.",
  alternates: { canonical: "/glossary" },
};

export default function GlossaryPage() {
  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll glossary", path: "/glossary" }]} />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Payroll glossary</p>
            <h1 className="font-display mt-4 max-w-[850px] text-[44px] font-semibold tracking-[-0.045em] sm:text-[58px]">Philippine payroll terms in plain English.</h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">Use the glossary to understand the terms used throughout payroll calculations, compliance guides and implementation workflows.</p>
          </div>
        </section>
        <section className="py-16">
          <div className="mx-auto grid max-w-[1180px] gap-4 px-5 sm:px-8 md:grid-cols-2 lg:grid-cols-3">
            {glossaryEntries.map((entry) => (
              <Link key={entry.slug} href={`/glossary/${entry.slug}`} className="rounded-[22px] border border-[#E4E6F0] bg-[#FAFBFD] p-5 transition hover:border-[#b7d6ff]">
                <h2 className="font-display text-[21px] font-semibold">{entry.term}</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[#5B6080]">{entry.definition}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#0868dc]">Read definition <ArrowRight size={13} /></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
