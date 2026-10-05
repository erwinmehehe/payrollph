import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { authorityPage, resourcePages } from "@/lib/seo-content";
import { resourceWave2 } from "@/lib/seo-content-wave2";

const pages = [...resourcePages, ...resourceWave2];

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
  return (
    <SeoLandingPage
      eyebrow={page.eyebrow}
      title={page.title}
      intro={page.intro}
      proof={page.proof}
      sections={page.sections}
      faq={page.faq}
      related={page.related}
    />
  );
}
