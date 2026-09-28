import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  UserCheck,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import styles from "./software-home.module.css";

const HERO_PROOF = [
  "Philippine statutory rules",
  "Transparent pricing",
  "Review before release",
];

const COVERAGE = ["SSS", "PhilHealth", "Pag-IBIG", "BIR TRAIN", "DOLE rules"];

const WORKFLOW = [
  {
    step: "01",
    title: "Prepare",
    copy: "Bring together employee changes, attendance and the inputs needed for the cutoff.",
  },
  {
    step: "02",
    title: "Calculate",
    copy: "Compute payroll, premiums, deductions and statutory contributions from configured rules.",
  },
  {
    step: "03",
    title: "Review",
    copy: "Surface exceptions and unusual changes before they become payroll mistakes.",
  },
  {
    step: "04",
    title: "Approve",
    copy: "Route the run to the right approvers with a clear decision trail.",
  },
  {
    step: "05",
    title: "Release",
    copy: "Produce payslips, bank files and payroll outputs after the run is cleared.",
  },
];

const FEATURES = [
  {
    icon: WalletCards,
    title: "Payroll and statutory deductions",
    copy: "Run semi-monthly payroll with SSS, PhilHealth, Pag-IBIG and TRAIN withholding in the same workflow.",
  },
  {
    icon: Clock3,
    title: "Attendance and exceptions",
    copy: "Turn raw punches into payroll inputs while keeping incomplete punches, tardiness and overtime visible for review.",
  },
  {
    icon: UserCheck,
    title: "Approvals and employee payslips",
    copy: "Keep payroll decisions accountable, then give employees access to their own payroll results and payslips.",
  },
  {
    icon: UploadCloud,
    title: "Bank and accounting outputs",
    copy: "Prepare bank files and accounting exports without rebuilding the payroll register in a separate spreadsheet.",
  },
];

