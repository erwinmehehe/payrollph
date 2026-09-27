"use client";

import { useState, useEffect } from "react";
import { Package, Plus, X, CheckCircle2 } from "lucide-react";

type Asset = {
  id: number;
  type: string;
  name: string;
  serialNumber: string | null;
  employeeId: number | null;
  status: string;
  assignedOn: string | null;
};

type Employee = {
  id: number;
  firstName: string;
  lastName: string;
};

const ASSET_TYPES = [
  "Laptop",
  "Desktop",
  "Monitor",
  "Phone",
  "Tablet",
  "Keyboard",
  "Mouse",
  "Headset",
  "Other",
];

export function AssetsPanel({ organizationId }: { organizationId: number }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    type: "Laptop",
    name: "",
    serialNumber: "",
    employeeId: "",
    status: "assigned",
    assignedOn: new Date().toISOString().split("T")[0],
  });

  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [a, e] = await Promise.all([
          fetch(`/api/assets?organizationId=${organizationId}`).then((r) => r.json()),
          fetch(`/api/employees?organizationId=${organizationId}`).then((r) => (r.ok ? r.json() : [])),
        ]);
        if (!alive) return;
        setAssets(Array.isArray(a) ? a : []);
        setEmployees(Array.isArray(e) ? e : []);
      } catch {
        if (alive) { setAssets([]); setEmployees([]); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [organizationId, nonce]);

  function loadAssets() {
    setNonce((n) => n + 1);
  }

  const loadEmployees = loadAssets;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          organizationId,
          employeeId: formData.employeeId ? parseInt(formData.employeeId) : null,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormData({
          type: "Laptop",
          name: "",
          serialNumber: "",
          employeeId: "",
          status: "assigned",
          assignedOn: new Date().toISOString().split("T")[0],
        });
        loadAssets();
      }
    } catch (error) {
      console.error("Failed to add asset:", error);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this asset?")) return;
    try {
      await fetch(`/api/assets?id=${id}`, { method: "DELETE" });
      loadAssets();
    } catch (error) {
      console.error("Failed to delete asset:", error);
    }
  }

  async function handleReturn(id: number) {
    try {
      await fetch("/api/assets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "returned", employeeId: null }),
      });
      loadAssets();
    } catch (error) {
      console.error("Failed to return asset:", error);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ padding: "40px", textAlign: "center" }}>
        <p>Loading assets...</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Equipment & Assets</h2>
        <button className="primary-button" onClick={() => setShowForm(!showForm)}>
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? "Cancel" : "Add Asset"}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 20, marginBottom: 20 }}>
          <form onSubmit={handleSubmit}>
            <div className="setting-form">
              <label>
                Asset Type
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Asset Name
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="MacBook Pro 16-inch"
                />
              </label>
              <label>
                Serial Number
                <input
                  type="text"
                  value={formData.serialNumber}
                  onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                  placeholder="C02X1234ABCD"
                />
              </label>
              <label>
                Assigned To
                <select
                  value={formData.employeeId}
                  onChange={(e) => setFormData({ ...formData, employeeId: e.target.value })}
                >
                  <option value="">Unassigned</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="assigned">Assigned</option>
                  <option value="returned">Returned</option>
                  <option value="maintenance">Maintenance</option>
                </select>
              </label>
              <label>
                Assigned Date
                <input
                  type="date"
                  value={formData.assignedOn}
                  onChange={(e) => setFormData({ ...formData, assignedOn: e.target.value })}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              <button type="button" className="secondary-button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button">
                Add Asset
              </button>
            </div>
          </form>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="card" style={{ padding: 40, textAlign: "center" }}>
          <Package size={32} style={{ color: "var(--muted)", marginBottom: 12 }} />
          <p style={{ color: "var(--muted)", margin: 0 }}>No assets tracked yet. Add your first piece of equipment.</p>
        </div>
      ) : (
        <div className="card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Name</th>
                <th>Serial Number</th>
                <th>Assigned To</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const employee = employees.find((e) => e.id === asset.employeeId);
                return (
                  <tr key={asset.id}>
                    <td>{asset.type}</td>
                    <td>
                      <strong>{asset.name}</strong>
                    </td>
                    <td>{asset.serialNumber || "—"}</td>
                    <td>{employee ? `${employee.firstName} ${employee.lastName}` : "Unassigned"}</td>
                    <td>
                      <span className={`status status-${asset.status}`}>{asset.status}</span>
                    </td>
                    <td style={{ display: "flex", gap: 4 }}>
                      {asset.status === "assigned" && (
                        <button className="icon-button" onClick={() => handleReturn(asset.id)} title="Mark as returned">
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      <button className="icon-button" onClick={() => handleDelete(asset.id)} title="Remove">
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
