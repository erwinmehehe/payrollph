"use client";

/**
 * Panels carried over from the first workspace build.
 *
 * These views were already wired to real endpoints, so the redesign restyles
 * them through the shared design system rather than rewriting their behaviour.
 * They keep the original `setNotice(message)` signature; the router passes a
 * neutral info-toast adapter so a legacy message can never be mistaken for a
 * success confirmation it did not earn.
 */

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CloudCog,
  CreditCard,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Gauge,
  HelpCircle,
  LockKeyhole,
  Mail,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UserCheck,
  UsersRound,
  WalletCards,
  Webhook,
  X,
} from "lucide-react";
import { AccountPanel } from "@/components/account-panel";
import { StatutoryRemittancePanel } from "@/components/workspace/statutory-remittance-panel";
import { ComplianceCalendarPanel } from "@/components/workspace/compliance-calendar-panel";
import { LaborInspectionReadinessPanel } from "@/components/workspace/labor-inspection-readiness-panel";
import { LaborInspectionDrillPanel } from "@/components/workspace/labor-inspection-drill-panel";
import { PayrollMonthClosePanel } from "@/components/workspace/payroll-month-close-panel";
import { DoleThirteenthMonthReportPanel } from "@/components/workspace/dole-thirteenth-month-report-panel";
import { CompliancePolicyReviewPanel } from "@/components/workspace/compliance-policy-review-panel";
import { INVITABLE_ROLES, invitableRoleLabel } from "@/lib/roles";
import type { AuditEvent, DashboardData, Employee, OrgUnit, PayrollEntry, PayrollRun, PricingPlan } from "./types";
import { Avatar, Metric, PageHeading, Status, formatDate, formatDateTime as formatTime, money } from "./ui";
export function LeavePage({ data, setNotice, onRefresh }: { data: DashboardData; setNotice: (message: string) => void; onRefresh: () => Promise<void> }) {
  const requests = data.leaveRequests ?? [];
  const policies = data.leavePolicies ?? [];
  const configuredPolicies = policies.filter(
    (policy) => policy.active && ["paid", "unpaid", "partial"].includes(policy.payTreatment),
  );
  const pending = requests.filter((row) => row.status === "Pending");
  const approvedDays = requests.filter((row) => row.status === "Approved").reduce((sum, row) => sum + Number(row.days), 0);
  const canManagePolicies = ["owner", "admin", "bookkeeper", "hr", "manager"].includes(data.access?.role ?? "");

  const [open, setOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? 0);
  const [leaveType, setLeaveType] = useState("Annual leave");
  const [startDate, setStartDate] = useState("2026-03-24");
  const [endDate, setEndDate] = useState("2026-03-24");
  const [days, setDays] = useState(1);

  const [policyLeaveType, setPolicyLeaveType] = useState("Annual leave");
  const [annualDays, setAnnualDays] = useState(15);
  const [payTreatment, setPayTreatment] = useState<"paid" | "unpaid" | "partial">("paid");
  const [paidPercentage, setPaidPercentage] = useState(50);

  useEffect(() => {
    if (
      configuredPolicies.length > 0 &&
      !configuredPolicies.some((policy) => policy.leaveType === leaveType)
    ) {
      setLeaveType(configuredPolicies[0].leaveType);
    }
  }, [configuredPolicies, leaveType]);

  async function submit() {
    if (configuredPolicies.length === 0) {
      setNotice("Configure at least one leave payroll treatment before submitting leave.");
      return;
    }
    const response = await fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: data.selectedOrganization.id, employeeId, leaveType, startDate, endDate, days, reason: "Submitted in workspace" }),
    });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "Could not submit leave."); return; }
    setOpen(false);
    await onRefresh();
    setNotice("Leave request submitted and queued for approval.");
  }

  function editPolicy(policy: NonNullable<DashboardData["leavePolicies"]>[number]) {
    setPolicyLeaveType(policy.leaveType);
    setAnnualDays(Number(policy.annualDays));
    const treatment = ["paid", "unpaid", "partial"].includes(policy.payTreatment)
      ? policy.payTreatment as "paid" | "unpaid" | "partial"
      : "paid";
    setPayTreatment(treatment);
    setPaidPercentage(
      treatment === "partial" ? Number(policy.paidPercentage || 50) : treatment === "paid" ? 100 : 0,
    );
    setPolicyOpen(true);
  }

  async function savePolicy() {
    const response = await fetch("/api/leave/balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: data.selectedOrganization.id,
        leaveType: policyLeaveType,
        annualDays,
        payTreatment,
        paidPercentage: payTreatment === "partial" ? paidPercentage : payTreatment === "paid" ? 100 : 0,
      }),
    });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "Could not save leave policy."); return; }
    setPolicyOpen(false);
    await onRefresh();
    setNotice(`${policyLeaveType} payroll treatment saved.`);
  }

  return (
    <>
      <PageHeading
        eyebrow="LEAVE MANAGEMENT"
        title="Keep leave human and payroll-safe."
        copy="Every leave type has an explicit pay treatment. Approved leave flows into the payroll cutoff instead of silently disappearing from pay."
        actions={<button className="primary-button" onClick={() => setOpen(!open)}><Plus size={17} className="i-green" /> New leave request</button>}
      />
      <section className="stats-grid">
        <Metric label="PENDING" value={String(pending.length)} hint="Needs manager review" icon={<CalendarDays size={19} className="i-cyan" />} tone="amber" />
        <Metric label="ON LEAVE" value={String(data.employees.filter((e) => e.status === "On leave").length)} hint="Across this client" icon={<UsersRound size={19} className="i-purple" />} tone="purple" />
        <Metric label="APPROVED DAYS" value={String(approvedDays)} hint="On record" icon={<Gauge size={19} className="i-blue" />} tone="mint" />
        <Metric label="PAY POLICIES" value={String(configuredPolicies.length)} hint={policies.some((policy) => policy.payTreatment === "unconfigured") ? "Some need payroll setup" : "Explicit treatment"} icon={<BookOpen size={19} className="i-teal" />} tone="blue" />
      </section>

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">PAYROLL TREATMENT</div>
            <h2>Paid, unpaid, or partially paid</h2>
            <p>Payroll refuses to guess when an approved leave type has no configured treatment.</p>
          </div>
          {canManagePolicies && <button className="secondary-button" onClick={() => setPolicyOpen(!policyOpen)}><Plus size={16} /> Configure policy</button>}
        </div>

        {policyOpen && canManagePolicies && (
          <div className="setting-form" style={{ marginBottom: 16 }}>
            <label>Leave type<input value={policyLeaveType} onChange={(event) => setPolicyLeaveType(event.target.value)} placeholder="Annual leave" /></label>
            <label>Annual days<input type="number" min={0.5} step={0.5} value={annualDays} onChange={(event) => setAnnualDays(Number(event.target.value))} /></label>
            <label>Payroll treatment
              <select value={payTreatment} onChange={(event) => setPayTreatment(event.target.value as "paid" | "unpaid" | "partial")}>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
                <option value="partial">Partially paid</option>
              </select>
            </label>
            {payTreatment === "partial" && (
              <label>Paid percentage<input type="number" min={1} max={99} step={1} value={paidPercentage} onChange={(event) => setPaidPercentage(Number(event.target.value))} /></label>
            )}
            <div className="run-actions">
              <button className="secondary-button" onClick={() => setPolicyOpen(false)}>Cancel</button>
              <button className="primary-button" onClick={savePolicy}>Save treatment</button>
            </div>
          </div>
        )}

        {policies.length === 0 && <div className="empty-state">No leave policies configured yet. Add one before approving leave for payroll.</div>}
        {policies.map((policy) => (
          <div className="leave-request" key={policy.id}>
            <div className="inline-icon mint"><BookOpen size={17} /></div>
            <div style={{ flex: 1 }}>
              <strong>{policy.leaveType}</strong>
              <span>
                {policy.annualDays} days/year · {
                  policy.payTreatment === "paid"
                    ? "Paid 100%"
                    : policy.payTreatment === "unpaid"
                      ? "Unpaid"
                      : policy.payTreatment === "partial"
                        ? `Paid ${policy.paidPercentage}%`
                        : "Payroll treatment not configured"
                }
              </span>
            </div>
            <Status value={policy.payTreatment === "unconfigured" ? "Needs setup" : policy.payTreatment} />
            {canManagePolicies && <button className="secondary-button" onClick={() => editPolicy(policy)}>Edit</button>}
          </div>
        ))}
      </article>

      {open && (
        <article className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div><div className="card-kicker">NEW LEAVE</div><h2>Submit leave application</h2></div></div>
          <div className="setting-form">
            <label>Employee<select value={employeeId} onChange={(event) => setEmployeeId(Number(event.target.value))}>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}</option>)}</select></label>
            <label>Leave Type
              <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)} disabled={configuredPolicies.length === 0}>
                {configuredPolicies.length === 0
                  ? <option>No configured leave policy</option>
                  : configuredPolicies.map((policy) => <option key={policy.id} value={policy.leaveType}>{policy.leaveType}</option>)}
              </select>
            </label>
            <label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label>End date<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <label>Days<input type="number" min={0.5} step={0.5} value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>
          </div>
          <div className="run-actions">
            <button className="secondary-button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary-button" onClick={submit} disabled={configuredPolicies.length === 0}>Submit request</button>
          </div>
        </article>
      )}

      <article className="card leave-board">
        <div className="card-header"><div><div className="card-kicker">REQUESTS</div><h2>Leave register</h2></div></div>
        {requests.length === 0 && <div className="empty-state">No leave requests yet.</div>}
        {requests.map((row) => {
          const employee = data.employees.find((item) => item.id === row.employeeId);
          const start = new Date(`${row.startDate}T12:00:00`);
          const policy = policies.find((item) => item.leaveType.toLowerCase() === row.leaveType.toLowerCase());
          return (
            <div className="leave-request" key={row.id}>
              <span className="date-tile"><small>{start.toLocaleString("en-PH", { month: "short" }).toUpperCase()}</small><b>{start.getDate()}</b></span>
              <Avatar initials={employee?.avatarInitials ?? "NA"} index={row.employeeId} />
              <div style={{ flex: 1 }}>
                <strong>{employee ? `${employee.firstName} ${employee.lastName}` : "Employee"}</strong>
                <span>
                  {row.leaveType} · {row.startDate}–{row.endDate} · {row.days} days
                  {policy ? ` · ${policy.payTreatment === "partial" ? `${policy.paidPercentage}% paid` : policy.payTreatment}` : " · payroll treatment missing"}
                </span>
              </div>
              <Status value={row.status === "Pending" ? "Awaiting approval" : row.status} />
            </div>
          );
        })}
      </article>
    </>
  );
}

