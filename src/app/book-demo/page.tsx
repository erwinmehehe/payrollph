import type { Metadata } from "next";
import { Check, Inbox, ShieldCheck } from "lucide-react";
import { BookDemoForm } from "@/components/marketing/book-demo-form";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { activeMailProvider, deliveryCapable } from "@/lib/mail-provider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book a Linaw demo",
  description: "Walk through Philippine payroll, approvals and exports against your own headcount and entity structure.",
};

export default function BookDemoPage() {
  const provider = activeMailProvider();
  const canDeliver = deliveryCapable();

  return (
    <div className="site">
      <SiteNav />

      <section className="section" style={{ borderBottom: 0 }}>
        <div className="site-shell">
          <div className="split">
            <div>
              <p className="eyebrow">Book a demo</p>
              <h1
                style={{
                  margin: "8px 0 0",
                  fontSize: "clamp(28px, 3.6vw, 40px)",
                  lineHeight: 1.12,
                  letterSpacing: "-0.04em",
                  fontWeight: 750,
                }}
              >
                Bring your actual payroll.
              </h1>
              <p className="section-copy">
                The useful version of this call is not a slide deck. Send your headcount, your entity structure and one
                thing that currently goes wrong at cutoff, and we will walk through it in the workspace, including the
                parts that are still labelled DRAFT.
              </p>

              <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
                {[
                  "A semi-monthly run end to end: prepare, approve, release, export",
                  "How an incomplete punch becomes an exception instead of invented hours",
                  "Switching between client companies and what tenant isolation actually blocks",
                  "What the government worksheets contain and why they are not a filing yet",
                ].map((line) => (
                  <div key={line} style={{ display: "flex", gap: 9, alignItems: "flex-start", color: "var(--ink-secondary)", fontSize: 13.5 }}>
                    <Check size={16} style={{ color: "var(--brand)", flex: "none", marginTop: 2 }} />
                    <span>{line}</span>
                  </div>
                ))}
              </div>

              {canDeliver ? (
                <div className="notice notice-green" style={{ marginTop: 24 }}>
                  <ShieldCheck size={15} />
                  <span>
                    This deployment sends mail through <span className="mono">{provider}</span>, so your request reaches us
                    directly.
                  </span>
                </div>
              ) : (
                <div className="notice notice-amber" style={{ marginTop: 24 }}>
                  <Inbox size={15} />
                  <span>
                    <strong>Before you fill this in:</strong> this deployment has no email provider configured, so a request
                    is recorded in the outbox rather than emailed to anyone. If you want to see the product right now, the{" "}
                    <a className="link-button" href="/welcome#preview">
                      workspace preview
                    </a>{" "}
                    works immediately.
                  </span>
                </div>
              )}
            </div>

            <BookDemoForm />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
