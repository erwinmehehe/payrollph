import { asc } from "drizzle-orm";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  Terminal,
  UserCheck,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { db } from "@/db";
import { pricingPlans } from "@/db/schema";
import { buildCapabilityReport } from "@/lib/capabilities";
import { wageOrderFor } from "@/lib/wage-orders";
import { CapabilityGrid } from "@/components/marketing/capability-grid";
import { HeroActions } from "@/components/marketing/hero-actions";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { StatutoryLab } from "@/components/marketing/statutory-lab";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";

const COMPETITORS = [
  { name: "Linaw", freelancer: "First-class product", pricing: "Published, in-app", multiClient: "Native multi-client hub", filing: "DRAFT worksheets only" },
  { name: "Sprout", freelancer: "No", pricing: "Quote on request", multiClient: "Separate accounts", filing: "Certified filing" },
  { name: "PayrollHero", freelancer: "No", pricing: "Quote on request", multiClient: "Limited CPA tooling", filing: "Certified filing" },
  { name: "GreatDay HR", freelancer: "No", pricing: "Quote on request", multiClient: "Limited", filing: "Certified filing" },
  { name: "Kazam", freelancer: "No", pricing: "Quote on request", multiClient: "No", filing: "Certified filing" },
];

const COVERAGE = [
  { label: "SSS", icon: ShieldCheck, tone: "i-green" },
  { label: "PhilHealth", icon: ShieldCheck, tone: "i-cyan" },
  { label: "Pag-IBIG", icon: WalletCards, tone: "i-blue" },
  { label: "BIR TRAIN", icon: FileSpreadsheet, tone: "i-purple" },
  { label: "DOLE wage orders", icon: ClipboardCheck, tone: "i-amber" },
  { label: "13th month", icon: CalendarDays, tone: "i-teal" },
  { label: "Night differential", icon: Clock3, tone: "i-cyan" },
  { label: "Holiday stacking", icon: CalendarDays, tone: "i-pink" },
];

