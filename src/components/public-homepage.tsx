import { asc } from "drizzle-orm";
import { db } from "@/db";
import { pricingPlans } from "@/db/schema";
import { InteractiveWelcome } from "@/components/interactive-welcome";
import { DemoLaunchButton } from "@/components/demo-launch-button";
import { DEMO_MODE } from "@/db/seed";

export const dynamic = "force-dynamic";

const COMPETITORS = [
  { name: "Linaw", freelancer: "Yes — First-class product", pricing: "Published, in-app live", multiClient: "Native Multi-Client Hub", scale: "8,000 employees in 13.3s (measured)" },
  { name: "Sprout", freelancer: "No", pricing: "Quote-only sales wall", multiClient: "Limited / Separate accounts", scale: "Mid-market focus" },
  { name: "PayrollHero", freelancer: "No", pricing: "Quote-only sales wall", multiClient: "Limited CPA tools", scale: "SME focus" },
  { name: "GreatDay HR", freelancer: "No", pricing: "Quote-only sales wall", multiClient: "Afterthought", scale: "SME focus" },
  { name: "Kazam", freelancer: "No", pricing: "Quote-only sales wall", multiClient: "No", scale: "SME focus" },
];

export async function PublicHomepage() {
  const plans = await db.select().from(pricingPlans).orderBy(asc(pricingPlans.id));

  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <div className="marketing-brand">
          <div className="brand-mark"><span>sa</span></div>
          <strong>linaw</strong>
        </div>
        <div className="marketing-nav-actions">
          <a className="link-button" href="/payroll-outsourcing">Payroll Outsourcing</a>
          {DEMO_MODE && <DemoLaunchButton className="secondary-button" label="Try Live Demo" />}
          <a className="secondary-button" href="/book-demo">Book Demo</a>
          <a className="primary-button" href="/signup">Create Account</a>
          <a className="link-button" href="/login">Sign in</a>
        </div>
      </header>

      {/* Interactive SaaS Experience */}
      <InteractiveWelcome plans={plans} competitors={COMPETITORS} demoMode={DEMO_MODE} />

      {/* Production status — factual, not aspirational */}
      <section className="marketing-section" style={{ marginTop: 44 }}>
        <div className="notice notice-amber" style={{ margin: 0 }}>
          <span>
            <strong>Launch status:</strong> The public sandbox is available for product evaluation. Production payroll rollout still depends on the readiness gates tracked in{" "}
            <a className="link-button" href="/api/readiness">/api/readiness</a> and the capability matrix at{" "}
            <a className="link-button" href="/scorecard">/scorecard</a>.
          </span>
        </div>
      </section>

      <footer className="marketing-footer">
        <div>
          <strong style={{ fontFamily: "var(--font-display), serif", color: "var(--ink)" }}>Linaw</strong> — Philippine payroll &amp; HRIS, from the first freelancer to the ten-thousandth employee.
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <a className="link-button" href="/status">System status</a>
          <a className="link-button" href="/scorecard">Scorecard</a>
          <a className="link-button" href="/signup">Create account</a>
          <a className="link-button" href="/login">Sign in</a>
        </div>
      </footer>
    </main>
  );
}
