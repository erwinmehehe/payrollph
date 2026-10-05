import "@/components/marketing/claude-home/home.css";
import type { Metadata } from "next";
import { SoftwareHome } from "@/components/marketing/software-home";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines | Payroll System | Linaw",
  description:
    "Philippine payroll software for payroll automation, attendance, SSS, PhilHealth, Pag-IBIG, TRAIN withholding, payslips, approvals and reporting.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <SoftwareHome />;
}
