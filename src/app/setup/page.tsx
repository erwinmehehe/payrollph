import type { Metadata } from "next";
import { needsSetup } from "@/app/api/setup/route";
import { SetupWizard } from "@/components/setup-wizard";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up Linaw",
  description: "Create the first owner account for an empty Linaw workspace.",
  alternates: { canonical: "/setup" },
  robots: { index: false, follow: false },
};

export default async function SetupPage() {
  return (
    <div className="marketing-page min-h-screen bg-white text-[#101323]">
      <SiteNav />
      <SetupWizard needsSetup={await needsSetup()} />
      <SiteFooter />
    </div>
  );
}
