import type { Metadata } from "next";
import { ArrowUpRight, Building2, CalendarDays, FileSpreadsheet, LockKeyhole, ShieldCheck } from "lucide-react";
import { buildCapabilityReport } from "@/lib/capabilities";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { AudiencePicker } from "@/components/marketing/audience-picker";
import { CapabilityGrid } from "@/components/marketing/capability-grid";
import { HeroActions } from "@/components/marketing/hero-actions";
import { PricingTable } from "@/components/marketing/pricing-table";
import { BenchmarksSection, DevelopersSection, FaqSection, SecuritySection } from "@/components/marketing/proof-sections";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StatutoryLab } from "@/components/marketing/statutory-lab";
import { TrustStrip } from "@/components/marketing/trust-strip";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payroll Software Philippines | HRIS & Payroll System | Linaw",
  description:
    "Philippine payroll software for payroll automation, HRIS, attendance, SSS, PhilHealth, Pag-IBIG, TRAIN withholding, payslips, approvals and reporting.",
  alternates: { canonical: "/" },
};

/**
 * Competitor positioning.
 *
 * These columns are OUR READING of each vendor's public marketing, not measured
 * behaviour, and the table says so. The Linaw column is the only one backed by
 * code inspection.
 */
const COMPETITORS = [
  { name: "Linaw", freelancer: "First-class product", pricing: "Published, in-app", multiClient: "Native multi-client hub", filing: "DRAFT worksheets only" },
  { name: "Sprout", freelancer: "No", pricing: "Quote on request", multiClient: "Separate accounts", filing: "Certified filing" },
  { name: "PayrollHero", freelancer: "No", pricing: "Quote on request", multiClient: "Limited CPA tooling", filing: "Certified filing" },
  { name: "GreatDay HR", freelancer: "No", pricing: "Quote on request", multiClient: "Limited", filing: "Certified filing" },
  { name: "Kazam", freelancer: "No", pricing: "Quote on request", multiClient: "No", filing: "Certified filing" },
];

