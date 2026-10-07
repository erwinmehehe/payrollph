import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { glossaryEntries } from "@/lib/seo-content-wave3";

export function generateStaticParams() {
  return glossaryEntries.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const entry = glossaryEntries.find((item) => item.slug === slug);
  if (!entry) return {};
  return {
    title: `${entry.term} — Payroll Glossary | Linaw`,
    description: entry.metaDescription,
    alternates: { canonical: `/glossary/${slug}` },
  };
}

export default async function GlossaryEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = glossaryEntries.find((item) => item.slug === slug);
  if (!entry) notFound();
  const path = `/glossary/${slug}`;

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll glossary", path: "/glossary" }, { name: entry.term, path }]}
        definedTerm={{ name: entry.term, description: entry.definition, path }}
      />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[900px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Payroll glossary</p>
            <h1 className="font-display mt-4 text-[46px] font-semibold tracking-[-0.045em] sm:text-[58px]">{entry.term}</h1>
            <p className="mt-6 text-[19px] font-medium leading-relaxed text-[#34394F]">{entry.definition}</p>
            <p className="mt-5 text-[15px] leading-relaxed text-[#5B6080]">{entry.explanation}</p>
          </div>
        </section>
        <section className="py-14 sm:py-16">
          <div className="mx-auto grid max-w-[900px] gap-4 px-5 sm:px-8 md:grid-cols-2">
            <article className="rounded-[22px] border border-[#E4E6F0] bg-[#FAFBFD] p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Why it matters in payroll</p>
              <p className="mt-3 text-[14px] leading-relaxed text-[#4F556D]">{entry.whyItMatters}</p>
            </article>
            <article className="rounded-[22px] border border-[#E4E6F0] bg-white p-6">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">Simple example</p>
              <p className="mt-3 text-[14px] leading-relaxed text-[#4F556D]">{entry.example}</p>
            </article>
          </div>
        </section>

        <section className="py-14">
          <div className="mx-auto max-w-[900px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#7C82A1]">Related guidance</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {entry.related.map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-[18px] border border-[#E3E5EF] bg-[#FAFBFD] p-4 text-[13px] font-semibold text-[#34394F]">
                  {item.label}<ArrowRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
