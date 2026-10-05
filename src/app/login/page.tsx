import type { Metadata } from "next";
import { DEMO_MODE } from "@/db/seed";
import { AuthScreen } from "@/components/auth-screen";
import { SiteNav } from "@/components/marketing/site-chrome";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | Linaw",
  description: "Sign in to your Linaw Philippine payroll workspace.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const [{ value }] = await db.select({ value: count() }).from(users);

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <AuthScreen demoMode={DEMO_MODE} setupAvailable={value === 0} />
    </div>
  );
}
