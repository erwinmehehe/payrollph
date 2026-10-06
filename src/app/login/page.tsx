import type { Metadata } from "next";
import { count } from "drizzle-orm";
import { DEMO_MODE } from "@/db/seed";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AuthScreen } from "@/components/auth-screen";
import { SiteNav } from "@/components/marketing/site-chrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | Linaw",
  description: "Sign in to your Linaw Philippine payroll workspace.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ ssoRequired?: string; ssoError?: string }>;
}) {
  const params = await searchParams;
  const [{ value }] = await db.select({ value: count() }).from(users);
  const initialError = params.ssoRequired
    ? "This workspace requires company single sign-on. Enter your work email and continue with company SSO."
    : params.ssoError
      ? "Company single sign-on was not completed. Try again or contact your workspace administrator."
      : "";

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <AuthScreen demoMode={DEMO_MODE} setupAvailable={value === 0} initialError={initialError} />
    </div>
  );
}
