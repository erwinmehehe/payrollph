import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/reset-password-form";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="brand-mark large">sa</div>
        <p className="eyebrow">LINAW</p>
        <h1>Set a new password</h1>
        <p>Reset tokens are single-use, expire in 30 minutes, and are stored only as a hash.</p>
      </section>
      <Suspense fallback={<section className="auth-card"><p className="auth-copy">Loading…</p></section>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
