import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { authorityPage, compliancePages } from "@/lib/seo-content";

export function generateStaticParams() {
  return compliancePages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = authorityPage(compliancePages, slug);
  if (!page) return {};
  return {
    title: `${page.eyebrow} | Linaw`,
    description: page.description,
    alternates: { canonical: `/compliance/${slug}` },
  };
}

export default async function ComplianceGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(compliancePages, slug);
  if (!page) notFound();
  return (
    <SeoLandingPage
      eyebrow={page.eyebrow}
      title={page.title}
      intro={page.intro}
      proof={page.proof}
      sections={page.sections}
      related={page.related}
      ctaTitle="Use the calculation, then verify the filing workflow."
      ctaBody="Linaw keeps payroll computation and government-output validation separate so the product does not claim more than the evidence supports."
    />
  );
}
