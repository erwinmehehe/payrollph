import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { regulatoryUpdates } from "@/lib/seo-content-wave3";

export function generateStaticParams() {
  return regulatoryUpdates.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const update = regulatoryUpdates.find((item) => item.slug === slug);
  if (!update) return {};
  return {
    title: update.metaTitle ?? `${update.title} | Linaw`,
    description: update.metaDescription ?? update.summary,
    alternates: { canonical: `/resources/updates/${slug}` },
  };
}

export default async function RegulatoryUpdatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const update = regulatoryUpdates.find((item) => item.slug === slug);
  if (!update) notFound();
  const path = `/resources/updates/${slug}`;

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Resources", path: "/resources" }, { name: "Regulatory updates", path: "/resources/updates" }, { name: update.title, path }]}
        article={{ headline: update.title, description: update.summary, path, datePublished: update.publishedDate, dateModified: update.reviewedDate }}
      />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] py-16 sm:py-20">
          <div className="mx-auto max-w-[900px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">{update.agency}</p>
            <h1 className="font-display mt-4 text-[42px] font-semibold tracking-[-0.045em] sm:text-[54px]">{update.title}</h1>
            <p className="mt-4 text-[12px] font-semibold text-[#8B90AA]">Published {update.publishedDate} · Source reviewed {update.reviewedDate}</p>
            <p className="mt-6 text-[16px] leading-relaxed text-[#5B6080]">{update.summary}</p>
          </div>
        </section>
        <section className="py-14">
          <div className="mx-auto max-w-[900px] px-5 sm:px-8">
            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-[22px] border border-[#E3E5EF] bg-[#FAFBFD] p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">What changed or was reiterated</p>
                <ul className="mt-4 grid gap-3">
                  {update.whatChanged.map((item) => (
                    <li key={item} className="text-[13.5px] leading-relaxed text-[#4F556D]">{item}</li>
                  ))}
                </ul>
              </article>
              <article className="rounded-[22px] border border-[#E3E5EF] bg-white p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#7C82A1]">What payroll teams should check</p>
                <ul className="mt-4 grid gap-3">
                  {update.payrollActions.map((item) => (
                    <li key={item} className="text-[13.5px] leading-relaxed text-[#4F556D]">{item}</li>
                  ))}
                </ul>
              </article>
            </div>

            <h2 className="font-display mt-10 text-[26px] font-semibold">Affected payroll areas</h2>
            <div className="mt-4 flex flex-wrap gap-2">{update.affected.map((item) => <span key={item} className="rounded-full bg-[#F1F1FF] px-3 py-2 text-[12px] font-semibold text-[#0868dc]">{item}</span>)}</div>
            <a href={update.sourceUrl} target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 rounded-full border border-[#D9DCEC] px-5 py-3 text-[13px] font-semibold">Open {update.sourceLabel} <ExternalLink size={13} /></a>
            <h2 className="font-display mt-10 text-[26px] font-semibold">Evergreen guidance</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {update.evergreenLinks.map((item) => <Link key={item.href} href={item.href} className="flex items-center justify-between rounded-[18px] border border-[#E3E5EF] bg-[#FAFBFD] p-4 text-[13px] font-semibold">{item.label}<ArrowRight size={14}/></Link>)}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
