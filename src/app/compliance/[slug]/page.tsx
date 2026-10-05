import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";
import { authorityPage, compliancePages } from "@/lib/seo-content";
import { complianceWave3 } from "@/lib/seo-content-wave3";

const pages = [...compliancePages, ...complianceWave3];

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
    alternates: { canonical: `/compliance/${slug}` },
  };
}

export default async function ComplianceGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(pages, slug);
  if (!page) notFound();
  const path = `/compliance/${slug}`;

  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Payroll compliance", path: "/compliance" }, { name: page.title, path }]}
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
        ctaTitle="Use the calculation, then verify the filing workflow."
        ctaBody="Linaw keeps payroll computation and government-output validation separate so the product does not claim more than the evidence supports."
      />
    </>
  );
}