export function CompliancePage({ data, setNotice, onOpenGovModal }: { data: DashboardData; setNotice: (message: string) => void; onOpenGovModal: () => void }) {
  const defaultMonth = (
    data.payrollRuns.find((run) => run.status !== "Released")?.payDate
    ?? data.payrollRuns[0]?.payDate
    ?? new Date().toISOString().slice(0, 10)
  ).slice(0, 7);
  const payrollExceptions = data.payrollRuns.reduce((sum, run) => sum + run.exceptions, 0);
  const releasedRuns = data.payrollRuns.filter((run) => run.status === "Released").length;

  return (
    <>
      <PageHeading
        eyebrow="COMPLIANCE CENTER"
        title="From payroll rule to proof."
        copy="See statutory rules, payroll exceptions, remittance evidence, year-end tax controls and government-output validation in one operational workspace."
        actions={
          <button className="primary-button" onClick={onOpenGovModal}>
            <ShieldCheck size={16} className="i-green" /> Check government output
          </button>
        }
      />

      <article className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">CONTROL POSTURE</div>
            <h2>What needs attention now</h2>
            <p>This is an operational control view, not a legal certification score. It uses this workspace&apos;s stored payroll and audit evidence.</p>
          </div>
        </div>
        <div className="run-stats" style={{ margin: 0 }}>
          <div>
            <span>Payroll exceptions</span>
            <strong className={payrollExceptions ? "red-number" : "green-number"}>{payrollExceptions}</strong>
            <small>{payrollExceptions ? "review before release" : "no stored run exceptions"}</small>
          </div>
          <div>
            <span>Released payrolls</span>
            <strong>{releasedRuns}</strong>
            <small>evidence-bearing runs on record</small>
          </div>
          <div>
            <span>Audit evidence</span>
            <strong>{data.auditEvents.length}</strong>
            <small>recorded actions in this workspace</small>
          </div>
          <div>
            <span>Government filing</span>
            <strong>Evidence-gated</strong>
            <small>prepared output is not agency acceptance</small>
          </div>
        </div>
      </article>

      <section className="module-grid three">
        <article className="card compliance-tile">
          <div className="inline-icon mint"><ShieldCheck size={19} /></div>
          <span>STATUTORY RULES</span>
          <h2>Versioned</h2>
          <p>SSS, PhilHealth, Pag-IBIG, TRAIN, MWE and premium-pay logic are executable and regression-tested.</p>
          <Status value="Implemented" />
        </article>
        <article className="card compliance-tile">
          <div className="inline-icon purple"><ReceiptText size={19} /></div>
          <span>REMITTANCE CONTROL</span>
          <h2>Reconciled to posting</h2>
          <p>Track payroll liability through payment evidence and employee-level agency posting instead of stopping at deduction.</p>
          <Status value="Evidence required" />
        </article>
        <article className="card compliance-tile">
          <div className="inline-icon amber"><FileSpreadsheet size={19} /></div>
          <span>GOVERNMENT OUTPUTS</span>
          <h2>Validation-gated</h2>
          <p>BIR, SSS, PhilHealth and Pag-IBIG outputs stay clearly separated from government portal acceptance.</p>
          <Status value="Portal proof required" />
        </article>
      </section>

      <div style={{ marginTop: 16 }}>
        <CompliancePolicyReviewPanel organizationId={data.selectedOrganization.id} />
      </div>

      <div style={{ marginTop: 16 }}>
        <LaborInspectionReadinessPanel
          organizationId={data.selectedOrganization.id}
          notify={(message) => setNotice(message)}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <PayrollMonthClosePanel
          organizationId={data.selectedOrganization.id}
          notify={(message) => setNotice(message)}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <LaborInspectionDrillPanel
          organizationId={data.selectedOrganization.id}
          notify={(message) => setNotice(message)}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <ComplianceCalendarPanel organizationId={data.selectedOrganization.id} />
      </div>

      <div style={{ marginTop: 16 }}>
        <StatutoryRemittancePanel
          organizationId={data.selectedOrganization.id}
          defaultMonth={defaultMonth}
          notify={(message) => setNotice(message)}
        />
      </div>

      {data.advisories.length > 0 && (
        <section className="card calamity-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", marginTop: 16 }}>
          <div className="calamity-badge" style={{ padding: "6px 10px", borderRadius: 6, background: "#fae7c5", color: "#874d12", fontSize: 9, fontWeight: 900 }}>ACTIVE CALAMITY ADVISORY</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>{data.advisories[0].advisoryNumber} · {data.advisories[0].policy}</h2>
            <p style={{ margin: "2px 0 0", color: "var(--muted)", fontSize: 11 }}>{data.advisories[0].affectedUnit} · {formatDate(data.advisories[0].startDate)}–{formatDate(data.advisories[0].endDate)}</p>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <span className="status status-verified">Applied by payroll rules</span>
          </div>
        </section>
      )}

      <YearEndPanel organizationId={data.selectedOrganization.id} setNotice={setNotice} />
      <DoleThirteenthMonthReportPanel
        organizationId={data.selectedOrganization.id}
        notify={(message) => setNotice(message)}
      />
    </>
  );
}

