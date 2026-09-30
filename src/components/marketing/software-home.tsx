import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Gauge,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import { buildSampleRun } from "@/components/marketing/sample-workspace";
import styles from "./software-home.module.css";

const COVERAGE = ["SSS", "PhilHealth", "Pag-IBIG", "BIR TRAIN"];

const FLOW = [
  ["01", "Prepare", "Attendance, changes and cutoff inputs land in one run."],
  ["02", "Calculate", "Rules, premiums, deductions and contributions are applied."],
  ["03", "Review", "Exceptions and unusual movements are surfaced before approval."],
  ["04", "Approve", "Maker and checker stay separate until the run is cleared."],
  ["05", "Release", "Bank files and payslips unlock only after the final checks pass."],
];

const VALUE_CARDS = [
  {
    icon: ShieldCheck,
    eyebrow: "Payroll assurance",
    title: "The numbers explain themselves before release.",
    copy: "Material changes, exceptions and approval state stay visible in the same place as the payroll totals.",
    detail: "Recalculation invalidates stale approvals automatically.",
  },
  {
    icon: BadgeCheck,
    eyebrow: "Philippine rules",
    title: "Compliance is part of the run, not a side spreadsheet.",
    copy: "SSS, PhilHealth, Pag-IBIG and BIR TRAIN stay attached to the payroll workflow your team is already reviewing.",
    detail: "Employee and employer bases remain reviewable.",
  },
  {
    icon: LockKeyhole,
    eyebrow: "Controlled release",
    title: "The right person decides at the right step.",
    copy: "Role-aware permissions, checker approval and release controls make responsibility obvious without making payroll feel heavy.",
    detail: "Final exports stay locked until release.",
  },
];

const ROLES = ["Owner", "HR Admin", "Payroll Officer", "Checker", "Employee"];

