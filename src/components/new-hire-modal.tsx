"use client";

import { useState } from "react";
import { ArrowRight, Layers, X } from "lucide-react";

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
    title: "",
    basicRate: "",
    startDate: new Date().toISOString().slice(0, 10),
    region: "NCR",
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
        body: JSON.stringify({ ...form, organizationId, basicRate: Number(form.basicRate) }),
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
    <div className="modal-backdrop" role="presentation">
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
            <label>Monthly basic rate<input type="number" min="0" step="0.01" required value={form.basicRate} onChange={(e) => setForm({ ...form, basicRate: e.target.value })} /></label>
            <label>Start date<input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
            <label>Region
              <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}>
                <option>NCR</option><option>III</option><option>IV-A</option><option>VII</option><option>XI</option>
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
            Onboarding tasks are generated server-side, so IT and HR items are tracked from day one.
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
