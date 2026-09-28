import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import styles from "./software-home.module.css";

const COVERAGE = ["SSS", "PhilHealth", "Pag-IBIG", "BIR TRAIN", "DOLE rules"];

const WORKFLOW = [
  {
    step: "01",
    title: "Prepare",
    copy: "Bring attendance, employee changes and cutoff inputs into one place.",
  },
  {
    step: "02",
    title: "Calculate",
    copy: "Apply payroll rules, premiums, deductions and statutory contributions.",
  },
  {
    step: "03",
    title: "Review",
    copy: "Surface exceptions and material changes before they become payroll mistakes.",
  },
  {
    step: "04",
    title: "Approve",
    copy: "Send the run to a different checker with a visible decision trail.",
  },
  {
    step: "05",
    title: "Release",
    copy: "Generate payslips and payroll outputs only after the run is cleared.",
  },
];

const COMPLIANCE = [
  {
    title: "SSS",
    copy: "Contribution rules stay in the same calculation path as the payroll run.",
  },
  {
    title: "PhilHealth",
    copy: "Employee and employer contributions remain visible to the reviewer.",
  },
  {
    title: "Pag-IBIG",
    copy: "Mandatory and supported voluntary contributions stay attached to the run.",
  },
  {
    title: "BIR TRAIN",
    copy: "Withholding is calculated from configured Philippine tax rules.",
  },
  {
    title: "Wage and premium rules",
    copy: "Regional wage floors, holiday premiums and night differential can be applied in payroll.",
  },
];

const ROLE_LINKS = [
  "Owner",
  "Bookkeeper",
  "Payroll",
  "HR",
  "Manager",
  "Employee",
  "Freelancer",
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
                Built for Philippine payroll
              </span>

              <h1>Philippine payroll, without the guesswork.</h1>

              <p className={styles.heroLead}>
                Run payroll, review exceptions, understand every peso and approve with confidence in one calm workspace.
              </p>

              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="/signup">
                  Start free <ArrowRight size={15} aria-hidden />
                </a>
                <a className={styles.secondaryAction} href="#simulation">
                  Explore the product
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

        <section className={styles.workflowSection} id="workflow">
          <div className={styles.shell}>
            <div className={styles.editorialHead}>
              <span className={styles.kicker}>A clearer payroll run</span>
              <h2>One flow from cutoff to release.</h2>
              <p>
                Linaw keeps the payroll process visible so your team always knows what is ready, what needs attention and
                what still needs approval.
              </p>
            </div>

            <ol className={styles.workflow}>
              {WORKFLOW.map((item) => (
                <li key={item.step}>
                  <span className={styles.step}>{item.step}</span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.copy}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.simulationSection} id="simulation">
          <div className={styles.wideShell}>
            <div className={styles.simulationHead}>
              <div>
                <span className={styles.kicker}>Interactive product</span>
                <h2>Try the payroll workspace yourself.</h2>
              </div>
              <p>
                Open Payroll, inspect a payslip, acknowledge an exception and simulate releasing a sample run. The
                interactions are real; the people and payroll data are sample data.
              </p>
            </div>

            <div className={styles.simulationHints} aria-label="Things to try in the simulation">
              <span>Open Payroll</span>
              <span>Expand a payslip</span>
              <span>Review an exception</span>
              <span>Release the sample run</span>
            </div>

            <div className={styles.simulationSurface}>
              <WorkspacePreview mode="interactive" />
            </div>

            <div className={styles.simulationFooter}>
              <span>Want to explore by role?</span>
              <a href="/demo">
                Open the role-based demo <ArrowRight size={13} aria-hidden />
              </a>
            </div>
          </div>
        </section>

        <section className={styles.assuranceSection} id="assurance">
          <div className={`${styles.shell} ${styles.assuranceGrid}`}>
            <div className={styles.assuranceCopy}>
              <span className={styles.kicker}>Payroll assurance</span>
              <h2>Know what changed before you approve payroll.</h2>
              <p>
                Linaw compares the current run with the previous cutoff, surfaces unusual movements and gives reviewers a
                clearer explanation of what changed.
              </p>

              <div className={styles.assurancePoints}>
                <span><Check size={14} aria-hidden /> Material net-pay changes are surfaced for review</span>
                <span><Check size={14} aria-hidden /> Payroll integrity blockers can stop release</span>
                <span><Check size={14} aria-hidden /> Maker and checker stay separate in the approval flow</span>
              </div>
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
                  <span>Employees</span>
                  <strong>42</strong>
                </div>
                <div>
                  <span>Compared</span>
                  <strong>40</strong>
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
                    <p>Incomplete time punch is affecting this cutoff.</p>
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

        <section className={styles.rulesSection}>
          <div className={styles.shell}>
            <div className={styles.rulesIntro}>
              <span className={styles.kicker}>Philippine payroll rules</span>
              <h2>Local payroll rules belong in the product, not in a side spreadsheet.</h2>
              <p>
                The reviewer should be able to see the statutory and wage rules affecting a payroll run without leaving
                the workflow.
              </p>
            </div>

            <div className={styles.rulesList}>
              {COMPLIANCE.map((item) => (
                <article key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.rolesSection}>
          <div className={styles.shell}>
            <div className={styles.rolesBand}>
              <div>
                <span className={styles.kicker}>See the product from every seat</span>
                <h2>One product. Different jobs.</h2>
              </div>
              <a className={styles.roleCta} href="/demo">
                Explore all demo roles <ArrowRight size={14} aria-hidden />
              </a>
            </div>

            <div className={styles.roleLinks} aria-label="Demo roles">
              {ROLE_LINKS.map((role) => (
                <a href="/demo" key={role}>{role}</a>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.pricingSection} id="pricing">
          <div className={styles.shell}>
            <div className={styles.editorialHead}>
              <span className={styles.kicker}>Published pricing</span>
              <h2>See the cost before you talk to anyone.</h2>
              <p>
                Adjust the employee count and the monthly price updates immediately.
              </p>
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
              <h2>Make the next cutoff easier to review.</h2>
              <p>Create a workspace, or explore the role-based demo first.</p>
              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="/signup">
                  Start free <ArrowRight size={15} aria-hidden />
                </a>
                <a className={styles.secondaryAction} href="/demo">
                  Explore demo
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