export async function SoftwareHome() {
  const [plans, report] = await Promise.all([
    db.select().from(pricingPlans).orderBy(asc(pricingPlans.id)),
    buildCapabilityReport(),
  ]);
  const demoEnabled = process.env.DEMO_MODE === "true";
  const ncr = wageOrderFor("NCR");

  return (
    <div className="site software-home">
      <SiteNav />

      <section className="hero home-hero">
        <div className="site-shell home-hero-grid">
          <div className="hero-copy home-hero-copy">
            <span className="pill">
              <i aria-hidden />
              NCR wage order <span className="mono">{ncr.wageOrder}</span> · ₱{ncr.dailyRate}/day is in the payroll rules
            </span>

            <h1>
              Philippine payroll software
              <br />
              without the <span className="accent">guesswork.</span>
            </h1>

            <p className="hero-sub">
              Run payroll, attendance, statutory deductions, payslips, approvals and reporting in one HRIS and payroll
              system built around Philippine payroll rules. Review how every figure was produced before you release a run.
            </p>

            <HeroActions demoEnabled={demoEnabled} />

            <div className="hero-facts">
              <span>
                <Check size={14} className="i-green" /> SSS, PhilHealth, Pag-IBIG and TRAIN computed server-side
              </span>
              <span>
                <Check size={14} className="i-green" /> Attendance exceptions stay visible instead of being guessed
              </span>
              <span>
                <Check size={14} className="i-green" /> Published pricing from the same table the app uses
              </span>
            </div>
          </div>

          <div className="home-hero-stage" aria-label="Linaw payroll workspace preview">
            <div className="home-hero-glow" aria-hidden />
            <div className="home-hero-badge home-hero-badge-top">
              <span className="status status-verified">Live rules</span>
              <small>Philippine statutory engine</small>
            </div>
            <div className="home-hero-visual">
              <WorkspacePreview mode="showcase" />
            </div>
            <div className="home-hero-badge home-hero-badge-bottom">
              <span className="mono">{ncr.wageOrder}</span>
              <small>Current NCR rule in this build</small>
            </div>
          </div>

          <div className="home-coverage" aria-label="Payroll coverage">
            {COVERAGE.map(({ label, icon: Icon, tone }) => (
              <span className="coverage-chip" key={label}>
                <span className="coverage-icon" aria-hidden>
                  <Icon size={14} className={tone} />
                </span>
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="section home-section home-demo-section" id="preview">
        <div className="site-shell home-demo-stack">
          <div className="section-head home-editorial home-demo-heading">
            <p className="eyebrow">Interactive payroll demo</p>
            <h2>See the payroll system work before you sign up.</h2>
            <p>
              Switch tabs, open a payslip, acknowledge an exception and release a run. The people are sample data, but the
              contributions and withholding use the same payroll-rule functions as the product.
            </p>
            <div className="editorial-facts">
              <span><Check size={14} className="i-green" /> Tabs, payslips and the payroll register are interactive</span>
              <span><Check size={14} className="i-green" /> Exceptions must be acknowledged before simulated release</span>
              <span><Check size={14} className="i-green" /> Statutory figures use the product&apos;s payroll-rule functions</span>
            </div>
          </div>

          <div className="demo-surface">
            <WorkspacePreview mode="interactive" />
          </div>
        </div>
      </section>

      <section className="section alt home-section home-payroll-section" id="payroll">
        <div className="site-shell payroll-showcase">
          <div className="payroll-editorial">
            <div className="section-head">
              <p className="eyebrow">Philippine payroll engine</p>
              <h2>Check the payroll calculation before it leaves the building.</h2>
              <p>
                Hours come from raw punches. Statutory contributions come from versioned rules. Premiums and exemptions are
                applied in the payroll engine, then exposed so a reviewer can see what changed the net pay.
              </p>
            </div>

            <div className="payroll-feature-stack">
              <article className="payroll-feature-row">
                <span className="feature-icon" aria-hidden>
                  <WalletCards size={17} className="i-green" />
                </span>
                <div>
                  <h3>Statutory deductions</h3>
                  <p>SSS, PhilHealth and Pag-IBIG use the configured contribution rules.</p>
                </div>
              </article>

              <article className="payroll-feature-row">
                <span className="feature-icon" aria-hidden>
                  <FileSpreadsheet size={17} className="i-purple" />
                </span>
                <div>
                  <h3>Withholding under TRAIN</h3>
                  <p>The same semi-monthly withholding function used by payroll runs drives the calculator.</p>
                </div>
              </article>

              <article className="payroll-feature-row">
                <span className="feature-icon" aria-hidden>
                  <Clock3 size={17} className="i-cyan" />
                </span>
                <div>
                  <h3>Wage orders and attendance rules</h3>
                  <p>Configured wage floors, punch-derived hours and exceptions stay visible to the reviewer.</p>
                </div>
              </article>
            </div>
          </div>

          <div className="payroll-lab-surface">
            <StatutoryLab />
          </div>
        </div>
      </section>

      <section className="section home-section home-workspace-section" id="workspace">
        <div className="site-shell workspace-layout">
          <div className="section-head home-editorial">
            <p className="eyebrow">HRIS and payroll workspace</p>
            <h2>One payroll system for one company, multiple branches or multiple clients.</h2>
            <p>
              Start with the payroll workflow you need now. HRIS, attendance, approvals, employee self-service and
              multi-client controls stay in the same workspace instead of becoming separate spreadsheets and logins.
            </p>
          </div>

          <div className="bento">
            <article className="feature-card wide">
              <span className="feature-icon" aria-hidden>
                <Layers size={17} className="i-teal" />
              </span>
              <h3>Multi-client payroll with server-side isolation</h3>
              <p>
                Switch client and every query is re-scoped. Session routes pass through a shared membership gate, while
                record routes resolve the record&apos;s own organization instead of trusting an organization id from the page.
              </p>
              <ul>
                <li>Department-scoped roles narrow data on the server</li>
                <li>Cross-tenant attempts are covered by regression tests</li>
              </ul>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <ClipboardCheck size={17} className="i-amber" />
              </span>
              <h3>Payroll approvals and delegation</h3>
              <p>
                Date-bounded, revocable delegation keeps a payroll moving when an approver is away. The decision records
                who acted, who they acted for, and the delegation chain.
              </p>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <UserCheck size={17} className="i-purple" />
              </span>
              <h3>Employee self-service payslips</h3>
              <p>
                Employees see their own YTD gross, net and tax, per-period line items, and downloadable PDF payslips.
                Queries are constrained by the employee linked to the session.
              </p>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <UploadCloud size={17} className="i-teal" />
              </span>
              <h3>Bank files and government worksheets</h3>
              <p>
                Versioned generators produce BDO DAT and BPI, UnionBank and GCash CSV outputs with a dry-run validation
                pass. Xero and QuickBooks Online journal CSVs are also generated.
              </p>
              <p style={{ marginTop: 10 }}>
                Government outputs are calculated from payroll data but remain labelled <strong>DRAFT</strong> until they
                are validated against the agencies&apos; own filing tools.
              </p>
              <span className="status status-draft-only">Draft only</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <FileSpreadsheet size={17} className="i-teal" />
              </span>
              <h3>Employee import without spreadsheet cleanup first</h3>
              <p>
                The importer tolerates column order and extra columns, parses values such as{" "}
                <span className="mono">₱ 28,000.00</span>, reports row-level errors and updates existing employees by
                employee number on re-upload.
              </p>
              <span className="status status-verified">Verified</span>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <Terminal size={17} className="i-blue" />
              </span>
              <h3>API and webhooks when payroll needs to connect</h3>
              <p>
                Scoped API keys, idempotent writes, HMAC-signed webhooks, retry backoff and delivery logs are available for
                workflows that need more than CSV.
              </p>
              <span className="status status-verified">Verified</span>
            </article>
          </div>

          <div className="persona-strip">
            <div className="persona-chip">
              <strong>Freelancer</strong>
              <span>Tax comparison, voluntary contributions and a simpler workspace.</span>
            </div>
            <div className="persona-chip">
              <strong>Small team</strong>
              <span>Semi-monthly payroll with approvals and self-service when you need them.</span>
            </div>
            <div className="persona-chip">
              <strong>Multi-branch company</strong>
              <span>Org units, department-scoped access and payroll scoped to the right operating unit.</span>
            </div>
            <div className="persona-chip">
              <strong>Bookkeeping practice</strong>
              <span>Multiple client companies in one workspace, isolated on the server.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section alt home-section home-proof-section" id="proof">
        <div className="site-shell proof-layout">
          <div className="section-head home-editorial">
            <p className="eyebrow">Proof before purchase</p>
            <h2>Claims you can inspect, including the gaps.</h2>
            <p>
              The capability report is generated from this deployment&apos;s code and database. It currently lists{" "}
              <strong>{report.counts.verified} verified</strong>, <strong>{report.counts.partial} partial</strong> and{" "}
              <strong>{report.counts.absent} not built</strong> capabilities.
            </p>
          </div>

          <div className="proof-evidence">
            <div className="proof-card">
              <CapabilityGrid capabilities={report.capabilities} counts={report.counts} />
            </div>

            <div className="proof-card comparison-card">
              <div className="proof-card-head">
                <p className="eyebrow">Market positioning</p>
                <h3>How we read the alternatives.</h3>
                <p>
                  Competitor columns are our reading of public positioning, not independently verified product testing.
                  Certified government filing remains a gap for Linaw and is labelled as such.
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
                    Sprout, PayrollHero, GreatDay HR and Kazam columns reflect public marketing as we read it and may be out
                    of date. We do not claim to have tested their products.
                  </span>
                </div>
              </div>
            </div>

            <div className="notice notice-amber proof-readiness" id="status">
              <ShieldCheck size={16} className="i-green" />
              <span>
                <strong>Production status:</strong> the payroll engine, workspace, approvals, self-service, API and exports
                run on the request path. External-provider and filing readiness is reported separately at{" "}
                <a className="link-button" href="/api/readiness">/api/readiness</a> and{" "}
                <a className="link-button" href="/scorecard">/scorecard</a>.
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section home-section home-pricing-section" id="pricing">
        <div className="site-shell pricing-layout">
          <div className="section-head home-editorial">
            <p className="eyebrow">Payroll software pricing</p>
            <h2>See what Linaw costs at your headcount.</h2>
            <p>
              The cards read the actual <span className="mono">pricing_plans</span> rows used by the app. Change headcount
              and the displayed total recalculates from the stored base and per-employee rate.
            </p>
          </div>

          <div className="pricing-surface">
            <PricingTable plans={plans} />
          </div>
        </div>
      </section>

      <section className="home-closing">
        <div className="site-shell">
          <div className="closing-band">
            <div className="closing-copy">
              <p className="eyebrow">Ready to run a payroll?</p>
              <h2>Inspect the product, create a workspace, or talk through your setup.</h2>
              <p>The demo and calculator above remain available before you create an account.</p>
            </div>
            <div className="closing-actions">
              <a className="closing-button closing-button-light" href="#preview">
                Try live demo <ArrowUpRight size={14} />
              </a>
              <a className="closing-button closing-button-outline" href="/signup">
                Create account
              </a>
              <a className="closing-button closing-button-outline" href="/book-demo">
                Book a demo <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
