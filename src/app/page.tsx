import "@/components/marketing/claude-home/home.css";
import type { Metadata } from "next";
import { SoftwareHome } from "@/components/marketing/software-home";
import { HOMEPAGE_FAQS } from "@/components/marketing/homepage-faqs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines | Payroll System | Linaw",
  description:
    "Philippine payroll software for payroll automation, attendance, SSS, PhilHealth, Pag-IBIG, TRAIN withholding, payslips, approvals and reporting.",
  alternates: { canonical: "/" },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "#organization",
      name: "Linaw",
      description: "Philippine payroll software for controlled, traceable payroll operations.",
      areaServed: { "@type": "Country", name: "Philippines" },
    },
    {
      "@type": "WebSite",
      "@id": "#website",
      name: "Linaw",
      description: "Philippine payroll software for controlled, traceable payroll operations.",
      inLanguage: "en-PH",
      publisher: { "@id": "#organization" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "#software",
      name: "Linaw",
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Payroll Software",
      operatingSystem: "Web",
      provider: { "@id": "#organization" },
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
      "@id": "#faq",
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