const COMPLIANCE = [
  {
    icon: ShieldCheck,
    title: "SSS",
    copy: "Contribution rules are calculated in the payroll engine.",
  },
  {
    icon: ShieldCheck,
    title: "PhilHealth",
    copy: "Configured contribution rules stay part of the same run.",
  },
  {
    icon: WalletCards,
    title: "Pag-IBIG",
    copy: "Mandatory and supported voluntary contributions remain visible.",
  },
  {
    icon: FileSpreadsheet,
    title: "BIR TRAIN",
    copy: "Semi-monthly withholding is calculated from the configured tax rules.",
  },
  {
    icon: ClipboardCheck,
    title: "Wage rules",
    copy: "Regional wage floors and effective-date rules can be applied to payroll.",
  },
  {
    icon: Layers,
    title: "13th month and premiums",
    copy: "Holiday, night differential and related payroll rules stay in one calculation path.",
  },
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
              <div className={styles.heroEyebrow}>
                <ShieldCheck size={15} aria-hidden />
                Built for Philippine payroll
              </div>

              <h1>Philippine payroll, without the guesswork.</h1>

              <p className={styles.heroLead}>
                Run payroll, attendance, statutory deductions and payslips in one place. Review exceptions and understand
                the numbers before you approve a payroll run.
              </p>

              <div className={styles.heroActions}>
                <a className={styles.primaryAction} href="/signup">
                  Start free <ArrowRight size={16} aria-hidden />
                </a>
                <a className={styles.secondaryAction} href="#workflow">
                  See how it works
                </a>
              </div>

              <div className={styles.heroProof} aria-label="Product highlights">
                {HERO_PROOF.map((item) => (
                  <span key={item}>
                    <Check size={14} aria-hidden />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.coverageStrip} aria-label="Philippine payroll coverage">
              {COVERAGE.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionSoft} id="workflow">
          <div className={styles.shell}>
            <div className={styles.sectionIntro}>
              <span className={styles.kicker}>One clear payroll flow</span>
              <h2>From cutoff to release, every step stays visible.</h2>
              <p>
                Payroll should not feel like five spreadsheets and a chain of messages. Linaw keeps the run moving through
                one reviewable process.
              </p>
            </div>

            <ol className={styles.workflowGrid}>
              {WORKFLOW.map((item) => (
                <li className={styles.workflowCard} key={item.step}>
                  <span className={styles.stepNumber}>{item.step}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} id="explain-pay">
          <div className={`${styles.shell} ${styles.explainGrid}`}>
            <div className={styles.explainCopy}>
              <span className={styles.kicker}>Explain every peso</span>
              <h2>See what changed before payroll is released.</h2>
              <p>
                The payroll register keeps gross pay, premiums, deductions and exceptions together so a reviewer can trace
                the result instead of trusting a black box.
              </p>

              <div className={styles.explainPoints}>
                <span>
                  <Check size={15} aria-hidden />
                  Compare the current cutoff with the previous run
                </span>
                <span>
                  <Check size={15} aria-hidden />
                  Keep attendance exceptions visible during review
                </span>
                <span>
                  <Check size={15} aria-hidden />
                  See statutory deductions alongside the final net pay
                </span>
              </div>
            </div>

            <div className={styles.payCard} aria-label="Illustrative payroll breakdown">
              <div className={styles.payCardHeader}>
                <div>
                  <span className={styles.payCardLabel}>Illustrative pay breakdown</span>
                  <strong>September 16-30</strong>
                </div>
                <span className={styles.reviewStatus}>Ready to review</span>
              </div>

              <div className={styles.payTotal}>
                <span>Net pay</span>
                <strong>₱34,496.00</strong>
                <small>Gross ₱38,930.00</small>
              </div>

              <div className={styles.payBreakdown}>
                <div>
                  <span>Basic pay</span>
                  <strong>₱35,000</strong>
                </div>
                <div>
                  <span>Overtime</span>
                  <strong className={styles.positive}>+₱2,450</strong>
                </div>
                <div>
                  <span>Holiday premium</span>
                  <strong className={styles.positive}>+₱1,480</strong>
                </div>
                <div>
                  <span>SSS</span>
                  <strong>-₱1,750</strong>
                </div>
                <div>
                  <span>PhilHealth</span>
                  <strong>-₱850</strong>
                </div>
                <div>
                  <span>Pag-IBIG</span>
                  <strong>-₱200</strong>
                </div>
                <div>
                  <span>Withholding tax</span>
                  <strong>-₱1,634</strong>
                </div>
              </div>

              <div className={styles.payCardNote}>
                Example presentation only. Payroll results depend on the employee, cutoff and configured rules.
              </div>
            </div>
          </div>
        </section>

        <section className={styles.sectionSoft} id="features">
          <div className={styles.shell}>
            <div className={styles.sectionIntro}>
              <span className={styles.kicker}>The essentials, together</span>
              <h2>Everything around payroll should make payroll easier.</h2>
              <p>
                HRIS, timekeeping, approvals and exports support the payroll run instead of turning into separate systems
                your team has to reconcile.
              </p>
            </div>

            <div className={styles.featureGrid}>
              {FEATURES.map(({ icon: Icon, title, copy }) => (
                <article className={styles.featureCard} key={title}>
                  <span className={styles.featureIcon} aria-hidden>
                    <Icon size={18} />
                  </span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.complianceSection}>
          <div className={styles.shell}>
            <div className={styles.complianceHeader}>
              <div>
                <span className={styles.kickerLight}>Philippine payroll rules</span>
                <h2>Local payroll rules belong in the product, not in a side spreadsheet.</h2>
              </div>
              <p>
                Linaw keeps core Philippine payroll calculations and rule-driven checks inside the payroll workflow so the
                reviewer can see what affected the run.
              </p>
            </div>

            <div className={styles.complianceGrid}>
              {COMPLIANCE.map(({ icon: Icon, title, copy }) => (
                <article key={title}>
                  <Icon size={18} aria-hidden />
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>

            <p className={styles.complianceNote}>
              Government filing worksheets remain labelled DRAFT until they are validated against the agencies&apos; own
              filing tools.
            </p>
          </div>
        </section>

        <section className={styles.pricingSection} id="pricing">
          <div className={styles.shell}>
            <div className={styles.sectionIntro}>
              <span className={styles.kicker}>Simple, published pricing</span>
              <h2>See the monthly cost at your headcount.</h2>
              <p>Adjust the employee count and the pricing updates immediately. No quote request required just to see a number.</p>
            </div>

            <div className={styles.pricingSurface}>
              <PricingTable plans={plans} />
            </div>
          </div>
        </section>

        <section className={styles.finalSection}>
          <div className={styles.shell}>
            <div className={styles.finalCard}>
              <div>
                <span className={styles.kickerLight}>Ready to simplify payroll?</span>
                <h2>Start with one payroll workspace.</h2>
                <p>Create an account, add your team and see how the workflow fits your cutoff process.</p>
              </div>
              <div className={styles.finalActions}>
                <a className={styles.finalPrimary} href="/signup">
                  Start free <ArrowRight size={16} aria-hidden />
                </a>
                <a className={styles.finalSecondary} href="/book-demo">
                  Book a demo
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
