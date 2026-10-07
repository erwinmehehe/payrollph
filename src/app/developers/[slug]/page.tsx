import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";
import { developerDoc, developerDocs } from "@/lib/developer-docs";

export function generateStaticParams() {
  return developerDocs.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = developerDoc(slug);
  if (!doc) return {};
  return {
    title: doc.metaTitle ?? `${doc.title} | Linaw Developers`,
    description: doc.metaDescription ?? doc.description,
    alternates: { canonical: `/developers/${slug}` },
  };
}

export default async function DeveloperDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = developerDoc(slug);
  if (!doc) notFound();
  const path = `/developers/${slug}`;

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Developers", path: "/developers" }, { name: doc.title, path }]}
        article={{ headline: doc.title, description: doc.description, path, dateModified: "2026-10-05" }}
      />
      <SiteNav />
      <main>
        <section className="border-b border-[#EDEFF7] bg-[#FAFBFD] py-16 sm:py-20">
          <div className="mx-auto max-w-[980px] px-5 sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0877ff]">Developer documentation</p>
            <h1 className="font-display mt-4 text-[44px] font-semibold tracking-[-0.045em] sm:text-[58px]">{doc.title}</h1>
            <p className="mt-5 max-w-[760px] text-[16px] leading-relaxed text-[#5B6080]">{doc.intro}</p>
          </div>
        </section>
        <section className="py-14 sm:py-16">
          <div className="mx-auto grid max-w-[980px] gap-5 px-5 sm:px-8">
            {doc.sections.map((section) => (
              <article key={section.title} className="rounded-[22px] border border-[#E3E5EF] bg-white p-6">
                <h2 className="font-display text-[24px] font-semibold">{section.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-[#5B6080]">{section.body}</p>
                {section.bullets ? (
                  <ul className="mt-4 grid gap-2 text-[13px] text-[#34394F]">
                    {section.bullets.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                ) : null}
                {section.code ? (
                  <pre className="mt-5 overflow-x-auto rounded-[16px] bg-[#11141F] p-4 text-[12px] leading-relaxed text-white/85"><code>{section.code}</code></pre>
                ) : null}
              </article>
            ))}
          </div>
        </section>
        <section className="border-y border-[#EDEFF7] bg-[#FAFBFD] py-12">
          <div className="mx-auto grid max-w-[980px] gap-3 px-5 sm:grid-cols-3 sm:px-8">
            {doc.related.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-[18px] border border-[#E3E5EF] bg-white p-4">
                <strong className="text-[14px]">{item.label}</strong>
                <p className="mt-2 text-[12px] leading-relaxed text-[#6B718C]">{item.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0868dc]">Open <ArrowRight size={12}/></span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
