import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";
import { authorityPage } from "@/lib/seo-content";
import { integrationWave6 } from "@/lib/seo-content-wave6";

export function generateStaticParams() {
  return integrationWave6.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = authorityPage(integrationWave6, slug);
  if (!page) return {};
  return {
    title: page.metaTitle ?? `${page.title} | Linaw`,
    description: page.description,
    alternates: { canonical: `/integrations/${slug}` },
  };
}

export default async function IntegrationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = authorityPage(integrationWave6, slug);
  if (!page) notFound();
  const path = `/integrations/${slug}`;

  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Integrations", path: "/integrations" }, { name: page.title, path }]}
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
      />
    </>
  );
}
