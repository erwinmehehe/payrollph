import type { Metadata } from "next";
import { DemoRolePicker } from "@/components/marketing/demo-role-picker";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Product Demo by Role | Linaw Philippine Payroll",
  description:
    "Explore Linaw as an Owner, HR Admin, Payroll Officer, Checker, Bookkeeper or Employee in a populated Philippine payroll sandbox.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Product Demo by Role | Linaw Philippine Payroll",
    description:
      "Explore Linaw as Owner, HR Admin, Payroll Officer, Checker, Bookkeeper or Employee using populated Philippine payroll sample data.",
    url: "/demo",
  },
  twitter: {
    card: "summary_large_image",
    title: "Product Demo by Role | Linaw Philippine Payroll",
    description:
      "Try the real Linaw workspace with six payroll roles and populated sample data.",
  },
};

export default function DemoPage() {
  return (
    <div className="site">
      <SiteNav />
      <DemoRolePicker />
      <SiteFooter />
    </div>
  );
}
