"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, RefreshCcw, ShieldCheck } from "lucide-react";
import type { Notify } from "./types";
import { EmptyState, Spinner, Status, money } from "./ui";

type Remittance = {
  id: number;
  agency: "SSS" | "PhilHealth" | "Pag-IBIG";
  applicableMonth: string;
  dueDate: string | null;
  dueRule: string;
  expectedEmployeeAmount: string;
  expectedEmployerAmount: string;
  expectedTotalAmount: string;
  employeeCount: number;
  status: string;
  paymentReference: string | null;
  paidAmount: string | null;
  remittedAt: string | null;
  postingReference: string | null;
  postingConfirmedAt: string | null;
  recordedBy: string | null;
  confirmedBy: string | null;
  overdue: boolean;
};

export function StatutoryRemittancePanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [rows, setRows] = useState<Remittance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [remittedAt, setRemittedAt] = useState("");
  const [postingReference, setPostingReference] = useState("");
  const [postingConfirmedAt, setPostingConfirmedAt] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/compliance/remittances?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load contribution remittances.");
      setRows(Array.isArray(body.obligations) ? body.obligations : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load contribution remittances.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? rows.find((row) => row.status !== "confirmed") ?? null,
    [rows, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setPaidAmount(Number(selected.expectedTotalAmount).toFixed(2));
  }, [selected?.id]);

  async function mutate(action: "record_payment" | "confirm_posting") {
    if (!selected) return;
    setSaving(selected.id);
    try {
      const body = action === "record_payment"
        ? {
            organizationId,
            id: selected.id,
            action,
            paidAmount: Number(paidAmount),
            paymentReference,
            remittedAt,
          }
        : {
            organizationId,
            id: selected.id,
            action,
            postingReference,
            postingConfirmedAt,
          };
      const response = await fetch("/api/compliance/remittances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Remittance evidence could not be recorded.");
      notify(
        action === "record_payment"
          ? "Payment recorded. A different authorized reviewer must confirm agency posting."
          : "Agency posting confirmed. This remittance is now closed.",
        "ok",
      );
      setPaymentReference("");
      setRemittedAt("");
      setPostingReference("");
      setPostingConfirmedAt("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Remittance evidence could not be recorded.", "err");
    } finally {
      setSaving(null);
    }
  }

  const overdue = rows.filter((row) => row.overdue);

  return (
    <article className="card" data-statutory-remittance-panel style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">CONTRIBUTION REMITTANCE CONTROL</div>
          <h2>Prove deductions reached the agencies</h2>
          <p>
            Payroll withholding is not the finish line. Linaw tracks the exact monthly liability, payment evidence and a separate agency-posting confirmation for SSS, PhilHealth and Pag-IBIG.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} />} Refresh
        </button>
      </div>

      {overdue.length > 0 && (
        <div className="notice notice-red" style={{ margin: "0 18px 16px" }}>
          <AlertTriangle size={15} />
          <span>
            <strong>{overdue.length} overdue or unresolved remittance obligation{overdue.length === 1 ? "" : "s"}.</strong>{" "}
            Future payroll release is blocked until these are confirmed.
          </span>
        </div>
      )}

      <div className="data-table-wrap slim-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Agency</th>
              <th>Month</th>
              <th>Due</th>
              <th>Employee withheld</th>
              <th>Employer share</th>
              <th>Total to remit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 36).map((row) => (
              <tr
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                style={{ cursor: "pointer" }}
                aria-selected={row.id === selected?.id}
              >
                <td><strong>{row.agency}</strong></td>
                <td className="num">{row.applicableMonth}</td>
                <td>
                  {row.dueDate ?? "Needs setup"}
                  <div className="id">{row.dueRule}</div>
                </td>
                <td className="num">{money(row.expectedEmployeeAmount)}</td>
                <td className="num">{money(row.expectedEmployerAmount)}</td>
                <td className="num"><strong>{money(row.expectedTotalAmount)}</strong></td>
                <td>
                  <Status value={row.overdue && row.status !== "confirmed" ? "Overdue" : row.status.replaceAll("_", " ")} />
                  {row.confirmedBy && <div className="id">Confirmed by {row.confirmedBy}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <EmptyState icon={<ShieldCheck size={20} className="i-green" />} title="No remittance obligations yet">
            Obligations are created automatically and atomically when payroll is released.
          </EmptyState>
        )}
      </div>

      {selected && selected.status !== "confirmed" && (
        <div style={{ padding: 18, display: "grid", gap: 12 }}>
          <div>
            <div className="card-kicker">{selected.agency} · {selected.applicableMonth}</div>
            <strong>{money(selected.expectedTotalAmount)} expected</strong>
            <p className="id" style={{ marginTop: 4 }}>
              {selected.employeeCount} employee(s) · employee withholding {money(selected.expectedEmployeeAmount)} + employer share {money(selected.expectedEmployerAmount)}
            </p>
          </div>

          {selected.status !== "payment_recorded" ? (
            <>
              <div className="setting-form">
                <label>
                  Exact amount paid
                  <input value={paidAmount} inputMode="decimal" onChange={(event) => setPaidAmount(event.target.value)} />
                </label>
                <label>
                  Payment / transaction reference
                  <input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Agency or bank payment reference" />
                </label>
                <label>
                  Remitted at
                  <input type="datetime-local" value={remittedAt} onChange={(event) => setRemittedAt(event.target.value)} />
                </label>
              </div>
              <div className="run-actions">
                <button
                  className="primary-button brand"
                  disabled={saving !== null || paymentReference.trim().length < 4 || !remittedAt}
                  onClick={() => void mutate("record_payment")}
                >
                  <ShieldCheck size={14} /> Record exact payment
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="notice notice-blue" style={{ margin: 0 }}>
                <BadgeCheck size={15} />
                <span>
                  Payment {selected.paymentReference} for {money(selected.paidAmount ?? "0")} was recorded by {selected.recordedBy ?? "a payroll user"}. A different authorized reviewer must confirm the agency posting.
                </span>
              </div>
              <div className="setting-form">
                <label>
                  Agency posting / acknowledgement reference
                  <input value={postingReference} onChange={(event) => setPostingReference(event.target.value)} placeholder="Posting or acknowledgement reference" />
                </label>
                <label>
                  Posting confirmed at
                  <input type="datetime-local" value={postingConfirmedAt} onChange={(event) => setPostingConfirmedAt(event.target.value)} />
                </label>
              </div>
              <div className="run-actions">
                <button
                  className="primary-button brand"
                  disabled={saving !== null || postingReference.trim().length < 4 || !postingConfirmedAt}
                  onClick={() => void mutate("confirm_posting")}
                >
                  <BadgeCheck size={14} /> Confirm agency posting
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
