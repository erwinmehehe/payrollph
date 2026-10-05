import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { authorityPage, resourcePages } from "@/lib/seo-content";

export function generateStaticParams() {
  return resourcePages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = authorityPage(resourcePages, slug);
  if (!page) return {};
  return {
    title: `${page.eyebrow} | Linaw`,
    description: page.description,
    alternates: { canonical: `/resources/${slug}` },
  };
}

export default async function ResourceGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(resourcePages, slug);
  if (!page) notFound();
  return (
    <SeoLandingPage
      eyebrow={page.eyebrow}
      title={page.title}
      intro={page.intro}
      proof={page.proof}
      sections={page.sections}
      related={page.related}
    />
  );
}
