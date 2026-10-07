import "@/components/marketing/claude-home/app-product-preview.css";
import type { Metadata } from "next";
import { DemoRolePicker } from "@/components/marketing/demo-role-picker";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StructuredData } from "@/components/marketing/structured-data";

export const metadata: Metadata = {
  title: "Payroll Software Demo Philippines | Live Linaw Demo",
  description:
    "Explore the live Linaw payroll software demo with Owner, HR Admin, Payroll Officer, Checker, Bookkeeper and Employee roles using populated sample data.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Payroll Software Demo Philippines | Live Linaw Demo",
    description:
      "Explore the live Linaw payroll software demo using populated Philippine payroll sample data across six payroll roles.",
    url: "/demo",
  },
  twitter: {
    card: "summary_large_image",
    title: "Payroll Software Demo Philippines | Live Linaw Demo",
    description:
      "Try the real Linaw workspace with six payroll roles and populated sample data.",
  },
};

export default function DemoPage() {
  return (
    <div className="site">
      <StructuredData breadcrumbs={[{ name: "Home", path: "/" }, { name: "Live payroll demo", path: "/demo" }]} />
      <SiteNav />
      <DemoRolePicker />
      <SiteFooter />
    </div>
  );
}
