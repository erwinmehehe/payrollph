import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { getPublicPricingPlans } from "@/lib/pricing-catalog";
import { PricingTable } from "@/components/marketing/pricing-table";
import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";
import { WorkspacePreview } from "@/components/marketing/workspace-preview";
import styles from "./software-home.module.css";

const FLOW = [
  ["01", "Prepare", "Attendance, changes and cutoff inputs in one place."],
  ["02", "Review", "See what changed, what needs attention and why."],
  ["03", "Approve", "Keep maker and checker decisions clearly separated."],
  ["04", "Release", "Unlock bank files and payslips only when payroll is ready."],
];

const RULES = ["SSS", "PhilHealth", "Pag-IBIG", "BIR TRAIN"];
const ROLES = ["Owner", "HR Admin", "Payroll Officer", "Checker", "Employee"];

export async function SoftwareHome() {
  const plans = await getPublicPricingPlans();

  return (
    <div className={`site ${styles.page}`}>
      <SiteNav />

      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <span className={styles.eyebrow}>Payroll software, made for the Philippines.</span>

            <h1>Payroll, finally clear.</h1>

            <p className={styles.heroLead}>
              Run payroll, review changes, approve the cutoff and release payslips from one calm workspace.
              Built around Philippine payroll rules, without the clutter.
            </p>

            <div className={styles.heroActions}>
              <a className={styles.primaryAction} href="/signup">
                Start free
              </a>
              <a className={styles.secondaryAction} href="/demo">
                Explore the sandbox <ArrowRight size={14} aria-hidden />
              </a>
            </div>

            <div className={styles.heroCoverage} aria-label="Philippine payroll coverage">
              {RULES.map((item) => (
                <span key={item}>
                  <Check size={12} aria-hidden />
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.heroProductWrap}>
            <div className={styles.heroProduct} id="hero-product-preview">
              <div className={styles.productChrome}>
                <div className={styles.chromeLeft}>
                  <span className={styles.brandDot} aria-hidden />
                  <strong>Linaw</strong>
                  <span>/</span>
                  <span>Payroll</span>
                </div>
                <span className={styles.previewLabel}>Interactive preview</span>
              </div>
              <div className={styles.productCanvas}>
                <WorkspacePreview mode="focused" />
              </div>
            </div>
          </div>
        </section>

        <section className={styles.statementSection}>
          <div className={styles.shell}>
            <div className={styles.statementHead}>
              <span className={styles.kicker}>One continuous workflow</span>
              <h2>From cutoff to payslip, without losing the thread.</h2>
              <p>
                The payroll team sees the same run move from preparation to release. No separate tracker. No mystery
                status. No guessing who owns the next step.
              </p>
            </div>

            <div className={styles.flowGrid}>
              {FLOW.map(([step, title, copy]) => (
                <article key={step}>
                  <span className={styles.flowStep}>{step}</span>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  <ChevronRight size={16} aria-hidden />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.assuranceSection}>
          <div className={styles.shell}>
            <div className={styles.assuranceGrid}>
              <div className={styles.assuranceCopy}>
                <span className={styles.kicker}>Payroll assurance</span>
                <h2>Know what changed before anyone presses release.</h2>
                <p>
                  Linaw surfaces unusual movement, incomplete inputs and release blockers before the money moves, while
                  keeping the reasoning close to the figures.
                </p>

                <div className={styles.assuranceList}>
                  {[
                    "Compare the current cutoff with the previous run",
                    "Keep maker and checker responsibilities separate",
                    "Invalidate stale approvals after recalculation",
                    "Keep final bank exports locked until release",
                  ].map((item) => (
                    <span key={item}>
                      <CheckCircle2 size={15} aria-hidden />
                      {item}
                    </span>
                  ))}
                </div>

                <a className={styles.textLink} href="/demo">
                  See the checker workflow <ArrowRight size={14} aria-hidden />
                </a>
              </div>

              <div className={styles.assuranceVisual} aria-label="Illustrative payroll assurance view">
                <div className={styles.assuranceToolbar}>
                  <div>
                    <span>September 16–30</span>
                    <strong>Payroll assurance</strong>
                  </div>
                  <span className={styles.reviewPill}>Needs review</span>
                </div>

                <div className={styles.assuranceMetrics}>
                  <div>
                    <span>Net payroll</span>
                    <strong>₱361,282</strong>
                  </div>
                  <div>
                    <span>Employees</span>
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
                    <span className={styles.needsReview}>Review</span>
                  </div>
                </div>

                <div className={styles.explainRow}>
                  <div>
                    <span>Why did Aira&apos;s pay change?</span>
                    <strong>Overtime +₱4,230 · Holiday premium +₱1,640</strong>
                  </div>
                  <ArrowRight size={14} aria-hidden />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.bentoSection}>
          <div className={styles.shell}>
            <div className={styles.bentoIntro}>
              <span className={styles.kicker}>Built around real payroll work</span>
              <h2>Everything around payroll, kept in proportion.</h2>
            </div>

            <div className={styles.bentoGrid}>
              <article className={`${styles.bentoCard} ${styles.complianceCard}`}>
                <span className={styles.cardIcon}><ShieldCheck size={17} aria-hidden /></span>
                <span className={styles.cardEyebrow}>Philippine compliance</span>
                <h3>The rulebook belongs inside the payroll run.</h3>
                <p>
                  Review the statutory basis next to the payroll figures instead of cross-checking a side spreadsheet.
                </p>
                <div className={styles.ruleRow}>
                  {RULES.map((item) => <span key={item}>{item}</span>)}
                </div>
              </article>

              <article className={`${styles.bentoCard} ${styles.rolesCard}`}>
                <span className={styles.cardIcon}><UsersRound size={17} aria-hidden /></span>
                <span className={styles.cardEyebrow}>Role-aware by default</span>
                <h3>Every person sees the work that belongs to them.</h3>
                <p>
                  Owners, HR, payroll, checker and employees get focused views instead of one oversized admin interface.
                </p>
                <div className={styles.roleList}>
                  {ROLES.map((role) => <span key={role}>{role}</span>)}
                </div>
              </article>

              <article className={`${styles.bentoCard} ${styles.migrationCard}`}>
                <span className={styles.cardEyebrow}>Switch without starting over</span>
                <h3>Bring your payroll history with you.</h3>
                <p>
                  Import employee and payroll history, leave balances and loans while preserving the year-to-date context
                  you still need for year-end work.
                </p>
                <div className={styles.sourceRow}>
                  <span>Sprout</span>
                  <span>Salarium</span>
                  <span>PayrollHero</span>
                  <span>CSV</span>
                </div>
              </article>

              <article className={`${styles.bentoCard} ${styles.hrCard}`}>
                <span className={styles.cardEyebrow}>Around payroll</span>
                <h3>The HR tools stay close, without taking over the story.</h3>
                <p>
                  People, attendance, leave, loans, benefits, expenses and separation stay available when they affect
                  payroll.
                </p>
                <a className={styles.inlineLink} href="/demo">
                  Explore modules <ArrowRight size={13} aria-hidden />
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.sandboxSection} id="simulation">
          <div className={styles.wideShell}>
            <div className={styles.sandboxHead}>
              <div>
                <span className={styles.kicker}>Interactive product</span>
                <h2>Explore the product without sitting through a sales demo.</h2>
              </div>
              <p>
                Open payroll, review leave, test migration and move through the same navigation used by the real
                workspace. The public simulation writes nothing.
              </p>
            </div>

            <div className={styles.sandboxWindow}>
              <div className={styles.sandboxChrome}>
                <div className={styles.chromeLeft}>
                  <span className={styles.brandDot} aria-hidden />
                  <strong>Linaw</strong>
                  <span>/</span>
                  <span>Sandbox</span>
                </div>
                <div className={styles.roleDots}>
                  {ROLES.slice(0, 3).map((role) => <span key={role}>{role}</span>)}
                </div>
              </div>
              <div className={styles.simulationSurface}>
                <WorkspacePreview mode="interactive" />
              </div>
            </div>

            <div className={styles.sandboxFoot}>
              <span>Want the full role-based experience?</span>
              <a href="/demo">Open the sandbox <ArrowRight size={13} aria-hidden /></a>
            </div>
          </div>
        </section>

        <section className={styles.pricingSection} id="pricing">
          <div className={styles.shell}>
            <div className={styles.pricingHead}>
              <span className={styles.kicker}>Simple pricing</span>
              <h2>Know what payroll will cost before you talk to anyone.</h2>
              <p>Set your headcount and compare the operating model that fits your team.</p>
            </div>

            <div className={styles.pricingSurface}>
              <PricingTable plans={plans} />
            </div>
          </div>
        </section>

        <section className={styles.finalSection}>
          <div className={styles.shell}>
            <div className={styles.finalInner}>
              <span className={styles.finalEyebrow}>Linaw</span>
              <h2>Less payroll noise.<br />More confidence.</h2>
              <p>Start with a real workspace, or use the sandbox first and see how the product works.</p>
              <div className={styles.finalActions}>
                <a className={styles.finalPrimary} href="/signup">Start free</a>
                <a className={styles.finalSecondary} href="/demo">
                  Explore sandbox <ArrowRight size={14} aria-hidden />
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
