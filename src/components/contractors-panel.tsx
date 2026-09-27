"use client";

import { useState, useEffect } from "react";
import { Globe, DollarSign, Plus, X } from "lucide-react";

type Contractor = {
  id: number;
  name: string;
  email: string;
  country: string;
  currency: string;
  rate: string;
  rateType: string;
  contractStart: string | null;
  contractEnd: string | null;
  status: string;
};

const CURRENCIES = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
];

export function ContractorsPanel({ organizationId }: { organizationId: number }) {
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    country: "PH",
    currency: "USD",
    rate: "",
    rateType: "monthly",
    contractStart: "",
    contractEnd: "",
  });

  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/contractors?organizationId=${organizationId}`);
        const data = await res.json();
        if (alive) setContractors(data);
      } catch {
        if (alive) setContractors([]);
      }
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function loadContractors() {
    setLoading(false);
    setNonce((n) => n + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/contractors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, organizationId }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormData({
          name: "",
          email: "",
          country: "PH",
          currency: "USD",
          rate: "",
          rateType: "monthly",
          contractStart: "",
          contractEnd: "",
        });
        loadContractors();
      }
    } catch (error) {
      console.error("Failed to add contractor:", error);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this contractor?")) return;
    try {
      await fetch(`/api/contractors?id=${id}`, { method: "DELETE" });
      loadContractors();
    } catch (error) {
      console.error("Failed to delete contractor:", error);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading contractors...</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Contractors</h2>
        <button className="primary-button" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? "Cancel" : "Add Contractor"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <form onSubmit={handleSubmit}>
            <div className="setting-form">
              <label>
                Full Name
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Smith"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john@example.com"
                />
              </label>
              <label>
                Country
                <select
                  value={formData.country}
                  onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                >
                  <option value="PH">Philippines</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="SG">Singapore</option>
                </select>
              </label>
              <label>
                Currency
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Rate
                <input
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={formData.rate}
                  onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                  placeholder="5000.00"
                />
              </label>
              <label>
                Rate Type
                <select
                  value={formData.rateType}
                  onChange={(e) => setFormData({ ...formData, rateType: e.target.value })}
                >
                  <option value="monthly">Monthly</option>
                  <option value="hourly">Hourly</option>
                  <option value="project">Project</option>
                </select>
              </label>
              <label>
                Contract Start
                <input
                  type="date"
                  value={formData.contractStart}
                  onChange={(e) => setFormData({ ...formData, contractStart: e.target.value })}
                />
              </label>
              <label>
                Contract End
                <input
                  type="date"
                  value={formData.contractEnd}
                  onChange={(e) => setFormData({ ...formData, contractEnd: e.target.value })}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button">
                Add Contractor
              </button>
            </div>
          </form>
        </div>
      )}

      {contractors.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <Globe size={32} style={{ color: "var(--muted)", marginBottom: 12 }} />
          <p style={{ color: "var(--muted)", margin: 0 }}>No contractors yet. Add your first international contractor.</p>
        </div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Country</th>
                <th>Rate</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contractors.map((c) => {
                const currency = CURRENCIES.find((cur) => cur.code === c.currency);
                return (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>{c.email}</td>
                    <td>{c.country}</td>
                    <td>
                      <DollarSign size={12} style={{ display: "inline", marginRight: 4 }} />
                      {Number(c.rate).toLocaleString()} {currency?.symbol || c.currency} / {c.rateType}
                    </td>
                    <td>
                      <span className={`status status-${c.status}`}>{c.status}</span>
                    </td>
                    <td>
                      <button className="icon-button" onClick={() => handleDelete(c.id)} title="Remove">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
