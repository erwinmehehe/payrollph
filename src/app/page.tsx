import "@/components/marketing/claude-home/home.css";
import "@/components/marketing/product-home.css";
import type { Metadata } from "next";
import { SoftwareHome } from "@/components/marketing/software-home";
import { HOMEPAGE_FAQS } from "@/components/marketing/homepage-faqs";
import { absolutePublicUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines | Payroll System PH | Linaw",
  description: "Philippine payroll software for attendance, statutory deductions, TRAIN withholding, approvals, payslips, reporting, audit trails and payroll release.",
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
      description: "Philippine payroll software for controlled, traceable payroll operations.",
      areaServed: { "@type": "Country", name: "Philippines" },
    },
    {
      "@type": "WebSite",
      "@id": absolutePublicUrl("/#website"),
      url: absolutePublicUrl("/"),
      name: "Linaw",
      description: "Philippine payroll software for controlled, traceable payroll operations.",
      inLanguage: "en-PH",
      publisher: { "@id": absolutePublicUrl("/#organization") },
    },
    {
      "@type": "SoftwareApplication",
      "@id": absolutePublicUrl("/#software"),
      url: absolutePublicUrl("/"),
      name: "Linaw",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Payroll Software",
      operatingSystem: "Web",
      provider: { "@id": absolutePublicUrl("/#organization") },
      description:
        "Philippine payroll software with statutory calculations, role-based approvals, employee payslips, attendance workflows and controlled payroll outputs.",
      areaServed: { "@type": "Country", name: "Philippines" },
      featureList: [
        "Philippine payroll calculations",
        "Role-based payroll approvals",
        "Employee payslips",
        "Attendance and workforce scheduling",
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
