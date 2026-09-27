import { asc } from "drizzle-orm";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  Layers,
  LockKeyhole,
  ShieldCheck,
  Terminal,
  UserCheck,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { db } from "@/db";
import { pricingPlans } from "@/db/schema";
import { buildCapabilityReport } from "@/lib/capabilities";
import { CapabilityGrid } from "@/components/marketing/capability-grid";
import { HeroActions } from "@/components/marketing/hero-actions";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StatutoryLab } from "@/components/marketing/statutory-lab";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";

export const dynamic = "force-dynamic";

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

export default async function WelcomePage() {
  const [plans, report] = await Promise.all([
    db.select().from(pricingPlans).orderBy(asc(pricingPlans.id)),
    buildCapabilityReport(),
  ]);

  const demoEnabled = process.env.DEMO_MODE === "true";

  return (
    <div className="site">
      <SiteNav />

      {/* ------------------------------------------------------------- hero */}
      <section className="hero">
        <div className="hero-inner">
          <div className="site-shell">
            <div className="hero-copy">
              <span className="pill">
                <i aria-hidden />
                NCR wage order <span className="mono">WO-NCR-26</span> · ₱695/day is already in the engine
              </span>

              <h1>
                Philippine payroll,
                <br />
                made{" "}
                <span className="accent">
                  linaw
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
                One workspace for semi-monthly runs, statutory contributions, timekeeping, approvals and employee
                self-service, for a single freelancer, a growing company, or a bookkeeper carrying a dozen client
                businesses at once.
              </p>

              <HeroActions demoEnabled={demoEnabled} />

              <div className="hero-facts">
                <span>
                  <Check size={14} className="i-green" /> SSS, PhilHealth, Pag-IBIG and TRAIN computed server-side
                </span>
                <span>
                  <Check size={14} className="i-green" /> Every figure traceable to the rule that produced it
                </span>
                <span>
                  <Check size={14} className="i-green" /> Published pricing, no quote wall
                </span>
              </div>

              <div className="chip-row">
                {["SSS", "PhilHealth", "Pag-IBIG", "BIR TRAIN", "DOLE wage orders", "13th month", "Night differential", "Holiday stacking"].map(
                  (chip) => (
                    <span className="chip" key={chip}>
                      {chip}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>

          {/* Full-width visual composition */}
          <div className="hero-visual">
            <div className="site-shell">
              <WorkspacePreview mode="showcase" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- preview */}
      <section className="section" id="preview">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Playable preview</p>
            <h2>Use the workspace before you sign up for anything.</h2>
            <p>
              Switch tabs, open a payslip, acknowledge the exception, release the run. It is a simulation with sample
              people, but the contributions and withholding are computed by the product&apos;s own rule engine, so the
              arithmetic you see is the arithmetic you would get.
            </p>
          </div>
          <WorkspacePreview mode="interactive" />
        </div>
      </section>

      {/* ---------------------------------------------------------- payroll */}
      <section className="section alt" id="payroll">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Payroll engine</p>
            <h2>The computation is the product, so it is not hidden.</h2>
            <p>
              Hours are derived from raw punches; contributions come from versioned statutory tables; premiums stack in the
              order the labour rules require. Move the slider and you are running the same functions a real payroll run
              calls.
            </p>
          </div>

          <div className="split">
            <div>
              <div className="feature-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
                <article className="feature-card">
                  <span className="feature-icon" aria-hidden>
                    <WalletCards size={17} className="i-green" />
                  </span>
                  <h3>Statutory computation</h3>
                  <p>
                    SSS under RA 11199, PhilHealth under RA 11223, Pag-IBIG under RA 9679, and withholding under the TRAIN
                    brackets, including the minimum-wage-earner exemption cascading through the whole entry.
                  </p>
                  <span className="status status-verified">Unit-tested</span>
                </article>
                <article className="feature-card">
                  <span className="feature-icon" aria-hidden>
                    <Clock3 size={17} className="i-cyan" />
                  </span>
                  <h3>Hours you can defend</h3>
                  <p>
                    Tardiness, undertime, overtime at 125% and night differential at +10% are derived from punch pairs. A
                    missing punch derives <strong>zero</strong> hours and raises an exception, it is never filled in with
                    an assumed time.
                  </p>
                  <span className="status status-verified">Unit-tested</span>
                </article>
                <article className="feature-card">
                  <span className="feature-icon" aria-hidden>
                    <ShieldCheck size={17} className="i-green" />
                  </span>
                  <h3>Wage orders and advisories</h3>
                  <p>
                    Regional DOLE wage orders set the floor a rate is checked against, holiday multipliers stack against the
                    2026 calendar, and an active calamity advisory applies its premium and prints its advisory number on
                    the payslip.
                  </p>
                  <span className="status status-verified">Unit-tested</span>
                </article>
              </div>
            </div>
            <StatutoryLab />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- workspace */}
      <section className="section" id="workspace">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">The workspace</p>
            <h2>Built for the person who runs payroll for more than one company.</h2>
            <p>
              Complexity is opt-in. A freelancer sees a planner and their own filings. A bookkeeper sees a portfolio of
              client businesses, each one isolated from the others by the server, not by the menu.
            </p>
          </div>

          <div className="bento">
            <article className="feature-card wide">
              <span className="feature-icon" aria-hidden>
                <Layers size={17} className="i-teal" />
              </span>
              <h3>Multi-client workspaces with real isolation</h3>
              <p>
                Switch client and every query is re-scoped. Each session route passes through one shared membership gate,
                and routes addressed by a record id resolve that record&apos;s own organization rather than trusting the id
                in the URL, so substituting another tenant&apos;s id returns 403, not their payroll.
              </p>
              <ul>
                <li>Department-scoped roles narrow queries on the server, and the directory says when it is scoped</li>
                <li>Cross-tenant access attempts are covered by a test that fails the build if the gate is dropped</li>
              </ul>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <ClipboardCheck size={17} className="i-amber" />
              </span>
              <h3>Approvals that survive a holiday</h3>
              <p>
                Date-bounded, revocable delegation means an out-of-office approver is not a blocked payroll. A
                delegate&apos;s decision records who decided, who they decided for, and the whole chain.
              </p>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <UserCheck size={17} className="i-purple" />
              </span>
              <h3>Employee self-service</h3>
              <p>
                Staff see their own YTD gross, net and tax, their per-period line items, and a downloadable PDF payslip.
                Every query filters on the session&apos;s employee id, never a parameter from the page, so a
                colleague&apos;s payslip is simply unreachable.
              </p>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <UploadCloud size={17} className="i-teal" />
              </span>
              <h3>Bank files and government worksheets</h3>
              <p>
                Versioned generators for BDO DAT and BPI / UnionBank / GCash CSV, with a dry-run validation pass before any
                file that looks submittable. Journals export to Xero and QuickBooks Online.
              </p>
              <p style={{ marginTop: 10 }}>
                Government output, 1601-C, Alphalist/2316, SSS R-3, PhilHealth RF-1, Pag-IBIG MCRF, is generated from
                real figures but is <strong>not</strong> validated against the agencies&apos; own import tools, so every
                file is labelled DRAFT.
              </p>
              <span className="status status-draft-only">Draft only</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <UploadCloud size={17} className="i-teal" />
              </span>
              <h3>Onboarding from the spreadsheet you already have</h3>
              <p>
                The importer tolerates your column order and extra columns, parses <span className="mono">₱ 28,000.00</span>{" "}
                correctly, reports row-level errors specifically, and updates in place on re-upload instead of creating
                duplicates.
              </p>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <Terminal size={17} className="i-blue" />
              </span>
              <h3>A platform, not a silo</h3>
              <p>
                Scoped API keys with idempotent writes, HMAC-signed webhooks with exponential backoff, and a delivery log
                that records the real response code, including the failures.
              </p>
              <span className="status status-verified">Verified</span>
            </article>
          </div>

          <div className="persona-strip" style={{ marginTop: 22 }}>
            <div className="persona-chip">
              <strong>Freelancer</strong>
              <span>8% flat versus graduated comparison, voluntary contributions, and nothing else in the way.</span>
            </div>
            <div className="persona-chip">
              <strong>Small team</strong>
              <span>One payroll, semi-monthly, with approvals and self-service switched on when you want them.</span>
            </div>
            <div className="persona-chip">
              <strong>Multi-branch company</strong>
              <span>Org units, department-scoped access, and payroll scoped to a branch or cost centre.</span>
            </div>
            <div className="persona-chip">
              <strong>Bookkeeping practice</strong>
              <span>A portfolio of client companies in one workspace, each isolated server-side.</span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ proof */}
      <section className="section alt" id="proof">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Proof, not adjectives</p>
            <h2>What is verified, what is partial, and what is not built.</h2>
            <p>
              This table is generated from this deployment&apos;s code and database. It lists{" "}
              <strong>{report.counts.verified} verified</strong>, <strong>{report.counts.partial} partial</strong> and{" "}
              <strong>{report.counts.absent} not built</strong>, because a payroll product that overstates itself is worse
              than one that is honest about its gaps.
            </p>
          </div>

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

      {/* ---------------------------------------------------------- pricing */}
      <section className="section" id="pricing">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Pricing</p>
            <h2>Published, per employee, read from the same table the app bills from.</h2>
            <p>
              No quote wall. Move the slider and every card recalculates from its stored base and per-employee rate.
            </p>
          </div>
          <PricingTable plans={plans} />
        </div>
      </section>

      {/* ------------------------------------------------------------- CTAs */}
      <section className="section tight alt">
        <div className="site-shell">
          <div className="module-grid three" style={{ marginTop: 0 }}>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <Building2 size={17} className="i-purple" />
              </span>
              <h3>Try the live demo</h3>
              <p>A seeded bookkeeper workspace with several client companies, real payroll runs and a live register.</p>
              <a className="primary-button full" href="#preview" style={{ marginTop: 14 }}>
                Open the preview <ArrowUpRight size={14} />
              </a>
            </article>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <LockKeyhole size={17} className="i-amber" />
              </span>
              <h3>Create an account</h3>
              <p>First-run setup creates your organization and its owner with a policy-checked password.</p>
              <a className="primary-button full" href="/signup" style={{ marginTop: 14 }}>
                Create account <ArrowUpRight size={14} />
              </a>
            </article>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <CalendarDays size={17} className="i-cyan" />
              </span>
              <h3>Book a demo</h3>
              <p>Tell us your headcount and entity structure and we will walk through your actual setup.</p>
              <a className="primary-button full" href="/book-demo" style={{ marginTop: 14 }}>
                Book a demo <ArrowUpRight size={14} />
              </a>
            </article>
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
