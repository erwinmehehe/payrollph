import type { Metadata } from "next";
import { SiteNav, SiteFooter } from "@/components/marketing/site-chrome";
import { VerifySignupForm } from "@/components/marketing/verify-signup-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify account | Linaw", robots: { index: false, follow: false } };

export default async function VerifySignupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#0B0D1A]">
      <SiteNav />
      <main className="px-5 py-20"><VerifySignupForm token={typeof token === "string" ? token : ""} /></main>
      <SiteFooter />
    </div>
  );
}
