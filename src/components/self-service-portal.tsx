"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Clock, Download, FileText, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import { WebBundyModal } from "@/components/web-bundy-modal";
import { DemoSandboxBar } from "@/components/demo-sandbox-bar";
import { PayrollHandoff } from "@/components/payroll-handoff";
import { type DemoRoleId } from "@/lib/demo-roles";
import { buildPayrollHandoff } from "@/lib/payroll-handoff";

type Payslip = {
  entryId: number;
  period: string;
  payDate: string;
  gross: string;
  deductions: string;
  net: string;
  ruleVersion: string;
  lineItems: Array<{ code?: string; label?: string; amount?: number; notes?: string[] }>;
};

type Payload = {
  employee: { employeeNo: string; firstName: string; lastName: string; title: string; employmentType: string; status: string; monthlyBasic: string };
  employer: { id: number; name: string } | null;
  yearToDate: { gross: string; net: string; deductions: string; tax: string; periodsPaid: number };
  nextPay: { period: string; payDate: string; status: string; label: string } | null;
  payslips: Payslip[];
};

const peso = (value: string | number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(value));

const payDateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value + "T00:00:00+08:00"),
  );

const payDateHasPassed = (value: string) =>
  new Date(value + "T23:59:59+08:00").getTime() < Date.now();

