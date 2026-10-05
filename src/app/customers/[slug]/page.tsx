import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";
import { PUBLISHABLE_CUSTOMER_STORIES } from "@/lib/customer-stories";

const approvedStories = PUBLISHABLE_CUSTOMER_STORIES;

export function generateStaticParams() {
  return approvedStories.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const story = approvedStories.find((item) => item.slug === slug);
  if (!story) return { robots: { index: false, follow: false } };

  return {
    title: `${story.customerName} Payroll Customer Story | Linaw`,
    description: story.outcome,
    alternates: { canonical: `/customers/${slug}` },
    robots: { index: true, follow: true },
  };
}

export default async function CustomerStoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const story = approvedStories.find((item) => item.slug === slug);
  if (!story) notFound();

  const approvedQuote = story.quote;
  const metricProof = story.metrics.map((metric) => `${metric.label}: ${metric.value}`);

  return (
    <>
      <StructuredData
        breadcrumbs={[
          { name: "Home", path: "/" },
          { name: "Customer stories", path: "/customers" },
          { name: story.customerName, path: `/customers/${story.slug}` },
        ]}
        article={{
          headline: `${story.customerName} payroll customer story`,
          description: story.outcome,
          path: `/customers/${story.slug}`,
        }}
      />
      <SeoLandingPage
        eyebrow={`${story.industry} customer story`}
        title={story.customerName}
        intro={story.challenge}
        proof={metricProof.length > 0 ? metricProof : ["Customer-approved implementation story"]}
        sections={[
          { title: "The challenge", body: story.challenge },
          { title: "What was implemented", body: story.implementation },
          { title: "Outcome", body: story.outcome },
          ...(approvedQuote
            ? [{ title: `Customer perspective — ${approvedQuote.speaker}, ${approvedQuote.role}`, body: approvedQuote.text }]
            : []),
        ]}
        related={[
          { label: "Evidence methodology", href: "/methodology", description: "See how customer outcomes and claims are reviewed before publication." },
          { label: "Trust center", href: "/trust", description: "Review evidence-backed product capabilities." },
          { label: "Payroll software", href: "/", description: "Explore the payroll workflow described by the product." },
        ]}
      />
    </>
  );
}
