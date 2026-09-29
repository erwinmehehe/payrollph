import {
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import styles from "./software-home.module.css";

const COVERAGE = ["SSS", "PhilHealth", "Pag-IBIG", "BIR TRAIN", "DOLE rules"];

const PAYROLL_FLOW = [
  ["01", "Prepare", "Attendance, employee changes and cutoff inputs are pulled into one run."],
  ["02", "Calculate", "Payroll rules, premiums, deductions and statutory contributions are applied."],
  ["03", "Review", "Material changes and blockers are surfaced before approval."],
  ["04", "Checker", "A different reviewer approves or sends the run back."],
  ["05", "Release", "Final bank files and released payslips unlock only after approval."],
];

const CONTROL_POINTS = [
  "Maker and checker stay separate",
  "Recalculation invalidates stale approvals",
  "Release re-checks payroll assurance",
  "Final bank files are release-only",
];

const COMPLIANCE = [
  ["SSS", "Employee and employer contribution basis stays visible in the run."],
  ["PhilHealth", "Contribution basis and employer share remain reviewable."],
  ["Pag-IBIG", "Mandatory and supported voluntary contributions stay attached to payroll."],
  ["BIR TRAIN", "Withholding and year-end annualization use the same payroll history."],
];

const MIGRATION_SOURCES = [
  "Sprout",
  "Salarium",
  "PayrollHero",
  "GreatDay HR",
  "Omni HR",
  "Employment Hero",
  "BambooHR",
  "Workday / SAP",
];

const DEMO_ROLES = ["Owner", "HR Admin", "Payroll Officer", "Checker", "Employee"];

const SUPPORTING_MODULES = [
  "People",
  "Time & attendance",
  "Leave",
  "Loans",
  "Benefits",
  "Expenses",
  "Recruitment",
  "Separation",
  "Contractors",
  "Assets",
];

export async function SoftwareHome() {
  const plans = await getPublicPricingPlans();

  return (
    <div className={`site ${styles.page}`}>
      <SiteNav />

      <main>
        <section className={styles.hero}>
          <div className={styles.shell}>
            <div className={styles.heroInner}>
              <span className={styles.eyebrow}>
                <ShieldCheck size={14} aria-hidden />
                Philippine payroll software with real controls
              </span>

              <h1>Run Philippine payroll with a clear path from draft to release.</h1>

              <p className={styles.heroLead}>
                Linaw brings payroll calculation, review, checker approval, release controls and employee payslips into one
                calm workspace, with the Philippine rules your team needs to see.
              </p>

              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="/signup">
                  Start free <ArrowRight size={15} aria-hidden />
                </a>
                <a className={styles.secondaryAction} href="/demo">
                  Try the role-based sandbox
                </a>
              </div>

              <div className={styles.heroTrust} aria-label="Philippine payroll coverage">
                {COVERAGE.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.heroProduct} aria-label="Linaw payroll workspace">
          <div className={styles.productStage} id="hero-product-preview">
            <div className={styles.productStageMeta}>
              <div>
                <span className={styles.stageLabelRow}>
                  Sample payroll workspace
                  <b className={styles.interactiveBadge}>Interactive</b>
                </span>
                <strong>September 16–30 · Needs review</strong>
              </div>
              <div>
                <span>Net payroll</span>
                <strong>₱361,282</strong>
              </div>
              <div>
                <span>Employees</span>
                <strong>42</strong>
              </div>
              <div>
                <span>Exceptions</span>
                <strong>2</strong>
              </div>
            </div>
            <div className={styles.productStageScreen}>
              <WorkspacePreview mode="focused" />
            </div>
          </div>
        </section>

        <section className={styles.workflowSection} id="workflow">
          <div className={styles.shell}>
            <div className={styles.storyIntro}>
              <span className={styles.kicker}>The payroll workflow</span>
              <h2>Payroll should move forward in one direction.</h2>
              <p>
                Every cutoff follows the same visible sequence. The team can see what changed, who still needs to decide,
                and whether the run is actually safe to release.
              </p>
            </div>

            <ol className={styles.flowRail}>
              {PAYROLL_FLOW.map(([step, title, copy]) => (
                <li key={step}>
                  <span className={styles.flowNumber}>{step}</span>
                  <div>
                    <strong>{title}</strong>
                    <p>{copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.controlSection}>
          <div className={`${styles.shell} ${styles.controlGrid}`}>
            <div className={styles.controlCopy}>
              <span className={styles.kicker}>Payroll assurance</span>
              <h2>Know what changed before anyone presses release.</h2>
              <p>
                Linaw does more than produce totals. It keeps the review trail visible and stops the run when critical
                payroll state no longer matches what was approved.
              </p>

              <div className={styles.controlPoints}>
                {CONTROL_POINTS.map((item) => (
                  <span key={item}>
                    <CheckCircle2 size={15} aria-hidden />
                    {item}
                  </span>
                ))}
              </div>

              <a className={styles.textLink} href="/demo">
                Open as Payroll Officer or Checker <ArrowRight size={14} aria-hidden />
              </a>
            </div>

            <div className={styles.assurancePanel} aria-label="Illustrative payroll assurance review">
              <div className={styles.assurancePanelTop}>
                <div>
                  <span>September 16–30</span>
                  <strong>Ready for review</strong>
                </div>
                <span className={styles.statusDot}>2 need attention</span>
              </div>

              <div className={styles.assuranceSummary}>
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

              <div className={styles.changeList}>
                <div>
                  <span className={styles.personBadge}>AV</span>
                  <div>
                    <strong>Aira Villanueva</strong>
                    <p>Net pay is 24% higher than the previous cutoff.</p>
                  </div>
                  <span className={styles.changePositive}>+₱5,870</span>
                </div>
                <div>
                  <span className={styles.personBadge}>RM</span>
                  <div>
                    <strong>Rico Mendoza</strong>
                    <p>Incomplete attendance is affecting this cutoff.</p>
                  </div>
                  <span className={styles.reviewLabel}>Review</span>
                </div>
              </div>

              <div className={styles.explainBar}>
                <div>
                  <span>Why did Aira&apos;s pay change?</span>
                  <strong>Overtime +₱4,230 · Holiday premium +₱1,640</strong>
                </div>
                <ArrowRight size={15} aria-hidden />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.complianceSection} id="compliance">
          <div className={styles.shell}>
            <div className={styles.storyIntro}>
              <span className={styles.kicker}>Philippine compliance</span>
              <h2>The rulebook belongs inside the payroll run.</h2>
              <p>
                Reviewers should not need a side spreadsheet to understand the statutory rules affecting the numbers in
                front of them.
              </p>
            </div>

            <div className={styles.complianceRail}>
              {COMPLIANCE.map(([title, copy]) => (
                <article key={title}>
                  <span>{title}</span>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.migrationSection}>
          <div className={`${styles.shell} ${styles.migrationGrid}`}>
            <div className={styles.migrationCopy}>
              <span className={styles.kicker}>Switch without starting over</span>
              <h2>Bring your payroll history with you.</h2>
              <p>
                Import employees, payroll history, leave balances and loans from another payroll or HRIS. Mid-year
                history is preserved instead of being recalculated under today&apos;s rules.
              </p>

              <div className={styles.sourceCloud}>
                {MIGRATION_SOURCES.map((source) => (
                  <span key={source}>{source}</span>
                ))}
                <span>Other CSV</span>
              </div>

              <a className={styles.textLink} href="#simulation">
                Try the migration flow <ArrowRight size={14} aria-hidden />
              </a>
            </div>

            <div className={styles.migrationSteps} aria-label="Migration process">
              <div>
                <span>01</span>
                <div>
                  <strong>Upload existing exports</strong>
                  <p>Employees, payroll history, leave balances or loans.</p>
                </div>
              </div>
              <div>
                <span>02</span>
                <div>
                  <strong>Review detected mappings</strong>
                  <p>Unknown columns stay visible instead of disappearing silently.</p>
                </div>
              </div>
              <div>
                <span>03</span>
                <div>
                  <strong>Validate before writing</strong>
                  <p>Dry-run counts, errors and warnings appear before anything is committed.</p>
                </div>
              </div>
              <div>
                <span>04</span>
                <div>
                  <strong>Run payroll in Linaw</strong>
                  <p>Imported YTD values remain available for year-end annualization.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.rolesSection}>
          <div className={styles.shell}>
            <div className={styles.rolesBand}>
              <div>
                <span className={styles.kicker}>Role-based sandbox</span>
                <h2>See the product from the seat you actually use.</h2>
                <p>Each persona opens a populated workspace with real role permissions and realistic tasks.</p>
              </div>
              <a className={styles.roleCta} href="/demo">
                Open sandbox <ArrowRight size={14} aria-hidden />
              </a>
            </div>

            <div className={styles.roleLinks} aria-label="Demo roles">
              {DEMO_ROLES.map((role) => (
                <a href="/demo" key={role}>
                  <UsersRound size={13} aria-hidden />
                  {role}
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.supportSection}>
          <div className={styles.shell}>
            <div className={styles.supportIntro}>
              <div>
                <span className={styles.kicker}>Around payroll</span>
                <h2>The HR tools stay close, without taking over the story.</h2>
              </div>
              <p>
                People operations, leave, attendance, loans and offboarding are available when they affect payroll, while
                payroll remains the center of the workspace.
              </p>
            </div>

            <div className={styles.moduleLine}>
              {SUPPORTING_MODULES.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.simulationSection} id="simulation">
          <div className={styles.wideShell}>
            <div className={styles.simulationHead}>
              <div>
                <span className={styles.kicker}>Interactive product</span>
                <h2>Now try the workspace yourself.</h2>
              </div>
              <p>
                Use sample data to open payroll, approve leave, test migration and explore the surrounding modules. The
                public simulation writes nothing.
              </p>
            </div>

            <div className={styles.simulationHints} aria-label="Things to try in the simulation">
              <span>Open Payroll</span>
              <span>Approve Leave</span>
              <span>Try Migration</span>
              <span>Review Compliance</span>
            </div>

            <div className={styles.simulationSurface}>
              <WorkspacePreview mode="interactive" />
            </div>

            <div className={styles.simulationFooter}>
              <span>Want real permissions and persona tasks?</span>
              <a href="/demo">
                Open the role-based sandbox <ArrowRight size={13} aria-hidden />
              </a>
            </div>
          </div>
        </section>

        <section className={styles.pricingSection} id="pricing">
          <div className={styles.shell}>
            <div className={styles.pricingLead}>
              <span className={styles.kicker}>Published pricing</span>
              <h2>Choose by how your payroll operates, not by a feature maze.</h2>
              <p>Set your headcount and compare the monthly cost immediately.</p>
            </div>

            <div className={styles.pricingSurface}>
              <PricingTable plans={plans} />
            </div>
          </div>
        </section>

        <section className={styles.finalSection}>
          <div className={styles.shell}>
            <div className={styles.finalInner}>
              <span className={styles.kicker}>Start with one payroll</span>
              <h2>Make the next cutoff easier to explain, review and release.</h2>
              <p>Start a workspace, or use the role sandbox first and see exactly how your team would work.</p>
              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="/signup">
                  Start free <ArrowRight size={15} aria-hidden />
                </a>
                <a className={styles.secondaryAction} href="/demo">
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
