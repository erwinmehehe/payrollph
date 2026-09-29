import type { Metadata } from "next";
import { DemoRolePicker } from "@/components/marketing/demo-role-picker";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Product Demo by Role | Linaw Philippine Payroll",
  description:
    "Explore Linaw as an Owner, HR Admin, Payroll Officer, Checker or Employee in a populated Philippine payroll sandbox.",
  alternates: { canonical: "/demo" },
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
