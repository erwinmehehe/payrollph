import { Suspense } from "react";
import { InviteAcceptForm } from "@/components/invite-accept-form";

export const dynamic = "force-dynamic";

export default function InvitePage() {
  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="brand-mark large">sa</div>
        <p className="eyebrow">LINAW</p>
        <h1>Join your team on Linaw</h1>
        <p>Invitations are single-use, expire in 7 days, and are scoped to the role your admin assigned.</p>
      </section>
      <Suspense fallback={<section className="auth-card"><p className="auth-copy">Loading…</p></section>}>
        <InviteAcceptForm />
      </Suspense>
    </main>
  );
}
