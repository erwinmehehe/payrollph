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

export async function SoftwareHome() {
  const [plans, report] = await Promise.all([
    db.select().from(pricingPlans).orderBy(asc(pricingPlans.id)),
    buildCapabilityReport(),
  ]);
  const demoEnabled = process.env.DEMO_MODE === "true";
  const ncr = wageOrderFor("NCR");

  return (
    <div className="site">
      <SiteNav />

      <section className="hero">
        <div className="hero-inner">
          <div className="site-shell">
            <div className="hero-copy">
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

              <div className="chip-row" aria-label="Payroll coverage">
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

          <div className="hero-visual">
            <div className="site-shell">
              <WorkspacePreview mode="showcase" />
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="preview">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Interactive payroll demo</p>
            <h2>See the payroll system work before you sign up.</h2>
            <p>
              Switch tabs, open a payslip, acknowledge an exception and release a run. The people are sample data, but the
              contributions and withholding use the same payroll-rule functions as the product.
            </p>
          </div>
          <WorkspacePreview mode="interactive" />
        </div>
      </section>

      <section className="section alt" id="payroll">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Philippine payroll engine</p>
            <h2>Check the payroll calculation before it leaves the building.</h2>
            <p>
              Hours come from raw punches. Statutory contributions come from versioned rules. Premiums and exemptions are
              applied in the payroll engine, then exposed so a reviewer can see what changed the net pay.
            </p>
          </div>

          <div className="split">
            <div>
              <div className="feature-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)", gap: 14 }}>
                <article className="feature-card">
                  <span className="feature-icon" aria-hidden>
                    <WalletCards size={17} className="i-green" />
                  </span>
                  <h3>Statutory deductions and withholding</h3>
                  <p>
                    SSS under RA 11199, PhilHealth under RA 11223, Pag-IBIG under RA 9679, and withholding under TRAIN,
                    including the minimum-wage-earner exemption path used by the engine.
                  </p>
                  <span className="status status-verified">Unit-tested</span>
                </article>

                <article className="feature-card">
                  <span className="feature-icon" aria-hidden>
                    <Clock3 size={17} className="i-cyan" />
                  </span>
                  <h3>Attendance that does not invent missing hours</h3>
                  <p>
                    Tardiness, undertime, overtime and night differential are derived from punch pairs. A missing punch
                    produces zero derived hours and an exception instead of an assumed time.
                  </p>
                  <span className="status status-verified">Unit-tested</span>
                </article>

                <article className="feature-card">
                  <span className="feature-icon" aria-hidden>
                    <ShieldCheck size={17} className="i-green" />
                  </span>
                  <h3>Wage orders, holidays and advisories</h3>
                  <p>
                    Configured regional wage orders set the floor checked by payroll, the 2026 holiday calendar drives
                    premium handling, and active calamity advisories can add their premium and reference to the payslip.
                  </p>
                  <span className="status status-verified">Unit-tested</span>
                </article>
              </div>
            </div>

            <StatutoryLab />
          </div>
        </div>
      </section>

      <section className="section" id="workspace">
        <div className="site-shell">
          <div className="section-head">
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

          <div className="persona-strip" style={{ marginTop: 22 }}>
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

      <section className="section alt" id="proof">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Proof before purchase</p>
            <h2>Claims you can inspect, including the gaps.</h2>
            <p>
              The capability report is generated from this deployment&apos;s code and database. It currently lists{" "}
              <strong>{report.counts.verified} verified</strong>, <strong>{report.counts.partial} partial</strong> and{" "}
              <strong>{report.counts.absent} not built</strong> capabilities.
            </p>
          </div>

          <CapabilityGrid capabilities={report.capabilities} counts={report.counts} />

          <div className="section-head" style={{ marginTop: 56, marginBottom: 20 }}>
            <p className="eyebrow">Market positioning</p>
            <h2>Where Linaw is different, and where established providers are ahead.</h2>
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
                Sprout, PayrollHero, GreatDay HR and Kazam columns reflect public marketing as we read it and may be out of
                date. We do not claim to have tested their products.
              </span>
            </div>
          </div>

          <div className="notice notice-amber" style={{ marginTop: 22 }} id="status">
            <ShieldCheck size={16} className="i-green" />
            <span>
              <strong>Production status:</strong> the payroll engine, workspace, approvals, self-service, API and exports
              run on the request path. External-provider and filing readiness is reported separately at{" "}
              <a className="link-button" href="/api/readiness">/api/readiness</a> and{" "}
              <a className="link-button" href="/scorecard">/scorecard</a>.
            </span>
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="site-shell">
          <div className="section-head">
            <p className="eyebrow">Payroll software pricing</p>
            <h2>See what Linaw costs at your headcount.</h2>
            <p>
              The cards below read the actual <span className="mono">pricing_plans</span> rows used by the app. Change
              headcount and the displayed total recalculates from the stored base and per-employee rate.
            </p>
          </div>
          <PricingTable plans={plans} />
        </div>
      </section>

      <section className="section tight alt">
        <div className="site-shell">
          <div className="module-grid three" style={{ marginTop: 0 }}>
            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <Building2 size={17} className="i-purple" />
              </span>
              <h3>Try the payroll software</h3>
              <p>Use the interactive preview to inspect payroll runs, calculations and the workspace before creating anything.</p>
              <a className="primary-button full" href="#preview" style={{ marginTop: 14 }}>
                Try live demo <ArrowUpRight size={14} />
              </a>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <LockKeyhole size={17} className="i-amber" />
              </span>
              <h3>Start with your own workspace</h3>
              <p>First-run setup creates the organization and owner account with the product&apos;s password policy enforced.</p>
              <a className="primary-button full" href="/signup" style={{ marginTop: 14 }}>
                Start free <ArrowUpRight size={14} />
              </a>
            </article>

            <article className="feature-card">
              <span className="feature-icon" aria-hidden>
                <CalendarDays size={17} className="i-cyan" />
              </span>
              <h3>Want someone to run payroll with you?</h3>
              <p>Linaw also has a separate managed payroll service for businesses that want the processing work handled.</p>
              <a className="secondary-button full" href="/payroll-outsourcing" style={{ marginTop: 14 }}>
                See payroll outsourcing <ArrowUpRight size={14} />
              </a>
            </article>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