export async function SoftwareHome() {
  const plans = await getPublicPricingPlans();
  const sampleRun = buildSampleRun();
  const sampleNet = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(sampleRun.net);

  return (
    <div className={`site ${styles.page}`}>
      <SiteNav />

      <main>
        <section className={styles.hero}>
          <div className={styles.heroGlow} aria-hidden />
          <div className={styles.shell}>
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <span className={styles.eyebrow}>
                  <Sparkles size={14} aria-hidden />
                  Modern payroll for Philippine teams
                </span>

                <h1>Payroll that feels calm, even when the cutoff isn&apos;t.</h1>

                <p className={styles.heroLead}>
                  Linaw brings payroll calculation, review, checker approval, release and payslips into one premium
                  workspace built around Philippine payroll rules.
                </p>

                <div className={styles.heroActions}>
                  <a className={styles.primaryAction} href="/signup">
                    Start free <ArrowRight size={15} aria-hidden />
                  </a>
                  <a className={styles.secondaryAction} href="/demo">
                    Explore live sandbox
                  </a>
                </div>

                <div className={styles.heroTrust} aria-label="Payroll coverage">
                  {COVERAGE.map((item) => (
                    <span key={item}>
                      <CheckCircle2 size={13} aria-hidden />
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.heroVisual} aria-label="Sample payroll release overview">
                <div className={styles.heroVisualChrome}>
                  <div className={styles.windowDots} aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>September payroll</span>
                  <span className={styles.livePill}>Ready for review</span>
                </div>

                <div className={styles.releaseCard}>
                  <div className={styles.releaseCardHead}>
                    <div>
                      <span>Net payroll</span>
                      <strong>{sampleNet}</strong>
                    </div>
                    <span className={styles.releaseStatus}>2 items need attention</span>
                  </div>

                  <div className={styles.releaseMetrics}>
                    <div>
                      <span>Employees</span>
                      <strong>{sampleRun.entries.length}</strong>
                    </div>
                    <div>
                      <span>Exceptions</span>
                      <strong>{sampleRun.exceptions}</strong>
                    </div>
                    <div>
                      <span>Approval</span>
                      <strong>Checker</strong>
                    </div>
                  </div>

                  <div className={styles.releaseTimeline}>
                    <div className={styles.done}>
                      <span>1</span>
                      <div>
                        <strong>Calculated</strong>
                        <p>Rules and cutoff inputs applied</p>
                      </div>
                      <CheckCircle2 size={15} aria-hidden />
                    </div>
                    <div className={styles.current}>
                      <span>2</span>
                      <div>
                        <strong>Review changes</strong>
                        <p>2 employees require attention</p>
                      </div>
                      <ArrowRight size={15} aria-hidden />
                    </div>
                    <div>
                      <span>3</span>
                      <div>
                        <strong>Checker approval</strong>
                        <p>Release stays locked until approved</p>
                      </div>
                      <LockKeyhole size={15} aria-hidden />
                    </div>
                  </div>

                  <div className={styles.explainCard}>
                    <div>
                      <span>Why did Aira&apos;s pay change?</span>
                      <strong>Overtime +₱4,230 · Holiday premium +₱1,640</strong>
                    </div>
                    <ArrowRight size={14} aria-hidden />
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.heroSignalBar}>
              <span>Philippine payroll controls</span>
              <span>Role-based approvals</span>
              <span>Published pricing</span>
              <span>Interactive sandbox</span>
            </div>
          </div>
        </section>

        <section className={styles.productShowcase} aria-label="Linaw payroll product preview">
          <div className={styles.wideShell}>
            <div className={styles.productTopline}>
              <div>
                <span className={styles.kicker}>The product</span>
                <h2>One workspace from payroll preparation to employee payslip.</h2>
              </div>
              <p>
                Explore the actual interface with realistic sample data. The public preview is interactive and writes
                nothing to a customer workspace.
              </p>
            </div>

            <div className={styles.productFrame} id="hero-product-preview">
              <div className={styles.productFrameBar}>
                <div>
                  <span className={styles.productOrb} aria-hidden />
                  <strong>Linaw payroll workspace</strong>
                </div>
                <span>Interactive preview</span>
              </div>
              <div className={styles.productScreen}>
                <WorkspacePreview mode="focused" />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.workflowSection} id="workflow">
          <div className={styles.shell}>
            <div className={styles.sectionIntro}>
              <span className={styles.kicker}>A clearer cutoff</span>
              <h2>Payroll moves forward in one visible direction.</h2>
              <p>
                No hunting through spreadsheets, chat messages and export folders to work out what is ready and what
                still needs attention.
              </p>
            </div>

            <ol className={styles.flowGrid}>
              {FLOW.map(([step, title, copy]) => (
                <li key={step}>
                  <span className={styles.flowNumber}>{step}</span>
                  <strong>{title}</strong>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.valueSection}>
          <div className={styles.shell}>
            <div className={styles.sectionIntro}>
              <span className={styles.kicker}>Built for confidence</span>
              <h2>Premium software should reduce payroll anxiety, not decorate it.</h2>
              <p>
                Linaw keeps the controls serious while making the experience feel lighter, cleaner and easier to scan.
              </p>
            </div>

            <div className={styles.valueGrid}>
              {VALUE_CARDS.map(({ icon: Icon, eyebrow, title, copy, detail }) => (
                <article key={title} className={styles.valueCard}>
                  <span className={styles.valueIcon}>
                    <Icon size={18} aria-hidden />
                  </span>
                  <span className={styles.valueEyebrow}>{eyebrow}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  <div>
                    <CheckCircle2 size={14} aria-hidden />
                    {detail}
                  </div>
                </article>
              ))}
            </div>

            <div className={styles.assuranceBand}>
              <div className={styles.assuranceCopy}>
                <span className={styles.kicker}>Explainable payroll</span>
                <h2>Know what changed before anyone presses release.</h2>
                <p>
                  The review surface highlights movement, incomplete inputs and release blockers, so the payroll team can
                  spend time deciding instead of reconciling screens.
                </p>

                <div className={styles.assuranceChecks}>
                  <span><Gauge size={15} aria-hidden /> Compare current and previous cutoff</span>
                  <span><ShieldCheck size={15} aria-hidden /> Keep maker and checker separate</span>
                  <span><LockKeyhole size={15} aria-hidden /> Block final exports until release</span>
                </div>

                <a className={styles.textLink} href="/demo">
                  Open as Payroll Officer or Checker <ArrowRight size={14} aria-hidden />
                </a>
              </div>

              <div className={styles.assurancePanel}>
                <div className={styles.assurancePanelHead}>
                  <div>
                    <span>September 16–30</span>
                    <strong>Payroll assurance</strong>
                  </div>
                  <span>Reviewing</span>
                </div>

                <div className={styles.assuranceStats}>
                  <div>
                    <span>Net payroll</span>
                    <strong>₱361,282</strong>
                  </div>
                  <div>
                    <span>Compared</span>
                    <strong>40</strong>
                  </div>
                  <div>
                    <span>Release</span>
                    <strong>Locked</strong>
                  </div>
                </div>

                <div className={styles.assuranceRows}>
                  <div>
                    <span className={styles.avatar}>AV</span>
                    <div>
                      <strong>Aira Villanueva</strong>
                      <p>Net pay is 24% higher than the previous cutoff.</p>
                    </div>
                    <span className={styles.positive}>+₱5,870</span>
                  </div>
                  <div>
                    <span className={styles.avatar}>RM</span>
                    <div>
                      <strong>Rico Mendoza</strong>
                      <p>Incomplete attendance is affecting this cutoff.</p>
                    </div>
                    <span className={styles.review}>Review</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.supportBand}>
          <div className={styles.shell}>
            <div className={styles.supportGrid}>
              <article className={styles.switchCard}>
                <span className={styles.kicker}>Switch without starting over</span>
                <h2>Bring your payroll history with you.</h2>
                <p>
                  Import employees, payroll history, leave balances and loans. Mid-year history stays preserved instead
                  of being recalculated under today&apos;s rules.
                </p>
                <div className={styles.sourceLine}>
                  <span>Sprout</span>
                  <span>Salarium</span>
                  <span>PayrollHero</span>
                  <span>Other CSV</span>
                </div>
                <a className={styles.textLink} href="#simulation">
                  Try migration in the sandbox <ArrowRight size={14} aria-hidden />
                </a>
              </article>

              <article className={styles.hrCard}>
                <span className={styles.kicker}>Around payroll</span>
                <h2>The HR tools stay close, without taking over the story.</h2>
                <p>
                  People, attendance, leave, loans, benefits, expenses and separation are there when payroll needs them.
                </p>
                <div className={styles.moduleCloud}>
                  {["People", "Attendance", "Leave", "Loans", "Benefits", "Expenses", "Separation"].map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.complianceSection} id="compliance">
          <div className={styles.shell}>
            <div className={styles.complianceHeader}>
              <div>
                <span className={styles.kicker}>Philippine by design</span>
                <h2>The rulebook belongs inside the payroll run.</h2>
              </div>
              <p>
                Statutory rules stay close to the figures they affect, with enough context for reviewers to understand
                the basis before release.
              </p>
            </div>

            <div className={styles.complianceGrid}>
              {[
                ["SSS", "Employee and employer contribution basis stays visible."],
                ["PhilHealth", "Employee and employer share remains reviewable."],
                ["Pag-IBIG", "Mandatory and supported voluntary contributions stay attached to payroll."],
                ["BIR TRAIN", "Withholding and annualization use the same payroll history."],
              ].map(([title, copy]) => (
                <article key={title}>
                  <span>{title}</span>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sandboxSection} id="simulation">
          <div className={styles.wideShell}>
            <div className={styles.sandboxHead}>
              <div>
                <span className={styles.kicker}>Try it yourself</span>
                <h2>Explore the product without sitting through a sales demo.</h2>
              </div>
              <div className={styles.roleChips} aria-label="Available demo roles">
                {ROLES.map((role) => (
                  <span key={role}><UsersRound size={12} aria-hidden />{role}</span>
                ))}
              </div>
            </div>

            <div className={styles.simulationSurface}>
              <WorkspacePreview mode="interactive" />
            </div>

            <div className={styles.sandboxFooter}>
              <span>Want the full permission model and persona tasks?</span>
              <a href="/demo">Open role-based sandbox <ArrowRight size={13} aria-hidden /></a>
            </div>
          </div>
        </section>

        <section className={styles.pricingSection} id="pricing">
          <div className={styles.shell}>
            <div className={styles.sectionIntro}>
              <span className={styles.kicker}>Simple published pricing</span>
              <h2>Know what payroll will cost before you talk to anyone.</h2>
              <p>
                Set your headcount and compare the operating model that fits your team. No hidden enterprise-only
                calculator.
              </p>
            </div>

            <div className={styles.pricingSurface}>
              <PricingTable plans={plans} />
            </div>
          </div>
        </section>

        <section className={styles.finalSection}>
          <div className={styles.shell}>
            <div className={styles.finalCard}>
              <div className={styles.finalGlow} aria-hidden />
              <span className={styles.finalKicker}>Ready for the next cutoff</span>
              <h2>Run payroll with less noise and more control.</h2>
              <p>
                Start with a real workspace or use the sandbox first. The product should earn your trust before the
                sales conversation.
              </p>
              <div className={styles.finalActions}>
                <a className={styles.finalPrimary} href="/signup">
                  Start free <ArrowRight size={15} aria-hidden />
                </a>
                <a className={styles.finalSecondary} href="/demo">
                  Explore sandbox
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
