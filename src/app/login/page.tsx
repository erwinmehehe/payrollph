import type { Metadata } from "next";
import { count } from "drizzle-orm";
import { DEMO_MODE } from "@/db/seed";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AuthScreen } from "@/components/auth-screen";
import { publicSignupReady } from "@/lib/saas-launch-config";
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
  let setupAvailable = false;
  let accountStatusUnavailable = false;
  try {
    const [{ value }] = await db.select({ value: count() }).from(users);
    setupAvailable = value === 0;
  } catch {
    // Do not turn the entire sign-in page into a 500 when the account-status
    // query fails. The API still handles authentication and its own errors.
    accountStatusUnavailable = true;
    console.error("login-page: account-status lookup unavailable");
  }
  const initialError = params.ssoRequired
    ? "This workspace requires company single sign-on. Enter your work email and continue with company SSO."
    : params.ssoError
      ? "Company single sign-on was not completed. Try again or contact your workspace administrator."
      : "";

  return (
    <div className="min-h-screen bg-white text-[#0B0D1A]">
      <SiteNav />
      <AuthScreen
        demoMode={DEMO_MODE}
        setupAvailable={setupAvailable}
        registrationAvailable={publicSignupReady()}
        initialError={initialError || (accountStatusUnavailable ? "We couldn't check workspace availability. You can try signing in, or retry later if the service is unavailable." : "")}
      />
    </div>
  );
}
