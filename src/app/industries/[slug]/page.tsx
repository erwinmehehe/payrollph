import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";
import { authorityPage, industryPages } from "@/lib/seo-content";
import { industryWave2 } from "@/lib/seo-content-wave2";
import { industryWave6 } from "@/lib/seo-content-wave6";

const pages = [...industryPages, ...industryWave2, ...industryWave6];

export function generateStaticParams() {
  return pages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = authorityPage(pages, slug);
  if (!page) return {};
  return {
    title: page.metaTitle ?? `${page.title} | Linaw`,
    description: page.description,
    alternates: { canonical: `/industries/${slug}` },
  };
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(pages, slug);
  if (!page) notFound();
  const path = `/industries/${slug}`;

  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Industries", path: "/industries" }, { name: page.title, path }]}
        service={{ name: page.title, description: page.description, path }}
      />
      <SeoLandingPage
        eyebrow={page.eyebrow}
        title={page.title}
        intro={page.intro}
        proof={page.proof}
        sections={page.sections}
        faq={page.faq}
        related={page.related}
        lastReviewed={page.lastReviewed}
        sources={page.sources}
      />
    </>
  );
}
