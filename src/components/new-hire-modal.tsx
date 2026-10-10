"use client";

import { useState } from "react";
import { ArrowRight, Layers, X } from "lucide-react";
import { WAGE_ORDERS } from "@/lib/wage-orders";
import { REST_DAY_NAMES } from "@/lib/payroll-rules";

/**
 * Rippling-style new-hire onboarding: creating the employee also generates the
 * provisioning checklist (IDs, bank, laptop, email, HMO) and optionally assigns
 * an asset in the same action, so nothing depends on someone remembering later.
 */
export function NewHireModal({
  organizationId,
  onClose,
  onCreated,
}: {
  organizationId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    bankAccount: "",
    bankCode: "",
    mobile: "",
    title: "",
    payBasis: "monthly",
    rateAmount: "",
    standardWorkDaysPerMonth: "22",
    standardHoursPerDay: "8",
    startDate: new Date().toISOString().slice(0, 10),
    region: "NCR",
    restDay: "",
    mwe: false,
    assetType: "Laptop",
    assetName: "",
    serialNumber: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          organizationId,
          rateAmount: Number(form.rateAmount),
          standardWorkDaysPerMonth: Number(form.standardWorkDaysPerMonth),
          standardHoursPerDay: Number(form.standardHoursPerDay),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create the employee.");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop linaw-dialog" role="presentation">
      <section className="modal large" role="dialog" aria-modal="true" aria-label="Add employee">
        <button className="modal-close" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Layers size={22} className="i-teal" /></div>
        <div className="card-kicker">NEW HIRE</div>
        <h2>Add employee &amp; start onboarding</h2>
        <p>Creates the record, generates the provisioning checklist, and optionally assigns equipment immediately.</p>

        {error && <div className="notice notice-amber" style={{ margin: "0 0 12px" }}><span>{error}</span></div>}

        <form onSubmit={submit}>
          <div className="setting-form">
            <label>First name<input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></label>
            <label>Last name<input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></label>
            <label>Work email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="for payslip delivery" /></label>
            <label>Job title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label>Bank / payout code<input value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value.toUpperCase() })} placeholder="BDO / BPI / UB / ..." /></label>
            <label>Account number<input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} placeholder="encrypted after save" autoComplete="off" /></label>
            <label>Mobile payout number<input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="optional" /></label>
            <label>Pay basis
              <select value={form.payBasis} onChange={(e) => setForm({ ...form, payBasis: e.target.value })}>
                <option value="monthly">Monthly salaried</option>
                <option value="daily">Daily paid</option>
                <option value="hourly">Hourly paid</option>
              </select>
            </label>
            <label>{form.payBasis === "monthly" ? "Monthly rate" : form.payBasis === "daily" ? "Daily rate" : "Hourly rate"}
              <input type="number" min="0.01" step="0.01" required value={form.rateAmount} onChange={(e) => setForm({ ...form, rateAmount: e.target.value })} />
            </label>
            <label>Standard work days / month
              <input type="number" min="1" max="31" step="0.5" required value={form.standardWorkDaysPerMonth} onChange={(e) => setForm({ ...form, standardWorkDaysPerMonth: e.target.value })} />
            </label>
            <label>Standard hours / day
              <input type="number" min="1" max="24" step="0.25" required value={form.standardHoursPerDay} onChange={(e) => setForm({ ...form, standardHoursPerDay: e.target.value })} />
            </label>
            <label>Start date<input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
            <label>Region
              <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                {WAGE_ORDERS.map((order) => (
                  <option key={order.region} value={order.region}>
                    {order.region}{order.verified ? "" : " (rate unverified)"}
                  </option>
                ))}
              </select>
            </label>
            <label>Rest day
              <select value={form.restDay} onChange={(e) => setForm({ ...form, restDay: e.target.value })}>
                <option value="">Not set</option>
                {REST_DAY_NAMES.map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "end" }}>
              <input type="checkbox" style={{ width: "auto", height: "auto" }} checked={form.mwe} onChange={(e) => setForm({ ...form, mwe: e.target.checked })} />
              Minimum wage earner
            </label>
            <label>Equipment type
              <select value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
                <option>Laptop</option><option>Desktop</option><option>Phone</option><option>Monitor</option><option>Other</option>
              </select>
            </label>
            <label>Equipment name<input value={form.assetName} onChange={(e) => setForm({ ...form, assetName: e.target.value })} placeholder="MacBook Air M3 (optional)" /></label>
            <label>Serial number<input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} /></label>
          </div>
          <div className="modal-note" style={{ marginTop: 12 }}>
            Bank account and bank code are required together for payout readiness. The account number is encrypted at rest and is not returned in plaintext after save.
          </div>
          <div className="modal-note" style={{ marginTop: 8 }}>
            Payroll uses the selected pay basis directly. Monthly staff keep a fixed cutoff salary, while daily/hourly staff are paid from worked regular time. Workdays and hours also define the traceable daily/hourly equivalents used by payroll.
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create & onboard"} <ArrowRight size={16} /></button>
          </div>
        </form>
      </section>
    </div>
  );
}