export function SelfServicePortal() {
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demoRole") === "employee";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [employeeNo, setEmployeeNo] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webBundyOpen, setWebBundyOpen] = useState(false);
  const [switchingRole, setSwitchingRole] = useState<DemoRoleId | null>(null);

  async function load() {
    const response = await fetch("/api/self/payslips", { cache: "no-store" });
    if (response.status === 403) {
      setError("Link your employee number once to unlock your payslips.");
      return;
    }
    if (!response.ok) {
      setError("Could not load your payslips.");
      return;
    }
    setData(await response.json());
  }

  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/self/payslips", { cache: "no-store" });
        if (!alive) return;
        if (response.status === 403) {
          setError("Link your employee number once to unlock your payslips.");
          return;
        }
        if (!response.ok) {
          setError("Could not load your payslips.");
          return;
        }
        setData(await response.json());
      } catch {
        if (alive) setError("Could not reach the server.");
      }
    })();
    return () => { alive = false; };
  }, [nonce]);

  async function switchDemoRole(role: DemoRoleId) {
    setSwitchingRole(role);
    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Could not switch demo persona.");
        return;
      }
      window.location.href = typeof payload.redirectTo === "string" ? payload.redirectTo : `/app?demoRole=${role}`;
    } catch {
      setError("Could not switch demo persona.");
    } finally {
      setSwitchingRole(null);
    }
  }

  async function link(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/self/payslips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeNo }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await response.json()).error ?? "Could not link that employee number.");
      return;
    }
    setLinked(true);
    setError("");
    await load();
  }

  const latestPayslip = data?.payslips[0] ?? null;

  return (
    <main className="content-area employee-self-service">
      <header className="page-heading">
        <div>
          <p className="eyebrow">MY PAY</p>
          <h1>{data ? `Hello, ${data.employee.firstName}.` : "My payslips"}</h1>
          <p className="heading-copy">
            {data?.employer?.name ?? "Your employer"} · you can only ever see your own records here.
          </p>
        </div>
        <div className="employee-self-service-actions">
          <button className="primary-button" style={{ background: "var(--deep)", borderColor: "var(--green)" }} onClick={() => setWebBundyOpen(true)}>
            <Clock size={15} className="i-cyan" /> Clock IN / OUT
          </button>
          <a className="secondary-button" href="/api/auth/logout"><LogOut size={15} className="i-slate" /> Sign out</a>
        </div>
      </header>

      {isDemo && (
        <DemoSandboxBar
          role="employee"
          busyRole={switchingRole}
          onSwitch={(role) => void switchDemoRole(role)}
          onTask={(taskId) => {
            if (taskId === "employee-punch") {
              setWebBundyOpen(true);
              return;
            }
            const first = data?.payslips[0];
            if (first) setOpen(first.entryId);
          }}
        />
      )}

      {webBundyOpen && (
        <WebBundyModal
          organizationId={data?.employer?.id ?? 0}
          employeeName={data?.employee ? `${data.employee.firstName} ${data.employee.lastName}` : "Self"}
          onClose={() => setWebBundyOpen(false)}
          onPunchSuccess={() => { setNonce((n) => n + 1); }}
        />
      )}

      {error && !data && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div className="card-kicker">ONE-TIME LINK</div>
          <h2 style={{ margin: "6px 0" }}>Confirm your employee number</h2>
          <p className="auth-copy">This ties your login to your payroll record so nobody else can claim it.</p>
          <form onSubmit={link} className="auth-form" style={{ maxWidth: 360, marginTop: 12 }}>
            <label>Employee number<input value={employeeNo} onChange={(event) => setEmployeeNo(event.target.value)} placeholder="e.g. LL-101" /></label>
            {error && <div className="notice notice-amber"><span>{error}</span></div>}
            {linked && <div className="notice notice-green"><ShieldCheck size={15} className="i-green" /><span>Linked. Loading your payslips…</span></div>}
            <button className="primary-button full" disabled={busy || !employeeNo}>Link my record</button>
          </form>
        </div>
      )}

      {data && (
        <>
          {latestPayslip && (
            <section className="employee-pay-next" data-latest-payslip>
              <div className="employee-pay-next-copy">
                <span className="card-kicker">LATEST PAYSLIP</span>
                <h2>Payslip available</h2>
                <p>
                  {latestPayslip.period} was released for {payDateLabel(latestPayslip.payDate)}. Your newest payslip is promoted here before older pay history.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="secondary-button" onClick={() => setOpen(latestPayslip.entryId)}>
                  <FileText size={15} className="i-teal" /> View details
                </button>
                <a className="primary-button" href={`/api/self/payslips/${latestPayslip.entryId}`}>
                  <Download size={15} className="i-teal" /> Download payslip
                </a>
              </div>
            </section>
          )}

          <section className="employee-pay-next">
            <div className="employee-pay-next-copy">
              <span className="card-kicker">NEXT PAY STATUS</span>
              {data.nextPay ? (
                <>
                  <h2>{data.nextPay.period}</h2>
                  <p>
                    {data.nextPay.label}.
                    {payDateHasPassed(data.nextPay.payDate) ? " The scheduled pay date has passed, so this stays visible until release." : ""}
                    {" "}Your pay amount stays private and hidden until payroll is released.
                  </p>
                </>
              ) : (
                <>
                  <h2>No upcoming payroll yet</h2>
                  <p>Your next cycle will appear here after your employee record is included in a payroll run.</p>
                </>
              )}
            </div>
            <div className="employee-pay-next-meta">
              <CalendarDays size={17} />
              <div>
                <span>{data.nextPay && payDateHasPassed(data.nextPay.payDate) ? "Scheduled date passed" : "Scheduled pay date"}</span>
                <strong>{data.nextPay ? payDateLabel(data.nextPay.payDate) : "Not scheduled"}</strong>
              </div>
            </div>
          </section>

          {data.nextPay && (
            <PayrollHandoff
              stages={buildPayrollHandoff({
                status: data.nextPay.status,
                periodLabel: data.nextPay.period,
                payDate: data.nextPay.payDate,
              })}
              period={data.nextPay.period}
              status={data.nextPay.label}
              payDate={payDateLabel(data.nextPay.payDate)}
              viewerRole="employee"
              compact
            />
          )}

          <section className="stats-grid">
            <article className="stat-card">
              <div className="stat-icon mint"><WalletCards size={19} /></div>
              <p>MONTHLY BASIC</p>
              <h3>{peso(data.employee.monthlyBasic)}</h3>
              <span>{data.employee.employmentType} · {data.employee.status}</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon purple"><FileText size={19} /></div>
              <p>NET PAID YTD</p>
              <h3>{peso(data.yearToDate.net)}</h3>
              <span>{data.yearToDate.periodsPaid} released period(s)</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon orange"><FileText size={19} /></div>
              <p>TAX WITHHELD YTD</p>
              <h3>{peso(data.yearToDate.tax)}</h3>
              <span>Shown on your BIR 2316</span>
            </article>
          </section>

          <article className="card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <div><div className="card-kicker">PAY HISTORY</div><h2>{data.payslips.length} released payslip(s)</h2></div>
              <span className="status status-green">{data.employee.employeeNo}</span>
            </div>
            <div className="audit-list">
              {data.payslips.length === 0 && <div className="empty-state">No released payslips yet. Payslips appear here the moment payroll is released.</div>}
              {data.payslips.map((slip) => (
                <div className="audit-row" key={slip.entryId}>
                  <span className="audit-dot"><FileText size={14} className="i-teal" /></span>
                  <div>
                    <strong>{slip.period}</strong>
                    <p>Net {peso(slip.net)} · gross {peso(slip.gross)} · paid {slip.payDate}</p>
                    {open === slip.entryId && (
                      <div className="trace-box" style={{ marginTop: 10 }}>
                        {(slip.lineItems ?? []).map((item, index) => (
                          <span key={index} style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between" }}>
                            <em style={{ fontStyle: "normal", color: "#84908a" }}>{item.label ?? item.code}</em>
                            <b style={{ color: Number(item.amount) < 0 ? "#a4554f" : "#37463f" }}>{peso(Number(item.amount ?? 0))}</b>
                          </span>
                        ))}
                        <span style={{ gridColumn: "1 / -1", color: "#84908a", marginTop: 6 }}>Rule version {slip.ruleVersion}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="secondary-button" onClick={() => setOpen(open === slip.entryId ? null : slip.entryId)}>
                      {open === slip.entryId ? "Hide" : "Details"}
                    </button>
                    <a className="icon-button" href={`/api/self/payslips/${slip.entryId}`} aria-label="Download payslip"><Download size={16} className="i-teal" /></a>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <div className="notice notice-blue" style={{ marginTop: 14 }}>
            <ShieldCheck size={17} className="i-green" />
            <span><strong>Privacy:</strong> this page is scoped to your single employee record in the database query itself. You cannot view another employee&apos;s pay, even by editing the request.</span>
          </div>
        </>
      )}
    </main>
  );
}
