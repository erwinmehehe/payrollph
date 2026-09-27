"use client";

import { useEffect, useState } from "react";
import { Clock, Download, FileText, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import { WebBundyModal } from "@/components/web-bundy-modal";

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
  employer: { name: string } | null;
  yearToDate: { gross: string; net: string; deductions: string; tax: string; periodsPaid: number };
  payslips: Payslip[];
};

const peso = (value: string | number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(Number(value));

export function SelfServicePortal({ demoMode = false }: { demoMode?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [employeeNo, setEmployeeNo] = useState("");
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webBundyOpen, setWebBundyOpen] = useState(false);

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

  return (
    <main className="content-area" style={{ maxWidth: 900 }}>
      {demoMode && (
        <div className="demo-workspace-banner" role="status" style={{ marginBottom: 18 }}>
          <div>
            <strong>Public employee demo</strong>
            <span>This portal contains sample payroll data. External actions and account changes are disabled.</span>
          </div>
          <div className="demo-workspace-actions">
            <a href="/welcome" className="secondary-button">Back to website</a>
            <a href="/book-demo" className="secondary-button">Book demo</a>
            <a href="/signup" className="primary-button">Create account</a>
          </div>
        </div>
      )}
      <header className="page-heading">
        <div>
          <p className="eyebrow">MY PAY</p>
          <h1>{data ? `Hello, ${data.employee.firstName}.` : "My payslips"}</h1>
          <p className="heading-copy">
            {data?.employer?.name ?? "Your employer"} · you can only ever see your own records here.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="primary-button" style={{ background: "var(--deep)", borderColor: "var(--green)" }} onClick={() => setWebBundyOpen(true)}>
            <Clock size={15} /> Clock IN / OUT
          </button>
          <a className="secondary-button" href="/api/auth/logout"><LogOut size={15} /> Sign out</a>
        </div>
      </header>

      {webBundyOpen && (
        <WebBundyModal
          organizationId={1}
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
            {linked && <div className="notice notice-green"><ShieldCheck size={15} /><span>Linked. Loading your payslips…</span></div>}
            <button className="primary-button full" disabled={busy || !employeeNo}>Link my record</button>
          </form>
        </div>
      )}

      {data && (
        <>
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
                  <span className="audit-dot"><FileText size={14} /></span>
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
                    <a className="icon-button" href={`/api/self/payslips/${slip.entryId}`} aria-label="Download payslip"><Download size={16} /></a>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <div className="notice notice-blue" style={{ marginTop: 14 }}>
            <ShieldCheck size={17} />
            <span><strong>Privacy:</strong> this page is scoped to your single employee record in the database query itself. You cannot view another employee&apos;s pay, even by editing the request.</span>
          </div>
        </>
      )}
    </main>
  );
}
