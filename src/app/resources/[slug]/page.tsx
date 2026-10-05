import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";
import { authorityPage, resourcePages } from "@/lib/seo-content";
import { resourceWave2 } from "@/lib/seo-content-wave2";
import { resourceWave3 } from "@/lib/seo-content-wave3";
import { resourceWave14 } from "@/lib/seo-content-wave14";
import { resourceWave16 } from "@/lib/seo-content-wave16";
import { resourceWave17 } from "@/lib/seo-content-wave17";
import { resourceWave20 } from "@/lib/seo-content-wave20";

const pages = [...resourcePages, ...resourceWave2, ...resourceWave3, ...resourceWave14, ...resourceWave16, ...resourceWave17, ...resourceWave20];

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
    alternates: { canonical: `/resources/${slug}` },
  };
}

export default async function ResourceGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(pages, slug);
  if (!page) notFound();
  const path = `/resources/${slug}`;

  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Resources", path: "/resources" }, { name: page.title, path }]}
        article={{ headline: page.title, description: page.description, path, dateModified: page.lastReviewedIso }}
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
