"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Download,
  ExternalLink,
  FileCheck2,
  RefreshCcw,
  Save,
  ShieldAlert,
} from "lucide-react";
import type { Notify } from "@/components/workspace/types";
import { Status, money } from "@/components/workspace/ui";

type State = {
  profile: {
    establishmentAddress: string;
    principalBusiness: string;
    contactName: string;
    contactPosition: string;
    contactPhone: string;
  } | null;
  report: {
    reportType: string;
    taxYear: number;
    dueDate: string;
    establishmentName: string;
    establishmentAddress: string;
    principalBusiness: string;
    totalEmployment: number;
    workersBenefited: number;
    totalBenefitsGranted: number;
    contactName: string;
    contactPosition: string;
    contactPhone: string;
    employees: Array<{
      employeeNo: string;
      employeeName: string;
      amountGranted: number;
    }>;
  };
  reportHash: string;
  profileComplete: boolean;
  readyToSubmit: boolean;
  reviewRows: Array<{
    employeeNo: string;
    employeeName: string;
    amountGranted: number;
    screeningEntitlement: number;
    screeningShortfall: number;
  }>;
  incompleteBasicRows: Array<{
    employeeNo: string;
    employeeName: string;
  }>;
  sourceNote: string;
  submissionCurrent: boolean;
  currentSubmission: {
    portalReference: string;
    submittedAt: string;
    recordedByName: string;
  } | null;
  latestSubmission: {
    reportHash: string;
    portalReference: string;
    submittedAt: string;
  } | null;
  submissionHistory: Array<{
    id: number;
    reportHash: string;
    portalReference: string;
    submittedAt: string;
    recordedByName: string;
  }>;
  officialSource: {
    label: string;
    url: string;
    deadline: string;
  };
};

function currentYear() {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Manila", year: "numeric" }).format(new Date()));
}

export function DoleThirteenthMonthReportPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [taxYear, setTaxYear] = useState(currentYear());
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState({
    establishmentAddress: "",
    principalBusiness: "",
    contactName: "",
    contactPosition: "",
    contactPhone: "",
  });
  const [portalReference, setPortalReference] = useState("");
  const [submittedAt, setSubmittedAt] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/compliance/dole-13th-month?organizationId=${organizationId}&taxYear=${taxYear}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "DOLE 13th-month report could not be loaded.");
      setState(body);
      setProfile({
        establishmentAddress: body.profile?.establishmentAddress ?? "",
        principalBusiness: body.profile?.principalBusiness ?? "",
        contactName: body.profile?.contactName ?? "",
        contactPosition: body.profile?.contactPosition ?? "",
        contactPhone: body.profile?.contactPhone ?? "",
      });
    } catch (loadError) {
      setState(null);
      setError(loadError instanceof Error ? loadError.message : "DOLE 13th-month report could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, taxYear]);

  useEffect(() => { void load(); }, [load]);

  async function mutate(action: "save_profile" | "record_submission", extra: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await fetch("/api/compliance/dole-13th-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, taxYear, action, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "DOLE reporting update failed.");
      notify(
        action === "save_profile"
          ? "DOLE reporting profile saved."
          : "DOLE Online Compliance Portal submission evidence recorded.",
        "ok",
      );
      if (action === "record_submission") setPortalReference("");
      await load();
    } catch (mutationError) {
      notify(mutationError instanceof Error ? mutationError.message : "DOLE reporting update failed.", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="card" data-dole-13th-month-report style={{ marginTop: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">DOLE 13TH-MONTH COMPLIANCE REPORT</div>
          <h2>Prepare the annual report, then preserve the portal proof.</h2>
          <p>
            PayrollPH compiles actual 13th-month amounts granted from released payroll, imported history and released final pay.
            The generated CSV is a source worksheet, not an OCP upload template.
          </p>
        </div>
        <div className="heading-actions">
          <select value={taxYear} onChange={(event) => setTaxYear(Number(event.target.value))}>
            {[currentYear(), currentYear() - 1, currentYear() - 2].map((year) => (
              <option value={year} key={year}>{year}</option>
            ))}
          </select>
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCcw size={14} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-red" style={{ margin: 0 }}>
            <ShieldAlert size={15} /><span>{error}</span>
          </div>
        </div>
      ) : state ? (
        <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
          {state.submissionCurrent ? (
            <div className="notice notice-green" style={{ margin: 0 }}>
              <BadgeCheck size={15} />
              <span>
                <strong>Portal submission evidence matches the current report.</strong>{" "}
                Reference {state.currentSubmission?.portalReference}.
              </span>
            </div>
          ) : state.latestSubmission ? (
            <div className="notice notice-red" style={{ margin: 0 }}>
              <ShieldAlert size={15} />
              <span>
                <strong>Previous submission evidence is stale.</strong> Payroll/final-pay data or reporting details changed after that report snapshot.
                Reconcile the report before relying on the prior portal reference.
              </span>
            </div>
          ) : null}

          <div className="run-stats" style={{ margin: 0 }}>
            <div><span>Total employment</span><strong>{state.report.totalEmployment}</strong><small>workers with payroll/final-pay activity in {taxYear}</small></div>
            <div><span>Workers benefited</span><strong>{state.report.workersBenefited}</strong><small>actual recorded 13th-month amount &gt; 0</small></div>
            <div><span>Total benefits granted</span><strong>{money(state.report.totalBenefitsGranted)}</strong><small>actual recorded grants</small></div>
            <div><span>DOLE report deadline</span><strong>{state.report.dueDate}</strong><small>following the report year</small></div>
          </div>

          <section className="leave-request" style={{ display: "grid", gap: 10 }}>
            <div>
              <strong>Establishment reporting profile</strong>
              <p style={{ margin: "3px 0 0" }}>These are required report fields and are kept separate from payroll-calculation data.</p>
            </div>
            <div className="setting-form">
              <label>Establishment address<textarea value={profile.establishmentAddress} onChange={(event) => setProfile((current) => ({ ...current, establishmentAddress: event.target.value }))} /></label>
              <label>Principal product or business<input value={profile.principalBusiness} onChange={(event) => setProfile((current) => ({ ...current, principalBusiness: event.target.value }))} /></label>
              <label>Reporting contact<input value={profile.contactName} onChange={(event) => setProfile((current) => ({ ...current, contactName: event.target.value }))} /></label>
              <label>Position<input value={profile.contactPosition} onChange={(event) => setProfile((current) => ({ ...current, contactPosition: event.target.value }))} /></label>
              <label>Telephone<input value={profile.contactPhone} onChange={(event) => setProfile((current) => ({ ...current, contactPhone: event.target.value }))} /></label>
              <div style={{ alignSelf: "end" }}>
                <button
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => void mutate("save_profile", profile)}
                >
                  <Save size={14} /> Save reporting profile
                </button>
              </div>
            </div>
          </section>

          {state.reviewRows.length > 0 && (
            <div className="notice notice-amber" style={{ margin: 0 }}>
              <ShieldAlert size={15} />
              <span>
                <strong>{state.reviewRows.length} employee(s) need 13th-month coverage/payment review.</strong> PayrollPH's 1/12 screening shows a recorded amount below the basic-salary formula. Confirm rank-and-file coverage and any missing payment evidence before treating this as a final legal shortfall.
              </span>
            </div>
          )}

          {state.incompleteBasicRows.length > 0 && (
            <div className="notice notice-amber" style={{ margin: 0 }}>
              <ShieldAlert size={15} />
              <span>
                <strong>{state.incompleteBasicRows.length} employee(s) have incomplete imported basic-salary history.</strong> Their actual amount granted is still reportable, but PayrollPH cannot safely screen the 1/12 entitlement from incomplete source data.
              </span>
            </div>
          )}

          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>EMPLOYEE</th><th>AMOUNT GRANTED</th></tr></thead>
              <tbody>
                {state.report.employees.map((employee) => (
                  <tr key={employee.employeeNo}>
                    <td><strong>{employee.employeeName}</strong><small>{employee.employeeNo}</small></td>
                    <td>{money(employee.amountGranted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="run-actions">
            <a
              className="secondary-button"
              href={`/api/compliance/dole-13th-month?organizationId=${organizationId}&taxYear=${taxYear}&format=csv`}
            >
              <Download size={14} /> Download source worksheet
            </a>
            <a className="secondary-button" href={state.officialSource.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Open DOLE Online Compliance Portal
            </a>
          </div>

          <section className="leave-request" style={{ display: "grid", gap: 10 }}>
            <div>
              <strong>Record the actual OCP submission</strong>
              <p style={{ margin: "3px 0 0" }}>
                Only record this after the employer submitted the report through DOLE. Generation or download alone never marks the report submitted.
              </p>
            </div>
            <div className="setting-form">
              <label>Portal confirmation/reference<input value={portalReference} onChange={(event) => setPortalReference(event.target.value)} placeholder="Reference shown by DOLE OCP" /></label>
              <label>Submitted date<input type="date" value={submittedAt} onChange={(event) => setSubmittedAt(event.target.value)} /></label>
              <div style={{ alignSelf: "end" }}>
                <button
                  className="primary-button brand"
                  disabled={saving || !state.readyToSubmit || portalReference.trim().length < 4}
                  onClick={() => void mutate("record_submission", { portalReference, submittedAt })}
                >
                  <FileCheck2 size={14} /> Record OCP submission
                </button>
              </div>
            </div>
          </section>

          <div className="notice notice-blue" style={{ margin: 0 }}>
            <FileCheck2 size={15} />
            <span>{state.sourceNote} Current report hash: {state.reportHash.slice(0, 12)}…</span>
          </div>

          {(state.submissionHistory?.length ?? 0) > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
                Submission evidence history ({state.submissionHistory.length})
              </summary>
              <div className="policy-lines" style={{ marginTop: 8 }}>
                {state.submissionHistory.slice(0, 8).map((submission) => (
                  <span key={submission.id}>
                    <b>{submission.portalReference}</b>
                    <small style={{ display: "block", color: "var(--muted)" }}>
                      {new Date(submission.submittedAt).toLocaleDateString("en-PH")} · {submission.recordedByName} · hash {submission.reportHash.slice(0, 12)}…
                    </small>
                  </span>
                ))}
              </div>
            </details>
          )}

          <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
            DOLE requires the annual 13th-month compliance report by January 15 of the following year. The portal acknowledgement remains external evidence; PayrollPH only records the reference supplied by the employer.
          </p>
        </div>
      ) : null}
    </article>
  );
}
