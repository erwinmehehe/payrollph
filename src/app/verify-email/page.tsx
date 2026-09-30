import type { Metadata } from "next";
import VerifyEmailClient from "./verify-email-client";

export const metadata: Metadata = {
  title: "Verify email | Linaw",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? "";

  return (
    <main style={{ minHeight: "100vh", background: "#f7f9f8", padding: "64px 20px" }}>
      <section
        style={{
          maxWidth: 560,
          margin: "0 auto",
          background: "white",
          border: "1px solid #e5ebe8",
          borderRadius: 20,
          padding: 28,
          boxShadow: "0 18px 50px rgba(20, 50, 43, 0.08)",
        }}
      >
        <p style={{ margin: "0 0 8px", color: "#176B5D", fontWeight: 800, fontSize: 13 }}>
          LINAW ACCOUNT SECURITY
        </p>
        <h1 style={{ margin: "0 0 12px", fontSize: 30, letterSpacing: "-0.03em" }}>
          Verify your new email
        </h1>
        <VerifyEmailClient token={token} />
      </section>
    </main>
  );
}
