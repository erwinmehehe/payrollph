"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, CircleAlert, CreditCard, FileText, LockKeyhole, ShieldCheck } from "lucide-react";

type BillingPayload = {
  subscription: {
    plan: string;
    seats: number;
    status: string;
    amountCents: number;
    currency: string;
    billingCycle: string;
    paidThrough: string | null;
    recoveryUrl?: string | null;
    cancelAtPeriodEnd: boolean;
    activeAccess: boolean;
    provider: string | null;
  } | null;
  latestCheckout: { status: string; checkoutUrl: string | null; expiresAt: string | null } | null;
  invoices: Array<{ number: string; amountCents: number; status: string; currency: string; paidAt: string | null }>;
};

function pesos(cents: number) {
  return "₱" + (cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function friendlyDate(date: string | null) {
  return date ? new Date(date).toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" }) : "—";
}

export function SubscriptionManager({ organizationId, companyName }: { organizationId: number; companyName: string }) {
  const [data, setData] = useState<BillingPayload | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function load() {
    const response = await fetch("/api/billing/subscription?organizationId=" + organizationId, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Unable to load billing.");
    setData(payload as BillingPayload);
    setError("");
  }
  useEffect(() => {
    let active = true;
    void fetch("/api/billing/subscription?organizationId=" + organizationId, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Could not load subscription.");
        if (active) { setData(payload as BillingPayload); setError(""); }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load your billing information.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId]);

  async function checkout() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billing/subscription/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to open checkout.");
      const url = new URL(payload.checkoutUrl);
      if (url.protocol !== "https:" || !["xendit.co", "xen.to"].some((host) => url.hostname === host || url.hostname.endsWith("." + host))) {
        throw new Error("An unexpected checkout URL was returned.");
      }
      window.location.assign(url.toString());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not be opened.");
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!password || !confirmed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billing/subscription/cancel", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, currentPassword: password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Cancellation could not be confirmed.");
      setNotice(payload.message || "Automatic monthly charges stopped.");
      setCancelOpen(false); setPassword(""); setConfirmed(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to stop renewal.");
    } finally { setBusy(false); }
  }

  const sub = data?.subscription;
  const canStart = sub?.status === "pending_payment";
  const canCancel = sub?.provider === "xendit" && ["active", "past_due"].includes(sub.status) && !sub.cancelAtPeriodEnd;

  return (
    <div className="mx-auto max-w-[920px] space-y-6">
      <header>
        <span className="text-xs font-bold uppercase tracking-[.13em] text-[#0877ff]">Company billing</span>
        <h1 className="font-display mt-2 text-[34px] font-semibold tracking-tight text-[#0B0D1A]">Subscription & payments</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#5B6080]">{companyName} · Only authorized company billing administrators can make changes.</p>
      </header>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><CircleAlert size={17} className="mr-2 inline" />{error}</div>}
      {notice && <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800" role="status"><CheckCircle2 size={17} className="mr-2 inline" />{notice}</div>}
      {loading ? <div className="rounded-2xl border p-6">Loading billing details…</div> : !sub ? (
        <div className="rounded-2xl border p-6">No subscription has been configured for this company. <Link className="font-semibold text-[#0877ff]" href="/pricing">Review plans</Link></div>
      ) : (
        <>
          <section className="rounded-3xl border border-[#E2E4F0] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#7C82A1]">{sub.plan} plan</span>
                <p className="font-display mt-2 text-[36px] font-semibold text-[#0B0D1A]">{pesos(sub.amountCents)} <span className="text-base font-normal text-[#5B6080]">/ month</span></p>
                <p className="mt-1 text-sm text-[#5B6080]">{sub.seats} employee seat{sub.seats === 1 ? "" : "s"} included · PHP billing</p>
              </div>
              <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${sub.activeAccess ? "bg-[#e6f7ef] text-[#0a8455]" : "bg-[#fff4e5] text-[#9d5d08]"}`}>
                {sub.status === "cancel_at_period_end" ? "Cancelling at paid term" : sub.status === "pending_payment" ? "Payment required" : sub.status === "past_due" ? "Payment needs attention" : sub.status.replaceAll("_", " ")}
              </span>
            </div>
            <div className="mt-6 grid gap-3 border-t border-[#E2E4F0] pt-5 sm:grid-cols-3">
              <div><span className="text-xs text-[#7C82A1]">Access</span><p className="mt-1 text-sm font-semibold">{sub.activeAccess ? "Active" : "Pending or expired"}</p></div>
              <div><span className="text-xs text-[#7C82A1]">Paid through</span><p className="mt-1 text-sm font-semibold">{friendlyDate(sub.paidThrough)}</p></div>
              <div><span className="text-xs text-[#7C82A1]">Automatic renewal</span><p className="mt-1 text-sm font-semibold">{sub.cancelAtPeriodEnd ? "Off" : sub.status === "active" ? "On" : "Not active"}</p></div>
            </div>
            {canStart && (
              <div className="mt-6 rounded-2xl border border-[#bdd8ff] bg-[#edf5ff] p-4">
                <p className="text-sm font-semibold text-[#0B3E8C]">Authorize your first subscription payment</p>
                <p className="mt-2 text-[13px] leading-relaxed text-[#486489]">You will leave Linaw for hosted Xendit checkout. The first payment must be confirmed through a secure provider notification before payroll features activate. Future monthly payments are scheduled automatically.</p>
                <button type="button" disabled={busy} onClick={() => void checkout()} className="mt-4 flex min-h-[48px] items-center gap-2 rounded-full bg-[#0877ff] px-5 font-semibold text-white disabled:opacity-50">
                  <CreditCard size={17} /> {busy ? "Opening checkout…" : "Authorize monthly subscription"} <ArrowRight size={16}/>
                </button>
              </div>
            )}
            {sub.status === "past_due" && (
              <div className="mt-5 rounded-xl bg-amber-50 p-4 text-[13px] text-amber-800">
                <p>A renewal payment has not completed. Your prepaid access continues through its paid-through date.</p>
                {sub.recoveryUrl && (() => {
                  try {
                    const url = new URL(sub.recoveryUrl);
                    if (url.protocol !== "https:" || !["xendit.co", "xen.to"].some((host) => url.hostname === host || url.hostname.endsWith("." + host))) return null;
                    return <a className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-amber-800 px-4 font-semibold text-white" href={sub.recoveryUrl} rel="noreferrer">Retry payment securely <ArrowRight size={16} /></a>;
                  } catch { return null; }
                })()}
                {!sub.recoveryUrl && <p className="mt-2">The payment provider handles scheduled retries. Contact billing support to update your payment method.</p>}
              </div>
            )}
            {sub.cancelAtPeriodEnd && <p className="mt-5 rounded-xl bg-green-50 p-4 text-[13px] text-green-800">Future automatic charges have been stopped. Your historical payroll information remains stored according to the retention policy.</p>}
            {canCancel && (
              <div className="mt-6 border-t border-[#E2E4F0] pt-5">
                {!cancelOpen ? (
                  <button type="button" className="text-sm font-semibold text-[#b42318] underline underline-offset-4" onClick={() => setCancelOpen(true)}>Cancel automatic renewal</button>
                ) : (
                  <div className="max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <h2 className="font-semibold text-rose-900">Stop future subscription charges?</h2>
                    <p className="mt-2 text-[13px] leading-relaxed text-rose-800">You keep access until {friendlyDate(sub.paidThrough)}. Future monthly renewal charges stop. Cancelling does not delete payroll, employees, or invoices. No automatic refund is implied.</p>
                    <label className="mt-4 block text-sm font-semibold text-rose-900">Confirm with your current password
                      <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-2 min-h-[46px] w-full rounded-xl border border-rose-200 bg-white px-3 text-base" />
                    </label>
                    <label className="mt-3 flex gap-2 text-[13px] text-rose-900"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I understand future automatic renewal will stop.</label>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button type="button" disabled={!password || !confirmed || busy} onClick={() => void cancel()} className="min-h-[44px] rounded-full bg-[#b42318] px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Cancelling…" : "Confirm cancellation"}</button>
                      <button type="button" disabled={busy} onClick={() => { setCancelOpen(false); setPassword(""); setConfirmed(false); }} className="min-h-[44px] rounded-full border border-[#e2e8f0] bg-white px-5 text-sm font-semibold">Keep subscription</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
          <section className="rounded-3xl border border-[#E2E4F0] bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold"><FileText size={21} /> Billing history</h2>
            <p className="mt-2 text-[13px] text-[#5B6080]">Invoices are recorded only after the payment provider confirms successful collection.</p>
            {!data?.invoices?.length ? <p className="mt-5 text-sm text-[#64748b]">No paid invoices yet.</p> : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[430px] text-left text-sm"><thead className="border-b text-xs uppercase text-[#7C82A1]"><tr><th className="pb-2">Invoice</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>{data.invoices.map((invoice) => (
                  <tr key={invoice.number} className="border-b border-[#eef2f7]"><td className="py-3 font-medium">{invoice.number}</td><td>{pesos(invoice.amountCents)}</td><td>{friendlyDate(invoice.paidAt)}</td><td className="capitalize">{invoice.status}</td></tr>
                ))}</tbody></table>
              </div>
            )}
          </section>
        </>
      )}
      <p className="flex gap-2 text-[12px] leading-relaxed text-[#64748b]"><LockKeyhole size={17} className="shrink-0" />Card numbers are never collected or stored inside Linaw. Only the payment provider handles recurring payment authorization and collection.</p>
      <div className="flex flex-wrap gap-4 text-[13px]"><Link href="/app" className="font-semibold text-[#0868dc]">Back to workspace →</Link><Link href="/pricing" className="text-[#64748b]">Review plans</Link></div>
    </div>
  );
}
