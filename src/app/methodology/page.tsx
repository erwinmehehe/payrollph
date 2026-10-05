import type { Metadata } from "next";
import { SeoLandingPage } from "@/components/marketing/seo-landing-page";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll Evidence & Content Methodology | Linaw",
  description: "How Linaw separates product evidence, payroll calculations, government filing validation, regulatory updates and customer proof.",
  alternates: { canonical: "/methodology" },
};

export default function MethodologyPage() {
  return (
    <>
      <StructuredData
        breadcrumbs={[{ name: "Home", path: "/" }, { name: "Methodology", path: "/methodology" }]}
        article={{
          headline: "Linaw payroll evidence and content methodology",
          description: "How Linaw separates product evidence, payroll calculations, government filing validation, regulatory updates and customer proof.",
          path: "/methodology",
          dateModified: "2026-10-05",
        }}
      />
      <SeoLandingPage
        eyebrow="Evidence methodology"
        title="How Linaw decides what it can responsibly claim."
        intro="Payroll marketing, compliance guidance and product documentation should not outrun the evidence. Linaw separates implemented product behavior, source-backed payroll guidance, external validation and approved customer proof."
        proof={[
          "Product claims tied to implementation evidence",
          "Calculation kept separate from filing acceptance",
          "Government sources linked on high-risk guidance",
          "Evergreen guides separated from dated updates",
          "Customer outcomes require approval and evidence",
          "Corrections update the canonical page instead of hiding history",
        ]}
        sections={[
          {
            title: "Product claims start with the product",
            body: "A feature should be described as implemented only when there is a working code path, workflow or testable product surface. Partial or externally dependent capabilities stay labelled accordingly.",
          },
          {
            title: "Payroll calculation is not government filing acceptance",
            body: "A system can calculate a statutory value or prepare an output without proving that an agency accepted the submission. Linaw keeps those states separate in both product evidence and public copy.",
          },
          {
            title: "High-stakes guidance points to official sources",
            body: "Payroll, tax and labor guidance should identify the issuing Philippine agency and show a review date. When an official source changes, the evergreen guide is reviewed rather than creating a new permanent URL every year.",
          },
          {
            title: "Dated regulatory updates preserve change history",
            body: "A dated update records what changed, when it was published, the source and which payroll workflow may be affected. Evergreen guides continue to explain the durable concept.",
          },
          {
            title: "Customer proof requires evidence and approval",
            body: "Customer logos, quotes and outcome metrics are not published merely because they sound plausible. A public story needs customer approval plus evidence for any quantified result.",
          },
          {
            title: "Research results need a disclosed methodology",
            body: "Future benchmark reports should publish sample definition, collection period, exclusions, calculation method and limitations alongside any headline finding.",
          },
        ]}
        faq={[
          {
            question: "Does Linaw treat every product feature as fully verified?",
            answer: "No. The capability model distinguishes verified, partial and absent capabilities so an external dependency or unfinished validation step is not presented as complete.",
          },
          {
            question: "Why are regulatory updates separate from evergreen guides?",
            answer: "Evergreen pages should keep stable search intent and current guidance, while dated updates preserve the historical record of a new advisory, rate, deadline or rule change.",
          },
          {
            question: "Can a customer case study be published without quantified evidence?",
            answer: "A qualitative story can be published with customer approval, but any numerical outcome should have a documented source and evidence note before publication.",
          },
          {
            question: "Are public calculators legal or tax advice?",
            answer: "No. Public calculators are planning or educational estimates and their pages explain the inputs, limitations and need to verify the applicable current requirements.",
          },
        ]}
        related={[
          { label: "Trust center", href: "/trust", description: "Review implemented controls and evidence status." },
          { label: "Capability scorecard", href: "/scorecard", description: "See verified, partial and absent product capabilities." },
          { label: "Regulatory updates", href: "/resources/updates", description: "Browse dated Philippine payroll changes and reminders." },
          { label: "Payroll compliance", href: "/compliance", description: "See how calculation and filing validation stay separate." },
          { label: "Security", href: "/security", description: "Inspect repository-evidenced security controls." },
          { label: "Developer center", href: "/developers", description: "Review public API documentation tied to implemented contracts." },
        ]}
      />
    </>
  );
}
