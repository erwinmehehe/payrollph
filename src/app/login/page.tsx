import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screen";

export const metadata: Metadata = {
  title: "Sign in | Linaw",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ ssoRequired?: string; ssoError?: string }>;
}) {
  const params = await searchParams;
  const initialError = params.ssoRequired
    ? "This workspace requires company single sign-on. Enter your work email and continue with company SSO."
    : params.ssoError
      ? "Company single sign-on was not completed. Try again or contact your workspace administrator."
      : "";

  return <AuthScreen initialError={initialError} />;
}
