import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { authorityPage, industryPages } from "@/lib/seo-content";

export function generateStaticParams() {
  return industryPages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = authorityPage(industryPages, slug);
  if (!page) return {};
  return {
    title: page.metaTitle ?? `${page.title} | Linaw`,
    description: page.description,
    alternates: { canonical: `/industries/${slug}` },
  };
}

export default async function IndustryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(industryPages, slug);
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
