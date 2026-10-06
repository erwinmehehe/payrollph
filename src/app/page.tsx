import "@/components/marketing/claude-home/home.css";
import type { Metadata } from "next";
import { SoftwareHome } from "@/components/marketing/software-home";

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
      "@type": "WebSite",
      name: "Linaw",
      description: "Philippine payroll software for controlled, traceable payroll operations.",
      inLanguage: "en-PH",
    },
    {
      "@type": "SoftwareApplication",
      name: "Linaw",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
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
