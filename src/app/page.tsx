import "@/components/marketing/claude-home/home.css";
import "@/components/marketing/product-home.css";
import type { Metadata } from "next";
import { SoftwareHome } from "@/components/marketing/software-home";
import { HOMEPAGE_FAQS } from "@/components/marketing/homepage-faqs";
import { absolutePublicUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines | Payroll System PH | Linaw",
  description: "Philippine payroll software connects HRIS, WFM and HCM. Manage employee records, attendance, statutory calculations, approvals and audit trails.",
  alternates: { canonical: "/" },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": absolutePublicUrl("/#organization"),
      url: absolutePublicUrl("/"),
      name: "Linaw",
      description: "Philippine payroll, HRIS, workforce management and HCM workflows, connected through governed employee data.",
      areaServed: { "@type": "Country", name: "Philippines" },
    },
    {
      "@type": "WebSite",
      "@id": absolutePublicUrl("/#website"),
      url: absolutePublicUrl("/"),
      name: "Linaw",
      description: "Philippine payroll, HRIS, workforce management and HCM workflows, connected through governed employee data.",
      inLanguage: "en-PH",
      publisher: { "@id": absolutePublicUrl("/#organization") },
    },
    {
      "@type": "SoftwareApplication",
      "@id": absolutePublicUrl("/#software"),
      url: absolutePublicUrl("/"),
      name: "Linaw",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Payroll, HRIS, WFM and HCM Software",
      operatingSystem: "Web",
      provider: { "@id": absolutePublicUrl("/#organization") },
      description:
        "Philippine payroll and people operations software connecting employee records, attendance, statutory calculations, workforce schedules and governed HCM workflows.",
      areaServed: { "@type": "Country", name: "Philippines" },
      featureList: [
        "Philippine payroll calculations",
        "Role-based payroll approvals",
        "Employee payslips",
        "Attendance and workforce scheduling",
        "Employee lifecycle and HRIS workflows",
        "Performance management and workforce planning",
        "Accounting exports",
        "Draft government payroll worksheets",
      ],
    },
    {
      "@type": "FAQPage",
      "@id": absolutePublicUrl("/#faq"),
      mainEntity: HOMEPAGE_FAQS.map((faq) => ({
        "@type": "Question",
        name: faq.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: faq.a,
        },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema).replace(/</g, "\\u003c") }}
      />
      <SoftwareHome />
    </>
  );
}