function YearEndPanel({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [taxYear, setTaxYear] = useState(2026);
  const [summary, setSummary] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load(year: number) {
    const response = await fetch(`/api/year-end?organizationId=${organizationId}&taxYear=${year}`, { cache: "no-store" });
    if (response.ok) setSummary(await response.json());
  }

  async function runAnnualization() {
    setBusy(true);
    try {
      const response = await fetch("/api/year-end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, taxYear }),
      });
      const payload = await response.json();
      if (!response.ok) { setNotice(payload.error ?? "Annualization failed."); return; }
      if (payload.warning) setNotice(payload.warning);
      else setNotice(`Annualized ${payload.employees} employees: ${payload.refunds} refund(s), ${payload.collections} collection(s).`);
      await load(taxYear);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div><div className="card-kicker">YEAR-END ANNUALIZATION</div><h2>December tax adjustment (BIR 2316)</h2><p>Sums released runs for the year, applies the ₱90k 13th-month exemption, and reconciles tax due vs withheld.</p></div>
        <div className="heading-actions">
          <select value={taxYear} onChange={(event) => { setTaxYear(Number(event.target.value)); setSummary(null); }} style={{ height: 35, borderRadius: 8, border: "1px solid var(--line)", padding: "0 10px", fontSize: 12 }}>
            <option value={2026}>Tax year 2026</option>
            <option value={2025}>Tax year 2025</option>
          </select>
          <button className="primary-button" onClick={runAnnualization} disabled={busy}>{busy ? "Computing…" : "Run annualization"}</button>
        </div>
      </div>
      {summary?.rows?.length ? (
        <>
          <div className="run-stats">
            <div><span>Employees annualized</span><strong>{summary.count}</strong></div>
            <div><span>Total refunds</span><strong className="green-number">{money(summary.totalRefund)}</strong></div>
            <div><span>Total collections</span><strong>{money(summary.totalCollect)}</strong></div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>EMPLOYEE</th><th>TAXABLE INCOME</th><th>TAX DUE</th><th>WITHHELD</th><th>ADJUSTMENT</th><th>2316</th></tr></thead>
              <tbody>
                {summary.rows.map((row: any) => (
                  <tr key={row.employeeId}>
                    <td><strong>{row.name}</strong>{row.mwe && <small className="mwe-tag">MWE</small>}</td>
                    <td>{money(row.taxableIncome)}</td>
                    <td>{money(row.taxDue)}</td>
                    <td>{money(row.taxWithheld)}</td>
                    <td><Status value={row.outcome === "refund" ? "Refund" : row.outcome === "collect" ? "Collect" : "Balanced"} /> {money(Math.abs(Number(row.adjustment)))}</td>
                    <td><a className="link-button" href={`/api/year-end?organizationId=${organizationId}&taxYear=${taxYear}&employeeId=${row.employeeId}&format=2316`}><Download size={13} style={{ display: "inline" }} /> Draft</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="run-actions">
            <a className="secondary-button" href={`/api/year-end?organizationId=${organizationId}&taxYear=${taxYear}&format=alphalist`}><FileSpreadsheet size={16} className="i-teal" /> Alphalist 1604-C CSV</a>
          </div>
        </>
      ) : (
        <div className="empty-state">Run annualization to compute December tax adjustments and generate draft BIR 2316 certificates.</div>
      )}
    </article>
  );
}

export function FreelancerPage({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const [income, setIncome] = useState(82000);
  const [expenses, setExpenses] = useState(180000);
  const annualGross = income * 12;
  const flat = Math.max(0, annualGross - 250000) * 0.08;
  const taxable = Math.max(0, annualGross - expenses);
  const graduated = taxable <= 250000 ? 0 : taxable <= 400000 ? (taxable - 250000) * 0.15 : 22500 + (taxable - 400000) * 0.2;
  const preferred = flat <= graduated ? "8% flat" : "Graduated";
  const soloOrg = data.organizations.find((organization) => organization.accountType === "freelancer");

  return (
    <>
      <PageHeading eyebrow="SELF-EMPLOYED HUB" title="A better solo finance routine." copy="Model voluntary contributions and compare tax approaches without the overhead of a company setup." actions={<button className="secondary-button" onClick={() => setNotice("Solo planner values are session-local in this build.")}><RefreshCw size={16} className="i-blue" /> Save planner</button>} />
      <section className="solo-hero" style={{ padding: "28px 32px", borderRadius: 14, background: "linear-gradient(135deg, #0e2e28 0%, #154c41 100%)", color: "white" }}>
        <div className="solo-hero-copy">
          <span className="solo-chip">FOR FREELANCERS & SELF-EMPLOYED</span>
          <h2 style={{ fontSize: 24, margin: "10px 0 6px", fontWeight: 800 }}>Know what to set aside <em>before</em> deadline week.</h2>
          <p style={{ margin: 0, color: "#a5cec0", fontSize: 12.5 }}>Compare 8% Gross Income Tax vs Graduated Income Tax under the TRAIN Law.</p>
        </div>
        <div className="solo-stash" style={{ background: "rgba(255,255,255,0.08)", padding: 16, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)" }}>
          <span style={{ fontSize: 10, color: "#8ec4b2", textTransform: "uppercase", fontWeight: 800 }}>Suggested Monthly Tax Reserve</span>
          <strong style={{ display: "block", fontSize: 22, color: "#50d29d", margin: "4px 0" }}>{money((preferred === "8% flat" ? flat : graduated) / 12)}</strong>
          <small style={{ color: "#a5cec0", fontSize: 10 }}>Based on lower modeled option</small>
        </div>
      </section>

      <section className="solo-grid" style={{ marginTop: 18 }}>
        <article className="card planner-card">
          <div className="card-header"><div><div className="card-kicker">TAX COMPARISON</div><h2>Find your better path</h2></div><Status value="Planner" /></div>
          <label className="input-label" style={{ padding: "0 18px" }}>Average monthly gross income
            <div className="currency-input"><span>₱</span><input type="number" value={income} min="0" onChange={(event) => setIncome(Number(event.target.value))} /></div>
          </label>
          <label className="input-label" style={{ padding: "0 18px" }}>Annual deductible expenses
            <div className="currency-input"><span>₱</span><input type="number" value={expenses} min="0" onChange={(event) => setExpenses(Number(event.target.value))} /></div>
          </label>
          <div className="tax-compare" style={{ margin: "14px 18px 0" }}>
            <div className={preferred === "8% flat" ? "recommended" : ""}><span>8% flat option</span><strong>{money(flat)}</strong><small>{preferred === "8% flat" ? "Recommended" : "Annual estimate"}</small></div>
            <div className={preferred === "Graduated" ? "recommended" : ""}><span>Graduated option</span><strong>{money(graduated)}</strong><small>{preferred === "Graduated" ? "Recommended" : "Annual estimate"}</small></div>
          </div>
          <p className="disclaimer">Planning estimate only under TRAIN Law R.A. 10963.</p>
        </article>

        <article className="card contribution-card">
          <div className="card-header"><div><div className="card-kicker">VOLUNTARY SAFETY NETS</div><h2>Individual contributions</h2></div><Status value="PHP" /></div>
          <div className="contribution-list">
            <Contribution name="SSS Voluntary" value="₱1,750" note="Based on ₱35,000 MSC cap" />
            <Contribution name="PhilHealth Individual" value="₱2,050" note="Personal 5% premium base" />
            <Contribution name="Pag-IBIG MP1 Mandatory" value="₱100" note="Member contribution cap" />
            <Contribution name="Pag-IBIG MP2 Voluntary" value="₱2,000" note="Tax-free 7%+ dividend yield" />
          </div>
        </article>
      </section>
    </>
  );
}

function Contribution({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <div className="contribution" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", borderBottom: "1px solid #edf2ee" }}>
      <span className="contribution-mark" style={{ width: 28, height: 28, borderRadius: 7, background: "#e8f5f0", color: "var(--green)", display: "grid", placeItems: "center", fontWeight: 800 }}>₱</span>
      <div style={{ flex: 1 }}><strong>{name}</strong><small style={{ display: "block", color: "var(--muted)", fontSize: 10 }}>{note}</small></div>
      <b>{value}</b>
    </div>
  );
}


export function IntegrationsPage({ onOpenOutbox }: { onOpenOutbox?: () => void }) {
  const entries = [
    ["Accounting", "Xero / QuickBooks Online", "Journal CSV mapping ready", "File based"],
    ["Banking", "BDO, BPI, UnionBank, GCash", "Versioned templates + byte generators", "Validated"],
    ["Outbox & Email", "Resend / Postmark / Outbox", "Transactional mail & SMS queue inspector", "Outbox Ready"],
    ["Identity", "SAML SSO", "Architecture reserved; no IdP connected", "Not configured"],
    ["Storage", "S3 / Cloudflare R2", "MIME magic-byte sniffing + SHA-256 storage", "Active"],
    ["Public API", "ERP & Webhook Engine", "Documented event surface + HMAC signing", "v1 Live"],
  ];

  return (
    <>
      <PageHeading
        eyebrow="INTEGRATIONS"
        title="Connect without pretending."
        copy="Integration cards clearly state their current mode: template, credential-required, or live."
        actions={onOpenOutbox ? <button className="primary-button" onClick={onOpenOutbox}><Mail size={16} className="i-pink" /> View Email Outbox</button> : undefined}
      />
      <section className="integration-grid">
        {entries.map(([type, name, copy, state], index) => (
          <article className="card integration-card" key={name}>
            <div className={`integration-icon tone-${index % 4}`}><CloudCog size={20} className="i-blue" /></div>
            <span>{type}</span>
            <h2>{name}</h2>
            <p>{copy}</p>
            <div>
              <Status value={state} />
              {(!name.includes("Outbox") || onOpenOutbox) && (
                <button className="row-more" onClick={name.includes("Outbox") ? onOpenOutbox : undefined}><ArrowUpRight size={17} /></button>
              )}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

export function DeveloperPage({ organizationId, setNotice }: { organizationId: number; setNotice: (message: string) => void }) {
  const [state, setState] = useState<{ apiKeys: any[]; webhookEndpoints: any[]; deliveries: any[]; availableEvents: string[] } | null>(null);
  const [freshKey, setFreshKey] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("https://httpbin.org/status/200");
  const [loaded, setLoaded] = useState(false);

  const [nonce, setNonce] = useState(0);
  // Loaded from an effect (not during render) so state is never set in the
  // render phase; `alive` prevents a stale response overwriting a newer one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const response = await fetch(`/api/developer?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      if (!alive) return;
      if (payload) setState(payload);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function load() {
    setNonce((n) => n + 1);
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/developer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId, ...body }),
    });
    const payload = await response.json();
    if (!response.ok) { setNotice(payload.error ?? "Request failed."); return null; }
    await load();
    return payload;
  }

  return (
    <>
      <PageHeading eyebrow="DEVELOPER" title="Two-way integration, not just file exports." copy="Issue scoped API keys and subscribe to HMAC-signed webhook events. Delivery attempts are logged with real response codes and exponential backoff retry." actions={<a className="secondary-button" href="/api/v1"><BookOpen size={16} className="i-teal" /> API reference</a>} />
      <section className="module-grid two">
        <article className="card">
          <div className="card-header"><div><div className="card-kicker">API KEYS</div><h2>Scoped access keys</h2><p>Keys are stored as SHA-256 hashes and shown once.</p></div><button className="primary-button" onClick={async () => { const created = await post({ action: "create-key", name: "ERP Sync Key" }); if (created?.key) { setFreshKey(created.key); setNotice("API key created. Copy it now, it is not retrievable later."); } }}><Plus size={16} className="i-green" /> New key</button></div>
          {freshKey && <div className="notice notice-green"><Check size={16} className="i-green" /><span><strong>Copy now:</strong> <code>{freshKey}</code></span></div>}
          <div className="worksheet-list">{(state?.apiKeys ?? []).length === 0 ? <div className="empty-state">No API keys yet.</div> : state?.apiKeys.map((key) => <div key={key.id}><LockKeyhole size={17} className="i-amber" /><span>{key.name} · <code>{key.prefix}…</code> {key.revokedAt ? "(revoked)" : ""}</span>{!key.revokedAt && <button className="row-more" onClick={() => post({ action: "revoke-key", keyId: key.id })}><X size={16} /></button>}</div>)}</div>
        </article>

        <article className="card">
          <div className="card-header"><div><div className="card-kicker">WEBHOOKS</div><h2>Event subscriptions</h2><p>Signed with <code>Linaw-Signature</code>.</p></div><button className="secondary-button" onClick={() => post({ action: "test-webhook" }).then(() => setNotice("Test event dispatched. Check the delivery log for the real result."))}><Send size={15} className="i-pink" /> Send test event</button></div>
          <label className="input-label" style={{ padding: "0 18px" }}>Endpoint URL<input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} /></label>
          <div style={{ padding: "0 18px 14px" }}><button className="primary-button full" onClick={async () => { const created = await post({ action: "create-webhook", url: webhookUrl, events: state?.availableEvents ?? [] }); if (created) setNotice("Webhook endpoint registered with a generated signing secret."); }}><Plus size={16} className="i-green" /> Register endpoint</button></div>
          <div className="worksheet-list">{(state?.webhookEndpoints ?? []).length === 0 ? <div className="empty-state">No endpoints registered.</div> : state?.webhookEndpoints.map((endpoint) => <div key={endpoint.id}><Webhook size={17} className="i-blue" /><span>{endpoint.url}</span><Status value={endpoint.active ? "Active" : "Paused"} /></div>)}</div>
        </article>
      </section>

      <article className="card audit-card" style={{ marginTop: 16 }}>
        <div className="table-toolbar"><div><div className="card-kicker">DELIVERY LOG</div><h2>Real attempts, real outcomes</h2></div><Status value="Honest" /></div>
        <div className="audit-list">{(state?.deliveries ?? []).length === 0 ? <div className="empty-state">No deliveries attempted yet. Register an endpoint and send a test.</div> : state?.deliveries.map((delivery) => <div className="audit-row" key={delivery.id}><span className="audit-dot"><Webhook size={14} className="i-blue" /></span><div><strong>{delivery.event}</strong><p>{delivery.error ? delivery.error : `HTTP ${delivery.responseCode ?? "-"}`}</p></div><div><Status value={delivery.status === "delivered" ? "Approved" : "Failed"} /><time>{formatTime(delivery.createdAt)}</time></div></div>)}</div>
      </article>
    </>
  );
}

export function PricingPage({ plans, onSelectPlan }: { plans: PricingPlan[]; onSelectPlan: (plan: PricingPlan) => void }) {
  const [headcount, setHeadcount] = useState(25);

  return (
    <>
      <PageHeading eyebrow="TRANSPARENT PRICING" title="Clear costs, from solo to scale." copy="Versioned published pricing with modular plans, and no hidden quote wall for growing teams." />
      <section className="pricing-calculator" style={{ padding: "18px 24px", borderRadius: 12 }}>
        <div>
          <div className="card-kicker">HEADCOUNT COST CALCULATOR</div>
          <h2>How many people are you paying in the Philippines?</h2>
          <div className="range-row">
            <input type="range" min="1" max="500" value={headcount} onChange={(event) => setHeadcount(Number(event.target.value))} />
            <div><strong>{headcount}</strong><span>employees</span></div>
          </div>
        </div>
        <div className="calc-note"><CircleDollarSign size={20} className="i-green" /><span>Monthly estimate updates live. Transparent modular pricing read directly from database.</span></div>
      </section>

      <section className="pricing-grid">
        {plans.map((plan) => {
          const total = Number(plan.monthlyBase) + Number(plan.perEmployee) * (plan.name === "Solo" ? 0 : headcount);
          return (
            <article className={`card price-card ${plan.name === "Scale" ? "featured" : ""}`} key={plan.id}>
              {plan.name === "Scale" && <div className="popular-label">MOST POPULAR</div>}
              <div>
                <span className="price-plan">{plan.name}</span>
                <h2>{plan.name === "Solo" ? "For independent work" : plan.name === "Core" ? "For small teams" : plan.name === "Scale" ? "For growing operations" : "For complex organizations"}</h2>
                <p>{(plan.modules as string[]).join(" · ")}</p>
              </div>
              <div className="price">
                <strong>{money(total)}</strong>
                <span>/ month</span>
              </div>
              <small>Base {money(plan.monthlyBase)} + {money(plan.perEmployee)}/employee · v{plan.version}</small>
              <button className={plan.name === "Scale" ? "primary-button full" : "secondary-button full"} onClick={() => onSelectPlan(plan)}>
                {plan.name === "Enterprise" ? "Upgrade to Enterprise" : `Upgrade to ${plan.name}`} <ArrowUpRight size={15} />
              </button>
            </article>
          );
        })}
      </section>
    </>
  );
}

export function AuditPage({ events, organizationId }: { events: AuditEvent[]; organizationId: number }) {
  return (
    <>
      <PageHeading eyebrow="AUDIT TRAIL" title="A record you can inspect." copy="Approval, payroll, export and auth-adjacent actions use a shared server-side audit writer." actions={<a className="secondary-button" href={`/api/exports?organizationId=${organizationId}&kind=audit`}><Download size={16} className="i-teal" /> Export log</a>} />
      <article className="card audit-card">
        <div className="table-toolbar"><div className="search-field"><Search size={17} className="i-slate" /><input placeholder="Search actions, people, or resources" /></div><button className="filter-button">All activity <ChevronDown size={15} /></button></div>
        <div className="audit-list">
          {events.map((event) => (
            <div className="audit-row" key={event.id}>
              <span className="audit-dot"><Clock3 size={14} className="i-cyan" /></span>
              <div>
                <strong>{event.action}</strong>
                <p><b>{event.actor}</b> · {event.resource}</p>
              </div>
              <div>
                <span>{ruleVersionOf(event.metadata) ? `Rule ${ruleVersionOf(event.metadata)}` : "System event"}</span>
                <time>{formatTime(event.createdAt)}</time>
              </div>
            </div>
          ))}
        </div>
        <div className="pagination">
          <span>Showing {events.length} recent events</span>
          <div><button disabled>‹</button><button className="current">1</button><button disabled>›</button></div>
        </div>
      </article>
    </>
  );
}

type SettingsTab = "organization" | "team" | "account" | "security" | "privacy";

export function SettingsPage({ data, setNotice, initialTab = "organization" }: { data: DashboardData; setNotice: (message: string) => void; initialTab?: SettingsTab }) {
  const canManageTeam = ["owner", "admin", "bookkeeper"].includes(data.access?.role ?? "");
  const tabs: Array<{ key: SettingsTab; label: string; icon: typeof Building2; tone: string }> = [
    { key: "organization", label: "Organization profile", icon: Building2, tone: "i-blue" },
    { key: "account", label: "My account", icon: UserCheck, tone: "i-purple" },
    { key: "security", label: "Security", icon: LockKeyhole, tone: "i-amber" },
    { key: "privacy", label: "Data & privacy", icon: ShieldCheck, tone: "i-green" },
  ];
  if (canManageTeam) {
    tabs.splice(1, 0, { key: "team", label: "Team & access", icon: UsersRound, tone: "i-teal" });
  }
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return (
    <>
      <PageHeading eyebrow="SETTINGS" title="Company and account controls." copy="Only the sections your role can change are editable. Everything here writes to the database." />
      <section className="settings-layout">
        <article className="card settings-nav">
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={tab === item.key ? "selected" : ""} onClick={() => setTab(item.key)}>
                <Icon size={17} className={item.tone} /> {item.label}
              </button>
            );
          })}
        </article>
        <article className="card settings-detail">
          {tab === "organization" && <OrganizationSettings data={data} setNotice={setNotice} />}
          {tab === "team" && canManageTeam && <TeamAccessSettings data={data} setNotice={setNotice} />}
          {tab === "account" && (
            <div>
              <div className="card-header"><div><div className="card-kicker">MY ACCOUNT</div><h2>Sign-in &amp; sessions</h2><p>Change your name, email, password, and revoke devices.</p></div></div>
              <AccountPanel onNotice={setNotice} />
            </div>
          )}
          {tab === "security" && <SecuritySettings data={data} />}
          {tab === "privacy" && <PrivacySettings data={data} setNotice={setNotice} />}
        </article>
      </section>
    </>
  );
}

type TeamMember = { id: number; name: string; email: string; role: string; orgUnitId: number | null };
type TeamInvitation = {
  id: number;
  email: string;
  role: string;
  accepted: boolean;
  expired: boolean;
  invitedBy: string;
  createdAt: string;
};

function TeamAccessSettings({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const organizationId = data.selectedOrganization.id;
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("payroll");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadTeam() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/invitations?organizationId=${organizationId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not load workspace access.");
        return;
      }
      setMembers(Array.isArray(payload.members) ? payload.members : []);
      setInvitations(Array.isArray(payload.invitations) ? payload.invitations : []);
    } catch {
      setError("Could not reach the workspace access service.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTeam();
    // The organization id is the only external input for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function invite() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Enter the teammate's email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, email: cleanEmail, role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not send the invitation.");
        return;
      }
      setEmail("");
      await loadTeam();
      setNotice(`Invitation created for ${cleanEmail} as ${invitableRoleLabel(role)}.`);
    } catch {
      setError("Could not reach the invitation service.");
    } finally {
      setBusy(false);
    }
  }

  const openInvitations = invitations.filter((invitation) => !invitation.accepted && !invitation.expired);

  return (
    <div>
      <div className="card-header">
        <div>
          <div className="card-kicker">TEAM &amp; ACCESS</div>
          <h2>Real payroll roles</h2>
          <p>Invite separate operators for payroll preparation, independent checking, HR, administration, and employee self-service.</p>
        </div>
      </div>

      <div className="setting-form">
        <label>Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" />
        </label>
        <label>Role
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            {INVITABLE_ROLES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="modal-note" style={{ margin: "0 16px 12px" }}>
        Payroll Officer prepares and submits payroll. Checker independently reviews it. Owner or Administrator releases it. Production invitations require transactional email and never expose raw invite tokens.
      </div>
      {error && <div className="notice notice-amber" style={{ margin: "0 16px 12px" }}><span>{error}</span></div>}
      <div className="run-actions">
        <button className="primary-button" disabled={busy || loading || !email.trim()} onClick={() => void invite()}>
          <Send size={15} /> {busy ? "Inviting…" : "Invite teammate"}
        </button>
      </div>

      <div className="card-header" style={{ paddingTop: 8 }}>
        <div><div className="card-kicker">ACTIVE ACCESS</div><h2>Workspace members</h2></div>
      </div>
      <div className="worksheet-list">
        {loading ? (
          <div><CloudCog size={16} className="i-blue" /><span>Loading workspace access…</span></div>
        ) : members.length === 0 ? (
          <div><UsersRound size={16} className="i-purple" /><span>No workspace members found.</span></div>
        ) : members.map((member) => (
          <div key={member.id}>
            <UserCheck size={16} className="i-green" />
            <span>{member.name}<small>{member.email}</small></span>
            <Status value={invitableRoleLabel(member.role)} />
          </div>
        ))}
      </div>

      <div className="card-header" style={{ paddingTop: 8 }}>
        <div><div className="card-kicker">PENDING</div><h2>Open invitations</h2></div>
      </div>
      <div className="worksheet-list">
        {openInvitations.length === 0 ? (
          <div><Mail size={16} className="i-slate" /><span>No open invitations.</span></div>
        ) : openInvitations.map((invitation) => (
          <div key={invitation.id}>
            <Mail size={16} className="i-cyan" />
            <span>{invitation.email}<small>Invited by {invitation.invitedBy}</small></span>
            <Status value={invitableRoleLabel(invitation.role)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function OrganizationSettings({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const [name, setName] = useState(data.selectedOrganization.name);
  const [legalName, setLegalName] = useState(data.selectedOrganization.legalName);
  const [birTin, setBirTin] = useState(data.selectedOrganization.birTin ?? "");
  const [birBranchCode, setBirBranchCode] = useState(data.selectedOrganization.birBranchCode ?? "");
  const [sssEmployerNo, setSssEmployerNo] = useState(data.selectedOrganization.sssEmployerNo ?? "");
  const [philHealthEmployerNo, setPhilHealthEmployerNo] = useState(data.selectedOrganization.philHealthEmployerNo ?? "");
  const [pagIbigEmployerNo, setPagIbigEmployerNo] = useState(data.selectedOrganization.pagIbigEmployerNo ?? "");
  const [busy, setBusy] = useState(false);
  const canEdit = ["admin", "owner", "bookkeeper"].includes(data.access?.role ?? "");

  async function save() {
    setBusy(true);
    const res = await fetch("/api/organizations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: data.selectedOrganization.id,
        name,
        legalName,
        birTin,
        birBranchCode,
        sssEmployerNo,
        philHealthEmployerNo,
        pagIbigEmployerNo,
      }),
    });
    const data2 = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(data2.error ?? "Could not save.");
    setNotice("Organization profile saved and recorded in the audit trail.");
  }

  return (
    <>
      <div className="card-header"><div><div className="card-kicker">ORGANIZATION PROFILE</div><h2>Company defaults</h2><p>Used across payroll, payslips and government worksheets.</p></div></div>
      <div className="setting-form">
        <label>Trading name<input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></label>
        <label>Legal entity name<input value={legalName} disabled={!canEdit} onChange={(e) => setLegalName(e.target.value)} /></label>
        <label>Plan<input value={data.selectedOrganization.plan} readOnly /><small style={{ color: "var(--muted)", fontWeight: 500 }}>Changed through Pricing, not here.</small></label>
        <label>Payroll cycle<input value="Semi-monthly (15th / end of month)" readOnly /><small style={{ color: "var(--muted)", fontWeight: 500 }}>Fixed by the statutory engine.</small></label>
      </div>

      <div className="card-header" style={{ paddingTop: 6 }}>
        <div>
          <div className="card-kicker">GOVERNMENT REGISTRATIONS</div>
          <h2>Employer filing identifiers</h2>
          <p>Used by local filing preflight. Saving an ID does not mark a government portal as validated.</p>
        </div>
      </div>
      <div className="setting-form">
        <label>BIR TIN
          <input value={birTin} disabled={!canEdit} onChange={(e) => setBirTin(e.target.value)} placeholder="9 digits" inputMode="numeric" />
        </label>
        <label>BIR branch code
          <input value={birBranchCode} disabled={!canEdit} onChange={(e) => setBirBranchCode(e.target.value)} placeholder="0000" inputMode="numeric" />
        </label>
        <label>SSS employer number
          <input value={sssEmployerNo} disabled={!canEdit} onChange={(e) => setSssEmployerNo(e.target.value)} />
        </label>
        <label>PhilHealth employer number
          <input value={philHealthEmployerNo} disabled={!canEdit} onChange={(e) => setPhilHealthEmployerNo(e.target.value)} />
        </label>
        <label>Pag-IBIG employer number
          <input value={pagIbigEmployerNo} disabled={!canEdit} onChange={(e) => setPagIbigEmployerNo(e.target.value)} />
        </label>
      </div>
      {canEdit ? (
        <div className="run-actions">
          <button className="primary-button" disabled={busy || name.trim().length < 2} onClick={save}>
            <Check size={15} className="i-green" /> {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : (
        <div className="notice notice-blue" style={{ margin: "0 18px 14px" }}><LockKeyhole size={16} className="i-amber" /><span>Your role ({data.access?.role}) can view but not edit the organization profile.</span></div>
      )}
    </>
  );
}

function SecuritySettings({ data }: { data: DashboardData }) {
  const rows: Array<[string, string, string]> = [
    ["Password hashing", "scrypt with per-user salt", "Enforced"],
    ["Failed-login lockout", "Locks after repeated failures, timed unlock", "Enforced"],
    ["Two-factor (TOTP)", "RFC 6238 challenge between password and session", data.user?.totpEnabled ? "On for you" : "Available, not mandatory"],
    ["Sessions", "Server-side, revocable, hashed tokens", "Enforced"],
    ["Auth rate limiting", data.security?.rateLimit ?? "distributed-postgres", "Enforced"],
    ["Tenant isolation", "Membership checked on every session route", "Enforced"],
    ["Edge / CDN rate limiting", "Not implemented at the edge", "Not built"],
    ["SSO / SAML", "No identity provider connected", "Not built"],
  ];
  return (
    <>
      <div className="card-header"><div><div className="card-kicker">SECURITY CONTROLS</div><h2>What actually runs</h2><p>Every claim here maps to code on the request path. Anything not built says so.</p></div></div>
      <div className="worksheet-list">
        {rows.map(([label, detail, status]) => (
          <div key={label}>
            <ShieldCheck size={16} style={{ color: status === "Not built" ? "var(--muted)" : "var(--green)" }} />
            <span>{label}<small>{detail}</small></span>
            <Status value={status} />
          </div>
        ))}
      </div>
    </>
  );
}

function PrivacySettings({ data, setNotice }: { data: DashboardData; setNotice: (message: string) => void }) {
  const orgId = data.selectedOrganization.id;
  const [subjectEmail, setSubjectEmail] = useState("");
  const [requestType, setRequestType] = useState("access");
  const [busy, setBusy] = useState(false);

  async function fileRequest() {
    setBusy(true);
    const res = await fetch("/api/compliance/data-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: orgId, subjectEmail, requestType }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNotice(payload.error ?? "Could not log the request.");
    setSubjectEmail("");
    setNotice(`Data-subject request logged. ${payload.daysRemaining ?? 30}-day statutory window started.`);
  }

  return (
    <>
      <div className="card-header"><div><div className="card-kicker">DATA &amp; PRIVACY</div><h2>Portability and data-subject requests</h2><p>Export everything, and log access / correction / deletion requests with a statutory due date.</p></div></div>
      <div className="worksheet-list">
        <div>
          <FileSpreadsheet size={16} className="i-teal" />
          <span>Full company export (JSON archive)<small>Every download is audit-logged against your user.</small></span>
          <a className="link-button" href={`/api/exports?organizationId=${orgId}&kind=all`}>Download</a>
        </div>
        <div>
          <FileSpreadsheet size={16} className="i-teal" />
          <span>Audit trail export (CSV)<small>Actor, action, resource, rule version.</small></span>
          <a className="link-button" href={`/api/exports?organizationId=${orgId}&kind=audit`}>Download</a>
        </div>
      </div>
      <div className="setting-form" style={{ alignItems: "flex-end" }}>
        <label>Subject email
          <input value={subjectEmail} onChange={(e) => setSubjectEmail(e.target.value)} placeholder="employee@company.ph" />
        </label>
        <label>Request type
          <select value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            <option value="access">Access</option>
            <option value="correction">Correction</option>
            <option value="deletion">Deletion</option>
            <option value="portability">Portability</option>
            <option value="objection">Objection</option>
          </select>
        </label>
      </div>
      <div className="run-actions">
        <button className="primary-button" disabled={busy || !subjectEmail.includes("@")} onClick={fileRequest}>
          <ShieldCheck size={15} className="i-green" /> Log data-subject request
        </button>
      </div>
      <div className="notice notice-blue" style={{ margin: "0 18px 14px" }}>
        <LockKeyhole size={16} className="i-amber" />
        <span>Requests are tracked with a 30-day due date (Data Privacy Act). NPC registration and a published DPO contact are organisational steps, not code.</span>
      </div>
    </>
  );
}

export function NewPayrollModal({
  organizationId,
  onClose,
  onCreate,
  busy,
  orgUnits = [],
}: {
  organizationId: number;
  onClose: () => void;
  onCreate: (input: {
    periodStart: string;
    periodEnd: string;
    payDate: string;
    scopeOrgUnitId: number | null;
    legalEntityId: number;
  }) => void;
  busy: boolean;
  orgUnits?: OrgUnit[];
}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const [periodStart, setPeriodStart] = useState(day <= 15 ? iso(year, month, 1) : iso(year, month, 16));
  const [periodEnd, setPeriodEnd] = useState(day <= 15 ? iso(year, month, 15) : iso(year, month, lastDay));
  const [payDate, setPayDate] = useState(day <= 15 ? iso(year, month, 15) : iso(year, month, lastDay));
  const [scopeOrgUnitId, setScopeOrgUnitId] = useState<number | null>(null);
  const [legalEntities, setLegalEntities] = useState<Array<{ id: number; code: string; displayName: string; primaryEntity: boolean }>>([]);
  const [legalEntityId, setLegalEntityId] = useState<number | null>(null);
  const [legalEntitiesLoading, setLegalEntitiesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/legal-entities?organizationId=${organizationId}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!alive) return;
        const rows = response.ok && Array.isArray(payload.legalEntities)
          ? payload.legalEntities.filter((entity: { active?: boolean }) => entity.active !== false)
          : [];
        setLegalEntities(rows);
        setLegalEntityId(rows.find((entity: { primaryEntity?: boolean }) => entity.primaryEntity)?.id ?? rows[0]?.id ?? null);
      } finally {
        if (alive) setLegalEntitiesLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [organizationId]);

  const periodDays = periodStart && periodEnd
    ? Math.floor((Date.parse(`${periodEnd}T00:00:00Z`) - Date.parse(`${periodStart}T00:00:00Z`)) / 86_400_000) + 1
    : 0;
  const periodTooLong = periodDays > 16;
  const invalidDates = !periodStart || !periodEnd || !payDate || periodStart > periodEnd || payDate < periodEnd || periodTooLong;
  const invalidEntity = legalEntitiesLoading || !legalEntityId;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Create payroll draft">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><WalletCards size={22} className="i-green" /></div>
        <div className="card-kicker">NEW PAYROLL RUN</div>
        <h2>Create a payroll cutoff</h2>
        <p>Choose the exact attendance period, pay date, and employee scope. Linaw will calculate only punches and people inside this run.</p>

        <div className="setting-form">
          <label>Legal employer
            <select
              value={legalEntityId ?? ""}
              onChange={(event) => setLegalEntityId(event.target.value ? Number(event.target.value) : null)}
              disabled={legalEntitiesLoading}
            >
              {legalEntities.length === 0 && <option value="">No active legal employer</option>}
              {legalEntities.map((entity) => (
                <option key={entity.id} value={entity.id}>{entity.code} · {entity.displayName}{entity.primaryEntity ? " · Primary" : ""}</option>
              ))}
            </select>
          </label>
          <label>Period start
            <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </label>
          <label>Period end
            <input type="date" value={periodEnd} min={periodStart} onChange={(event) => {
              const next = event.target.value;
              setPeriodEnd(next);
              if (payDate < next) setPayDate(next);
            }} />
          </label>
          <label>Pay date
            <input type="date" value={payDate} min={periodEnd} onChange={(event) => setPayDate(event.target.value)} />
          </label>
          <label>Run scope
            <select
              value={scopeOrgUnitId ?? ""}
              onChange={(event) => setScopeOrgUnitId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">All locations</option>
              {orgUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name} · {unit.type}</option>
              ))}
            </select>
          </label>
        </div>

        {invalidDates && (
          <div className="notice notice-amber" style={{ margin: "10px 0 0" }}>
            <span>
              {periodTooLong
                ? "Payroll cutoffs can cover at most 16 calendar days. Split a longer range into separate runs."
                : "Period start must be on or before period end, and pay date cannot be before the cutoff ends."}
            </span>
          </div>
        )}

        <div className="modal-note">
          <ShieldCheck size={16} className="i-green" />
          The payroll run is bound to one legal employer. Employee scope, payroll calendar, statutory deduction timing, attendance, and future remittance evidence stay inside that employer boundary.
        </div>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            className="primary-button"
            disabled={busy || invalidDates || invalidEntity}
            onClick={() => legalEntityId && onCreate({ periodStart, periodEnd, payDate, scopeOrgUnitId, legalEntityId })}
          >
            {busy ? "Processing…" : "Create & process"} <ArrowUpRight size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}

export function OutboxModal({ organizationId, onClose, setNotice }: { organizationId: number; onClose: () => void; setNotice: (message: string) => void }) {
  type OutboxMessage = {
    id: number;
    recipient: string;
    subject: string;
    purpose: string;
    status: string;
    stateLabel: string;
    provider: string;
    error?: string | null;
    sentAt?: string | null;
    createdAt: string;
    retryCount: number;
    attemptCount: number;
    maxAttempts: number;
    canRetry: boolean;
    lastAttemptAt?: string | null;
    nextAttemptAt?: string | null;
    providerMessageId?: string | null;
    deliveryStatus?: string | null;
    deliveryEventAt?: string | null;
    deliveryDetail?: string | null;
    runId?: number | null;
    employeeId?: number | null;
    periodLabel?: string | null;
  };

  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<OutboxMessage | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState("none");
  const [deliveryCapable, setDeliveryCapable] = useState(false);
  const [summary, setSummary] = useState({ queued: 0, pending: 0, sent: 0, failed: 0, failedPayslipReady: 0, retried: 0, delivered: 0, deliveryIssues: 0 });
  const [retrying, setRetrying] = useState<number | null>(null);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch(`/api/outbox?organizationId=${organizationId}`, { cache: "no-store" });
      if (res.ok) {
        const payload = await res.json();
        if (alive) {
          const next = (payload.messages ?? []) as OutboxMessage[];
          setMessages(next);
          setProvider(payload.provider ?? "none");
          setDeliveryCapable(Boolean(payload.deliveryCapable));
          setSummary(payload.summary ?? { queued: 0, pending: 0, sent: 0, failed: 0, failedPayslipReady: 0, retried: 0, delivered: 0, deliveryIssues: 0 });
          setSelectedMsg((current) =>
            current ? next.find((item) => item.id === current.id) ?? next[0] ?? null : next[0] ?? null
          );
        }
      } else if (alive) {
        setNotice("Could not load the email outbox.");
      }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [organizationId, nonce, setNotice]);

  function load() {
    setNonce((n) => n + 1);
  }

  async function retryMessage(message: OutboxMessage) {
    setRetrying(message.id);
    try {
      const response = await fetch("/api/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, messageId: message.id }),
      });
      const payload = await response.json().catch(() => ({}));
      setNotice(
        response.ok
          ? `Delivery retry completed for ${message.recipient}.`
          : payload.error ?? "Delivery retry failed.",
      );
      load();
    } catch {
      setNotice("Could not reach the outbox retry service.");
    } finally {
      setRetrying(null);
    }
  }

  async function retryAllFailedPayslips() {
    setBulkRetrying(true);
    try {
      const response = await fetch("/api/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, mode: "retry-failed-payslips" }),
      });
      const payload = await response.json().catch(() => ({}));
      setNotice(
        response.ok
          ? payload.message ?? "Failed payslip notices retried."
          : payload.error ?? "Failed payslip notices could not be retried.",
      );
      load();
    } catch {
      setNotice("Could not reach the failed-payslip retry service.");
    } finally {
      setBulkRetrying(false);
    }
  }

  const statusTone = (message: OutboxMessage) => {
    if (["bounced", "complained", "failed", "suppressed"].includes(message.deliveryStatus ?? "")) {
      return "status-declined";
    }
    if (message.deliveryStatus === "delivered") return "status-approved";
    if (message.status === "sent") return "status-approved";
    if (message.status === "failed") return "status-declined";
    return "status-review";
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal large" role="dialog" aria-modal="true" aria-label="Email delivery outbox">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Mail size={22} className="i-pink" /></div>
        <div className="card-kicker">EMAIL DELIVERY</div>
        <h2>Transactional outbox</h2>
        <p>
          Durable delivery state for payroll notices and account messages. Payslip-ready failures use bounded automatic retry;
          one-time security links are never replayed after an attempted send.
        </p>

        <div className="run-stats" style={{ margin: "14px 0" }}>
          <div><span>Delivered</span><strong className="green-number">{summary.delivered}</strong><small>{summary.sent} accepted by provider</small></div>
          <div><span>Queued</span><strong>{summary.queued + summary.pending}</strong><small>{summary.pending} currently sending</small></div>
          <div><span>Needs attention</span><strong style={{ color: summary.failed + summary.deliveryIssues ? "var(--danger)" : undefined }}>{summary.failed + summary.deliveryIssues}</strong><small>{summary.failedPayslipReady} failed payslip notice(s) · {summary.deliveryIssues} provider issue(s)</small></div>
        </div>

        <div className={`notice ${deliveryCapable ? "notice-blue" : "notice-amber"}`} style={{ margin: "0 0 14px" }}>
          <Mail size={15} />
          <span>
            Provider: <strong>{provider}</strong>.{" "}
            {deliveryCapable
              ? "The worker can recover eligible payslip notices automatically."
              : "No delivery provider is active, messages remain queued instead of being reported as sent."}
          </span>
          {summary.failedPayslipReady > 0 && (
            <button
              className="primary-button brand"
              onClick={() => void retryAllFailedPayslips()}
              disabled={!loaded || retrying !== null || bulkRetrying}
            >
              <RefreshCw size={13} />
              {bulkRetrying ? "Retrying failed…" : `Retry ${summary.failedPayslipReady} failed payslip notice${summary.failedPayslipReady === 1 ? "" : "s"}`}
            </button>
          )}
          <button className="secondary-button" onClick={load} disabled={!loaded || retrying !== null || bulkRetrying}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.35fr", gap: 14, marginTop: 14 }}>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, maxHeight: 390, overflowY: "auto" }}>
            {!loaded && <div className="empty-state">Loading outbox…</div>}
            {loaded && messages.length === 0 && <div className="empty-state">No messages in outbox yet.</div>}
            {messages.map((msg) => (
              <button
                type="button"
                key={msg.id}
                onClick={() => setSelectedMsg(msg)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: 0,
                  borderBottom: "1px solid var(--line)",
                  cursor: "pointer",
                  background: selectedMsg?.id === msg.id ? "var(--green-light)" : "white",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "var(--muted)", marginBottom: 2 }}>
                  <span>{msg.periodLabel ?? msg.purpose}</span>
                  <span className={`status ${statusTone(msg)}`}>{msg.stateLabel}</span>
                </div>
                <strong style={{ display: "block", fontSize: 11.5 }}>{msg.recipient}</strong>
                <span style={{ fontSize: 11, color: "var(--ink-secondary)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {msg.subject}
                </span>
                <small style={{ color: "var(--muted)" }}>
                  {msg.attemptCount} attempt(s){msg.retryCount ? ` · ${msg.retryCount} retry${msg.retryCount === 1 ? "" : "ies"}` : ""}
                </small>
              </button>
            ))}
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, background: "#fafcfa", maxHeight: 390, overflowY: "auto" }}>
            {selectedMsg ? (
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                  <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 800 }}>
                    {selectedMsg.purpose}
                  </span>
                  <strong style={{ display: "block", fontSize: 13, marginTop: 2 }}>{selectedMsg.subject}</strong>
                  <p style={{ margin: "5px 0 0" }}>To {selectedMsg.recipient}</p>
                </div>

                <div className="setting-form" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <label>State<input readOnly value={selectedMsg.stateLabel} /></label>
                  <label>Provider<input readOnly value={selectedMsg.provider} /></label>
                  <label>Attempts<input readOnly value={`${selectedMsg.attemptCount} / ${selectedMsg.maxAttempts}`} /></label>
                  <label>Retries<input readOnly value={String(selectedMsg.retryCount)} /></label>
                </div>

                {(selectedMsg.runId || selectedMsg.periodLabel) && (
                  <div className="notice notice-blue" style={{ margin: 0 }}>
                    <FileSpreadsheet size={14} />
                    <span>
                      Payroll {selectedMsg.periodLabel ?? `run #${selectedMsg.runId}`}
                      {selectedMsg.employeeId ? ` · employee #${selectedMsg.employeeId}` : ""}
                    </span>
                  </div>
                )}

                <div style={{ fontSize: 11.5, color: "var(--ink-secondary)", display: "grid", gap: 5 }}>
                  <span>Queued: <strong>{formatTime(selectedMsg.createdAt)}</strong></span>
                  {selectedMsg.lastAttemptAt && <span>Last attempt: <strong>{formatTime(selectedMsg.lastAttemptAt)}</strong></span>}
                  {selectedMsg.nextAttemptAt && selectedMsg.status === "failed" && (
                    <span>Next automatic retry: <strong>{formatTime(selectedMsg.nextAttemptAt)}</strong></span>
                  )}
                  {selectedMsg.sentAt && <span>Provider accepted: <strong>{formatTime(selectedMsg.sentAt)}</strong></span>}
                  {selectedMsg.deliveryEventAt && <span>Latest provider event: <strong>{formatTime(selectedMsg.deliveryEventAt)}</strong></span>}
                  {selectedMsg.deliveryStatus && <span>Delivery outcome: <strong>{selectedMsg.deliveryStatus}</strong></span>}
                  {selectedMsg.providerMessageId && <span>Provider ID: <span className="mono">{selectedMsg.providerMessageId}</span></span>}
                </div>

                {selectedMsg.error && (
                  <div className="notice notice-red" style={{ margin: 0 }}>
                    <span><strong>Last send error:</strong> {selectedMsg.error}</span>
                  </div>
                )}

                {selectedMsg.deliveryDetail && (
                  <div className="notice notice-red" style={{ margin: 0 }}>
                    <span><strong>Provider delivery detail:</strong> {selectedMsg.deliveryDetail}</span>
                  </div>
                )}

                {selectedMsg.canRetry && (
                  <button
                    className="primary-button brand"
                    disabled={retrying !== null}
                    onClick={() => void retryMessage(selectedMsg)}
                  >
                    <RefreshCw size={14} />
                    {retrying === selectedMsg.id ? "Retrying…" : "Retry delivery"}
                  </button>
                )}

                {!selectedMsg.canRetry && selectedMsg.status === "failed" && (
                  <p className="field-help">
                    This message cannot be replayed safely. For one-time account links, generate a fresh link instead.
                  </p>
                )}
              </div>
            ) : (
              <div className="empty-state">Select a message to inspect delivery state.</div>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}

export function CheckoutModal({ organizationId, plan, onClose, onUpgraded }: { organizationId: number; plan: PricingPlan; onClose: () => void; onUpgraded: () => void }) {
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const basePrice = Number(plan.monthlyBase);
  const finalPrice = billingCycle === "annual" ? basePrice * 10 : basePrice;

  async function checkout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, plan: plan.name, billingCycle }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Checkout is unavailable.");
        return;
      }
      // A plan is not active yet. PayMongo hosts payment and its verified
      // webhook is the only path that may activate an entitlement.
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setMessage("Checkout session created. Complete payment in the hosted payment page.");
    } catch {
      setMessage("Could not complete checkout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true" aria-label="Plan Checkout">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><CreditCard size={22} className="i-blue" /></div>
        <div className="card-kicker">SUBSCRIPTION CHECKOUT</div>
        <h2>Upgrade to {plan.name} Plan</h2>
        <p>Creates a hosted PayMongo checkout session. Your plan changes only after PayMongo confirms payment by webhook.</p>

        <div style={{ background: "var(--canvas-subtle)", padding: 14, borderRadius: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Plan Tier</span>
            <strong>{plan.name}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Billing Interval</span>
            <select value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)} style={{ height: 28, fontSize: 11, padding: "0 6px" }}>
              <option value="monthly">Monthly ({money(basePrice)}/mo)</option>
              <option value="annual">Annual ({money(finalPrice)}/yr · 2 Mo. Free)</option>
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
            <strong>Total Due Now</strong>
            <strong style={{ fontSize: 16, color: "var(--green)" }}>{money(finalPrice)}</strong>
          </div>
        </div>

        <div className="notice notice-blue" style={{ margin: "8px 0 0" }}>
          <span>Hosted checkout supports the payment methods enabled in your PayMongo merchant dashboard (typically card, GCash, and Maya). No payment method is collected inside Linaw.</span>
        </div>

        {message && <div className="notice notice-amber" style={{ margin: "10px 0 0" }}><span>{message}</span></div>}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={busy} onClick={checkout}>{busy ? "Processing Checkout…" : `Pay ${money(finalPrice)}`}</button>
        </div>
      </section>
    </div>
  );
}

export function GovValidationModal({ organizationId, onClose, setNotice }: { organizationId: number; onClose: () => void; setNotice: (message: string) => void }) {
  const [validations, setValidations] = useState<any[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function runValidation() {
    setBusy(true);
    try {
      const res = await fetch("/api/compliance/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const data = await res.json();
      if (res.ok) {
        setValidations(data.validations ?? []);
        setCheckedAt(data.checkedAt ?? "");
        setNotice("Local statutory preflight complete. Portal upload is still required before filing.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal large" role="dialog" aria-modal="true" aria-label="Government Compliance Seal Suite">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><ShieldCheck size={22} className="i-green" /></div>
        <div className="card-kicker">STATUTORY LOCAL PREFLIGHT</div>
        <h2>Check your draft before portal upload</h2>
        <p>Checks the local inputs and formulas behind BIR, SSS, PhilHealth, and Pag-IBIG draft exports. It does not replace a government portal acknowledgement.</p>

        <div className="notice notice-amber" style={{ margin: "0 0 14px" }}>
          <HelpCircle size={16} className="i-blue" />
          <span><strong>Not a certification.</strong> Upload the generated file to the relevant agency portal and retain its receipt before filing.</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <button className="primary-button" disabled={busy} onClick={runValidation}>
            {busy ? "Running local checks…" : "Run local preflight"}
          </button>
        </div>

        {validations.length > 0 && (
          <>
            {checkedAt && <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 8px" }}>Local check run {formatTime(new Date(checkedAt))}. No government portal response has been recorded.</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, overflowY: "auto" }}>
            {validations.map((v, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", padding: 12, borderRadius: 10, background: "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <strong>{v.document}</strong>
                  <span className={`status ${v.status === "LOCAL_PASS" ? "status-tested" : v.status === "LOCAL_FAIL" ? "status-not-certified" : "status-awaiting-approval"}`}>
                    {v.status === "LOCAL_PASS" ? "Local checks pass · portal pending" : v.status === "LOCAL_FAIL" ? "Local data blocked" : "Local review needed"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {v.checks.map((check: any, ci: number) => (
                    <div key={ci} style={{ fontSize: 11, color: "var(--ink-secondary)", display: "flex", alignItems: "flex-start", gap: 6 }}>
                      {check.passed
                        ? <Check size={13} style={{ color: "var(--green)", marginTop: 2, flex: "none" }} />
                        : <HelpCircle size={13} style={{ color: "var(--review)", marginTop: 2, flex: "none" }} />}
                      <div><strong>{check.rule}:</strong> {check.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          </>
        )}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </section>
    </div>
  );
}
/** Audit metadata is jsonb, so read the rule version defensively. */
function ruleVersionOf(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).ruleVersion;
  return typeof value === "string" ? value : null;
}
