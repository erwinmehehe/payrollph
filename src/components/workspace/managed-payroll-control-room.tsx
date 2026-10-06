"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  RefreshCcw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { DashboardData, Notify, PayrollRun } from "./types";
import { Status, formatDate, money } from "./ui";

type ManagedGate = {
  id: number;
  gateKey: string;
  label: string;
  status: string;
  evidenceRef: string | null;
  completedBy: string | null;
  completedAt: string | null;
};

type ManagedRun = {
  id: number;
  periodLabel: string;
  status: string;
  payDate: string;
  employeeCount: number;
  grossPay: string;
  netPay: string;
  clientApproval: null | {
    approvedBy: string;
    approvedAt: string;
    valid: boolean;
  };
};

type ManagedPayload = {
  engagement: null | {
    id: number;
    status: string;
    serviceTier: string;
    slaHours: number;
    targetGoLive: string | null;
    clientApproverUserId: number;
  };
  gates: ManagedGate[];
  runs: ManagedRun[];
  designatedApprover: null | { id: number; name: string; email: string };
  currentUserIsApprover?: boolean;
};

export function ManagedPayrollControlRoom({
  data,
  run,
  notify,
}: {
  data: DashboardData;
  run: PayrollRun | undefined;
  notify: Notify;
}) {
  const organizationId = data.selectedOrganization.id;
  const [payload, setPayload] = useState<ManagedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/managed-payroll?organizationId=${organizationId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Managed payroll controls could not be loaded.");
      setPayload(body as ManagedPayload);
      setEvidence((current) => {
        const next = { ...current };
        for (const gate of (body.gates ?? []) as ManagedGate[]) {
          if (!(gate.id in next)) next[gate.id] = gate.evidenceRef ?? "";
        }
        return next;
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Managed payroll controls could not be loaded.", "err");
    } finally {
      setLoading(false);
    }
  }, [organizationId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function enableManagedPayroll() {
    setBusy(true);
    try {
      const response = await fetch("/api/managed-payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, slaHours: 24 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "Managed payroll could not be enabled.", "err");
        return;
      }
      setPayload(body as ManagedPayload);
      notify("Managed payroll pilot controls enabled. Release now requires exact-run client approval.", "ok");
    } catch {
      notify("Managed payroll could not be enabled because the service could not be reached.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function updateGate(gate: ManagedGate, status: "verified" | "pending") {
    const evidenceRef = (evidence[gate.id] ?? "").trim();
    if (status === "verified" && evidenceRef.length < 3) {
      notify("Add a concrete evidence reference before verifying this gate.", "err");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/managed-payroll", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action: "gate", gateId: gate.id, status, evidenceRef }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "Implementation gate could not be updated.", "err");
        return;
      }
      setPayload(body as ManagedPayload);
      notify(status === "verified" ? "Implementation evidence recorded." : "Implementation gate reopened.", "ok");
    } catch {
      notify("Implementation gate could not be updated because the service could not be reached.", "err");
    } finally {
      setBusy(false);
    }
  }

  async function approveRun(runId: number) {
    const confirmed = window.confirm(
      "Approve this exact payroll register for managed release? If payroll is recalculated afterward, this approval will automatically become stale.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/managed-payroll/runs/${runId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "Client reviewed final checker-approved payroll register." }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(body.error ?? "Client payroll approval could not be recorded.", "err");
        return;
      }
      notify(body.replacedStaleApproval ? "Changed payroll reviewed and re-approved." : "Exact payroll register approved for managed release.", "ok");
      await load();
    } catch {
      notify("Client payroll approval could not be recorded because the service could not be reached.", "err");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div><div className="card-kicker">MANAGED PAYROLL</div><h2>Loading operational controls…</h2></div></div>
      </section>
    );
  }

  if (!payload?.engagement) {
    const owner = data.access?.role === "owner";
    return (
      <section className="card" data-managed-payroll style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">MANAGED PAYROLL</div>
            <h2>Turn outsourcing into a controlled payroll service.</h2>
            <p>Implementation evidence, parallel-run sign-off, designated client approval and release controls stay in the same payroll ledger.</p>
          </div>
          <Status value="Not enabled" />
        </div>
        <div className="notice notice-blue" style={{ margin: "0 18px 14px" }}>
          <ShieldCheck size={15} />
          <span>When enabled, a managed-service payroll cannot be released until the designated client approver approves the exact final register.</span>
        </div>
        {owner && (
          <div className="run-actions">
            <button className="primary-button" disabled={busy} onClick={() => void enableManagedPayroll()}>
              <ClipboardCheck size={15} /> {busy ? "Enabling…" : "Enable controlled pilot"}
            </button>
          </div>
        )}
      </section>
    );
  }

  const verified = payload.gates.filter((gate) => gate.status === "verified").length;
  const selectedRun = payload.runs.find((item) => item.id === run?.id);
  const approval = selectedRun?.clientApproval ?? null;
  const canApprove = Boolean(
    payload.currentUserIsApprover
    && selectedRun
    && selectedRun.status === "Ready for release"
    && (!approval || !approval.valid),
  );

  return (
    <section className="card" data-managed-payroll style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">MANAGED PAYROLL CONTROL ROOM</div>
          <h2>Implementation proof + exact-run client approval.</h2>
          <p>{payload.engagement.serviceTier} · {payload.engagement.slaHours}h operating SLA · designated client approver {payload.designatedApprover?.name ?? "not resolved"}.</p>
        </div>
        <div className="heading-actions">
          <Status value={payload.engagement.status} />
          <button className="secondary-button" disabled={busy} onClick={() => void load()}><RefreshCcw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="run-stats">
        <div><span>Implementation gates</span><strong>{verified}/{payload.gates.length}</strong><small>must carry evidence</small></div>
        <div><span>Client approver</span><strong>{payload.designatedApprover?.name ?? "Missing"}</strong><small>{payload.designatedApprover?.email ?? "Configure owner/admin"}</small></div>
        <div><span>Target go-live</span><strong>{payload.engagement.targetGoLive ? formatDate(payload.engagement.targetGoLive) : "Pilot first"}</strong><small>no GA claim from code alone</small></div>
        <div><span>Selected run</span><strong>{selectedRun?.periodLabel ?? "No run"}</strong><small>{selectedRun ? money(selectedRun.netPay) + " net" : "create payroll first"}</small></div>
      </div>

      {selectedRun && (
        <div className={approval?.valid ? "notice notice-green" : "notice notice-amber"} style={{ margin: "0 18px 14px" }}>
          {approval?.valid ? <CheckCircle2 size={15} /> : <UserCheck size={15} />}
          <span>
            {approval?.valid
              ? `Client approved this exact register: ${approval.approvedBy} on ${formatDate(approval.approvedAt)}.`
              : approval
                ? "Previous client approval is stale because the payroll contents changed. The final register must be reviewed again."
                : selectedRun.status === "Ready for release"
                  ? "Checker approval is complete; managed release is now waiting for designated client approval."
                  : `Client approval becomes available after checker review. Current status: ${selectedRun.status}.`}
          </span>
          {canApprove && (
            <button className="secondary-button" disabled={busy} onClick={() => void approveRun(selectedRun.id)}>
              <BadgeCheck size={14} /> {approval ? "Review & re-approve" : "Approve final register"}
            </button>
          )}
        </div>
      )}

      <div className="card-header" style={{ paddingTop: 4 }}>
        <div><div className="card-kicker">IMPLEMENTATION & PARALLEL RUN</div><h2>Evidence gates</h2><p>Checking a box without a reference does not count.</p></div>
      </div>
      <div className="worksheet-list">
        {payload.gates.map((gate) => (
          <div key={gate.id} style={{ alignItems: "flex-start" }}>
            {gate.status === "verified" ? <CheckCircle2 size={16} className="i-green" /> : <CalendarClock size={16} className="i-amber" />}
            <span style={{ flex: 1 }}>
              {gate.label}
              <small>{gate.status === "verified" ? `Verified by ${gate.completedBy ?? "operator"} · ${gate.evidenceRef}` : "Evidence required before this implementation gate is complete."}</small>
              {gate.status !== "verified" && (
                <input
                  value={evidence[gate.id] ?? ""}
                  onChange={(event) => setEvidence((current) => ({ ...current, [gate.id]: event.target.value }))}
                  placeholder="Evidence reference: reconciliation sheet, UAT ticket, approval record…"
                  style={{ width: "100%", marginTop: 8 }}
                />
              )}
            </span>
            {gate.status === "verified" ? (
              <button className="secondary-button" disabled={busy} onClick={() => void updateGate(gate, "pending")}>Reopen</button>
            ) : (
              <button className="secondary-button" disabled={busy} onClick={() => void updateGate(gate, "verified")}>Verify evidence</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