export default async function HomePage() {
  // Sequential rather than Promise.all: getPublicPricingPlans() runs inside a
  // transaction (it bootstraps default rows under an advisory lock on an
  // empty table), and a low PG_POOL_MAX deployment, the README documents this
  // for pgBouncer/serverless, should not have to hold that transaction open
  // while a second unrelated query queues behind it for the same connection.
  const plans = await getPublicPricingPlans();
  const report = await buildCapabilityReport();

  const demoEnabled = process.env.DEMO_MODE === "true";

  return (
    <div className="site">
      <SiteNav />

      {/* ------------------------------------------------------------- hero */}
      <section className="hero">
        <div className="hero-glow" aria-hidden />
        <div className="hero-inner">
          <div className="site-shell">
            <div className="hero-copy">
              <span className="pill">
                <i aria-hidden />
                NCR wage order <span className="mono">WO-NCR-26</span> · ₱695/day is already in the engine
              </span>

              <h1>
                Payroll that
                <br />
                shows{" "}
                <span className="accent">
                  its work
                  <svg viewBox="0 0 200 12" fill="none" preserveAspectRatio="none" aria-hidden>
                    <path
                      d="M2 8.5C36 4 74 2.5 112 3.5c26 .7 56 2.5 86 5.5"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                .
              </h1>

              <p className="hero-sub">
                Linaw is the Philippine HR and payroll workspace where every peso has a trace. Clock-derived hours,
                tested statutory formulas, and prepare, approve, release and export as four separately authorised
                steps.
              </p>

              <HeroActions demoEnabled={demoEnabled} />

              <div className="hero-facts">
                <span>
                  <ShieldCheck size={14} className="i-green" /> SSS, PhilHealth, Pag-IBIG and TRAIN computed server-side
                </span>
                <span>
                  <ShieldCheck size={14} className="i-green" /> Every figure traceable to the rule that produced it
                </span>
                <span>
                  <ShieldCheck size={14} className="i-green" /> Published pricing, no quote wall
                </span>
              </div>

              <AudiencePicker />
            </div>
          </div>

          {/* Full-width visual composition */}
          <div className="hero-visual">
            <div className="site-shell" style={{ position: "relative" }}>
              <WorkspacePreview mode="focused" />
              <Reveal className="hero-float" delay={200} style={{ left: -14, bottom: -18 }}>
                <span className="feature-icon" style={{ margin: 0, width: 34, height: 34 }} aria-hidden>
                  <ShieldCheck size={16} className="i-green" />
                </span>
                <span>
                  <strong>Cross-tenant access</strong>
                  <span className="mono">covered by a build-blocking test</span>
                </span>
              </Reveal>
              <Reveal className="hero-float b" delay={320} style={{ right: -10, top: -16 }}>
                <span className="feature-icon" style={{ margin: 0, width: 34, height: 34 }} aria-hidden>
                  <FileSpreadsheet size={16} className="i-teal" />
                </span>
                <span>
                  <strong>BDO DAT validated</strong>
                  <span className="mono">dry-run before file output</span>
                </span>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <TrustStrip />

      {/* -------------------------------------------------------- simulation */}
      {/* Anchor id matches SiteNav's "Product" link (/#simulation) and the
          book-demo / signup pages' link to this section. */}
      <section className="section" id="simulation">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Playable preview</p>
            <h2>Run payroll. Try to break it.</h2>
            <p>
              Switch tabs, open a payslip, acknowledge the exception, release the run. It is a simulation with sample
              people, but the contributions and withholding are computed by the product&apos;s own rule engine, so the
              arithmetic you see is the arithmetic you would get.
            </p>
          </Reveal>
          <WorkspacePreview mode="interactive" />
        </div>
      </section>

      {/* ---------------------------------------------------------- payroll */}
      <section className="section alt" id="payroll">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Payroll engine</p>
            <h2>Drag a salary. Watch every deduction explain itself.</h2>
            <p>
              Hours are derived from raw punches; contributions come from versioned statutory tables; premiums stack in
              the order the labour rules require. Move the slider and you are running the same functions a real payroll
              run calls.
            </p>
          </Reveal>

          <div className="split">
            <div>
              <div className="feature-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
                {[
                  {
                    icon: <ShieldCheck size={17} className="i-green" />,
                    t: "Statutory computation",
                    d: "SSS under RA 11199, PhilHealth under RA 11223, Pag-IBIG under RA 9679, and withholding under the TRAIN brackets, including the minimum-wage-earner exemption cascading through the whole entry.",
                  },
                  {
                    icon: <ShieldCheck size={17} className="i-cyan" />,
                    t: "Hours you can defend",
                    d: "Tardiness, undertime, overtime at 125% and night differential at +10% are derived from punch pairs. A missing punch derives zero hours and raises an exception, it is never filled in with an assumed time.",
                  },
                  {
                    icon: <ShieldCheck size={17} className="i-green" />,
                    t: "Wage orders and advisories",
                    d: "Regional DOLE wage orders set the floor a rate is checked against, holiday multipliers stack against the 2026 calendar, and an active calamity advisory applies its premium and prints its advisory number on the payslip.",
                  },
                ].map((card, index) => (
                  <Reveal key={card.t} delay={index * 80} className="feature-card">
                    <span className="feature-icon" aria-hidden>
                      {card.icon}
                    </span>
                    <h3>{card.t}</h3>
                    <p>{card.d}</p>
                    <span className="status status-verified">Unit-tested</span>
                  </Reveal>
                ))}
              </div>
            </div>
            <Reveal delay={120}>
              <StatutoryLab />
            </Reveal>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- workflow */}
      {/* Anchor id matches SiteNav's "How it works" link (/#workflow). */}
      <section className="section" id="workflow">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">The workspace</p>
            <h2>Built for the person who runs payroll for more than one company.</h2>
            <p>
              Complexity is opt-in. A freelancer sees a planner and their own filings. A bookkeeper sees a portfolio of
              client businesses, each one isolated from the others by the server, not by the menu.
            </p>
          </Reveal>

          <div className="bento">
            <Reveal className="feature-card wide">
              <span className="feature-icon" aria-hidden>
                <ShieldCheck size={17} className="i-teal" />
              </span>
              <h3>Multi-client workspaces with real isolation</h3>
              <p>
                Switch client and every query is re-scoped. Each session route passes through one shared membership
                gate, and routes addressed by a record id resolve that record&apos;s own organization rather than
                trusting the id in the URL, so substituting another tenant&apos;s id returns 403, not their payroll.
              </p>
              <ul>
                <li>Department-scoped roles narrow queries on the server, and the directory says when it is scoped</li>
                <li>Cross-tenant access attempts are covered by a test that fails the build if the gate is dropped</li>
              </ul>
              <span className="status status-verified">Verified</span>
            </Reveal>

            {[
              {
                icon: <ShieldCheck size={17} className="i-amber" />,
                t: "Approvals that survive a holiday",
                d: "Date-bounded, revocable delegation means an out-of-office approver is not a blocked payroll. A delegate's decision records who decided, who they decided for, and the whole chain.",
              },
              {
                icon: <ShieldCheck size={17} className="i-purple" />,
                t: "Employee self-service",
                d: "Staff see their own YTD gross, net and tax, their per-period line items, and a downloadable PDF payslip. Every query filters on the session's employee id, never a parameter from the page, so a colleague's payslip is simply unreachable.",
              },
            ].map((card) => (
              <Reveal key={card.t} className="feature-card">
                <span className="feature-icon" aria-hidden>
                  {card.icon}
                </span>
                <h3>{card.t}</h3>
                <p>{card.d}</p>
                <span className="status status-verified">Verified</span>
              </Reveal>
            ))}

            <Reveal className="feature-card">
              <span className="feature-icon" aria-hidden>
                <FileSpreadsheet size={17} className="i-teal" />
              </span>
              <h3>Bank files and government worksheets</h3>
              <p>
                Versioned generators for BDO DAT and BPI / UnionBank / GCash CSV, with a dry-run validation pass before
                any file that looks submittable. Journals export to Xero and QuickBooks Online.
              </p>
              <p style={{ marginTop: 10 }}>
                Government output, 1601-C, Alphalist/2316, SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF, is generated from
                real figures but is <strong>not</strong> validated against the agencies&apos; own import tools, so every
                file is labelled DRAFT.
              </p>
              <span className="status status-draft-only">Draft only</span>
            </Reveal>

            <Reveal className="feature-card">
              <span className="feature-icon" aria-hidden>
                <FileSpreadsheet size={17} className="i-teal" />
              </span>
              <h3>Onboarding from the spreadsheet you already have</h3>
              <p>
                The importer tolerates your column order and extra columns, parses <span className="mono">₱ 28,000.00</span>{" "}
                correctly, reports row-level errors specifically, and updates in place on re-upload instead of creating
                duplicates.
              </p>
              <span className="status status-verified">Verified</span>
            </Reveal>
          </div>

          <div className="persona-strip" style={{ marginTop: 22 }}>
            {[
              { t: "Freelancer", d: "8% flat versus graduated comparison, voluntary contributions, and nothing else in the way." },
              { t: "Small team", d: "One payroll, semi-monthly, with approvals and self-service switched on when you want them." },
              { t: "Multi-branch company", d: "Org units, department-scoped access, and payroll scoped to a branch or cost centre." },
              { t: "Bookkeeping practice", d: "A portfolio of client companies in one workspace, each isolated server-side." },
            ].map((persona, index) => (
              <Reveal key={persona.t} delay={index * 60} className="persona-chip">
                <strong>{persona.t}</strong>
                <span>{persona.d}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- benchmarks */}
      <section className="section alt">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Measured, not assumed</p>
            <h2>8,000 employees in about 13 seconds.</h2>
          </Reveal>
          <BenchmarksSection />
        </div>
      </section>

      {/* --------------------------------------------------------- security */}
      <section className="section" id="security">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Security</p>
            <h2>Controls that return 403, not a tooltip.</h2>
            <p>Every rule below is checked on the server and covered by a test that fails the build if it regresses.</p>
          </Reveal>
          <SecuritySection />
        </div>
      </section>

      {/* ------------------------------------------------------------ proof */}
      <section className="section alt" id="proof">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Proof, not adjectives</p>
            <h2>What is verified, what is partial, and what is not built.</h2>
            <p>
              This table is generated from this deployment&apos;s code and database. It lists{" "}
              <strong>{report.counts.verified} verified</strong>, <strong>{report.counts.partial} partial</strong> and{" "}
              <strong>{report.counts.absent} not built</strong>, because a payroll product that overstates itself is worse
              than one that is honest about its gaps.
            </p>
          </Reveal>

          <CapabilityGrid capabilities={report.capabilities} counts={report.counts} />

          <div className="section-head" style={{ marginTop: 56, marginBottom: 20 }}>
            <p className="eyebrow">Positioning</p>
            <h2>How we read the alternatives.</h2>
            <p>
              Competitor columns are our reading of each vendor&apos;s public positioning, not independently verified
              behaviour. The one row where they are ahead of us is the one we put first among the gaps: certified
              government filing.
            </p>
          </div>

          <div className="card table-card">
            <div className="data-table-wrap slim-scroll">
              <table className="data-table parity-table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Freelancer product</th>
                    <th>Pricing</th>
                    <th>Multi-client</th>
                    <th>Government filing</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPETITORS.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <strong style={{ color: "var(--ink)", fontWeight: 700 }}>{row.name}</strong>
                        {row.name === "Linaw" && (
                          <small style={{ display: "block", marginTop: 2, color: "var(--muted)" }}>code-inspected</small>
                        )}
                      </td>
                      <td>{row.freelancer}</td>
                      <td>{row.pricing}</td>
                      <td>{row.multiClient}</td>
                      <td>{row.filing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                Sprout, PayrollHero, GreatDay HR and Kazam columns reflect public marketing as we read it and may be out of
                date. We do not claim to have tested their products.
              </span>
            </div>
          </div>

          <div className="notice notice-amber" style={{ marginTop: 22 }} id="status">
            <ShieldCheck size={16} className="i-green" />
            <span>
              <strong>Production status:</strong> the payroll engine, workspace, approvals, self-service, API and exports
              run on the request path. Four gates remain, each blocked on a third-party credential or account rather than
              on code: an email provider, a payment processor, live bank submission, and certified government filing. See
              the live gate-by-gate list at <a className="link-button" href="/api/readiness">/api/readiness</a> and the full
              matrix at <a className="link-button" href="/scorecard">/scorecard</a>.
            </span>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ devs */}
      <section className="section alt" id="developers">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Developers</p>
            <h2>Plug payroll into the rest of your stack.</h2>
          </Reveal>
          <DevelopersSection />
        </div>
      </section>

      {/* ---------------------------------------------------------- pricing */}
      <section className="section" id="pricing">
        <div className="site-shell">
          <Reveal className="section-head">
            <p className="eyebrow">Pricing</p>
            <h2>Know what payroll will cost before you talk to anyone.</h2>
            <p>
              No quote wall. Set your headcount and every plan recalculates from its stored base and per-employee rate.
            </p>
          </Reveal>
          <PricingTable plans={plans} />
        </div>
      </section>

      {/* -------------------------------------------------------------- faq */}
      <section className="section alt" id="faq">
        <div className="site-shell" style={{ maxWidth: 820 }}>
          <Reveal className="section-head" style={{ textAlign: "center", margin: "0 auto 34px" }}>
            <p className="eyebrow">Questions</p>
            <h2>Everything teams ask before switching.</h2>
          </Reveal>
          <FaqSection />
        </div>
      </section>

      {/* ------------------------------------------------------------- CTAs */}
      <section className="section tight">
        <div className="site-shell">
          <Reveal className="closing-cta">
            <h2>Payroll you can explain, line by line.</h2>
            <p>Start a 14-day Core trial, or open the playable preview above. It runs the real payroll rules and saves nothing.</p>
            <div className="closing-cta-actions">
              <a className="primary-button" href="/signup" style={{ background: "#fff", color: "var(--console)" }}>
                <LockKeyhole size={15} /> Create account <ArrowUpRight size={14} />
              </a>
              <a className="secondary-button" href="/book-demo" style={{ background: "rgba(255,255,255,.08)", borderColor: "rgba(255,255,255,.2)", color: "#fff" }}>
                <CalendarDays size={15} /> Book a demo
              </a>
            </div>
            <p className="closing-cta-foot">No credit card to start · Solo is free forever</p>
          </Reveal>

          <div className="module-grid three" style={{ marginTop: 22 }}>
            <Reveal className="feature-card">
              <span className="feature-icon" aria-hidden>
                <Building2 size={17} className="i-purple" />
              </span>
              <h3>Try the live demo</h3>
              <p>A seeded bookkeeper workspace with several client companies, real payroll runs and a live register.</p>
              <a className="primary-button full" href="#simulation" style={{ marginTop: 14 }}>
                Open the preview <ArrowUpRight size={14} />
              </a>
            </Reveal>
            <Reveal delay={70} className="feature-card">
              <span className="feature-icon" aria-hidden>
                <LockKeyhole size={17} className="i-amber" />
              </span>
              <h3>Create an account</h3>
              <p>First-run setup creates your organization and its owner with a policy-checked password.</p>
              <a className="primary-button full" href="/signup" style={{ marginTop: 14 }}>
                Create account <ArrowUpRight size={14} />
              </a>
            </Reveal>
            <Reveal delay={140} className="feature-card">
              <span className="feature-icon" aria-hidden>
                <CalendarDays size={17} className="i-cyan" />
              </span>
              <h3>Book a demo</h3>
              <p>Tell us your headcount and entity structure and we will walk through your actual setup.</p>
              <a className="primary-button full" href="/book-demo" style={{ marginTop: 14 }}>
                Book a demo <ArrowUpRight size={14} />
              </a>
            </Reveal>
          </div>

          <div className="notice notice-slate" style={{ marginTop: 22 }}>
            <FileSpreadsheet size={15} className="i-teal" />
            <span>
              Your data stays portable: employees and payroll registers export as CSV, the whole company exports as JSON,
              and every export is written to the audit trail.
            </span>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
