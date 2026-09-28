import type { Metadata } from "next";
import { DemoRolePicker } from "@/components/marketing/demo-role-picker";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const metadata: Metadata = {
  title: "Product Demo by Role | Linaw Philippine Payroll",
  description:
    "Explore Linaw from the perspective of an owner, bookkeeper, payroll administrator, HR administrator, manager, employee or freelancer.",
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
