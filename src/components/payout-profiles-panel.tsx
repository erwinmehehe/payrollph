"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Landmark, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useScopedAsyncResource } from "./workspace/use-scoped-async-resource";
import { resolveScopedOption, type ScopedOptionSelection } from "@/lib/scoped-option-selection";

type Adapter = {
  id: number;
  name: string;
  version: string;
  format: string;
  bankCode: string | null;
  productName: string | null;
  adapterStage: string;
  effectiveStage: string;
  specSource: string;
  specReference: string | null;
  portalValidated: boolean;
};

type Profile = {
  id: number;
  legalEntityId: number;
  bankTemplateId: number | null;
  defaultMethod: string;
  bankProduct: string | null;
  sourceAccountType: string | null;
  companyCode: string | null;
  presentingOffice: string | null;
  branchCode: string | null;
  remarks: string | null;
  maxAmountPerFile: string | null;
  maxRowsPerFile: number | null;
  transactionLimit: string | null;
  dailyLimit: string | null;
  active: boolean;
};

type EntityProfile = {
  legalEntity: {
    id: number;
    code: string;
    displayName: string;
    disbursementBankCode: string | null;
    disbursementAccountName: string | null;
    disbursementAccount: string | null;
    active: boolean;
  };
  profile: Profile | null;
};

type Payload = {
  profiles: EntityProfile[];
  adapters: Adapter[];
  xenditEnabled?: boolean;
};

type FormState = {
  defaultMethod: string;
  bankTemplateId: string;
  bankProduct: string;
  sourceAccountType: string;
  companyCode: string;
  presentingOffice: string;
  branchCode: string;
  remarks: string;
  maxAmountPerFile: string;
  maxRowsPerFile: string;
  transactionLimit: string;
  dailyLimit: string;
  active: boolean;
};

const blank: FormState = {
  defaultMethod: "bank_file",
  bankTemplateId: "",
  bankProduct: "",
  sourceAccountType: "",
  companyCode: "",
  presentingOffice: "",
  branchCode: "",
  remarks: "",
  maxAmountPerFile: "",
  maxRowsPerFile: "",
  transactionLimit: "",
  dailyLimit: "",
  active: false,
};

function fromProfile(profile: Profile | null): FormState {
  if (!profile) return { ...blank };
  return {
    defaultMethod: profile.defaultMethod,
    bankTemplateId: profile.bankTemplateId ? String(profile.bankTemplateId) : "",
    bankProduct: profile.bankProduct ?? "",
    sourceAccountType: profile.sourceAccountType ?? "",
    companyCode: profile.companyCode ?? "",
    presentingOffice: profile.presentingOffice ?? "",
    branchCode: profile.branchCode ?? "",
    remarks: profile.remarks ?? "",
    maxAmountPerFile: profile.maxAmountPerFile ?? "",
    maxRowsPerFile: profile.maxRowsPerFile ? String(profile.maxRowsPerFile) : "",
    transactionLimit: profile.transactionLimit ?? "",
    dailyLimit: profile.dailyLimit ?? "",
    active: profile.active,
  };
}

function stageLabel(stage: string) {
  switch (stage) {
    case "spec_obtained": return "Spec obtained";
    case "mapping_ready": return "Mapping ready";
    case "uat_ready": return "UAT ready";
    case "portal_validated": return "Portal validated";
    case "production_proven": return "Production proven";
    default: return "Draft / not validated";
  }
}

export function PayoutProfilesPanel({
  organizationId,
  setNotice,
}: {
  organizationId: number;
  setNotice: (message: string) => void;
}) {
  return <ScopedPayoutProfiles key={organizationId} organizationId={organizationId} setNotice={setNotice}/>;
}

function ScopedPayoutProfiles({ organizationId, setNotice }: {
  organizationId: number; setNotice: (message: string) => void;
}) {
  const [selection, setSelection] = useState<ScopedOptionSelection | null>(null);
  const fetchProfiles = useCallback(async (signal: AbortSignal): Promise<Payload> => {
    const response = await fetch(`/api/payout-profiles?organizationId=${organizationId}`, { cache: "no-store", signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load company payout profiles.");
    if (!Array.isArray(body.profiles) || !Array.isArray(body.adapters)) throw new Error("Company payout profile records could not be verified.");
    return body as Payload;
  }, [organizationId]);
  const { data, error, loading, reload } = useScopedAsyncResource(String(organizationId), fetchProfiles);
  const payload = data ?? { profiles: [], adapters: [] };
  const options = useMemo(() => [...(data?.profiles ?? [])]
    .sort((a, b) => Number(b.legalEntity.active) - Number(a.legalEntity.active))
    .map(row => ({ id: row.legalEntity.id })), [data]);
  const selectedEntityId = Number(resolveScopedOption(selection, organizationId, options)) || null;
  const selected = payload.profiles.find(row => row.legalEntity.id === selectedEntityId) ?? null;

  return (
    <section style={{ marginBottom: 16 }} data-payout-profiles>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TREASURY CONFIGURATION</div>
          <h1>Company payout profiles</h1>
          <p>Configure how each legal employer moves already-released net payroll. These settings do not calculate gross pay, statutory deductions, withholding, or net pay.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      <div className="notice notice-slate" style={{ marginBottom: 16 }}>
        <ShieldCheck size={15} />
        <span><strong>Post-payroll boundary.</strong> Payout profiles consume the released payroll amount. Bank-adapter readiness is shown separately and cannot make a draft adapter appear validated.</span>
      </div>

      {loading && <p role="status">Loading company payout profiles…</p>}
      {error && <p role="alert">{error.message}</p>}

      <div className="module-grid two">
        <article className="card">
          <div className="card-header">
            <div><div className="card-kicker">LEGAL EMPLOYERS</div><h2>Payout configuration</h2></div>
          </div>
          {payload.profiles.map((row) => {
            const adapter = payload.adapters.find((item) => item.id === row.profile?.bankTemplateId);
            return (
              <button
                key={row.legalEntity.id}
                type="button"
                className="leave-request"
                style={{
                  width: "100%",
                  border: 0,
                  borderTop: "1px solid var(--line)",
                  textAlign: "left",
                  cursor: "pointer",
                  background: selectedEntityId === row.legalEntity.id ? "var(--green-light)" : "transparent",
                }}
                onClick={() => setSelection({ organizationId, value: String(row.legalEntity.id) })}
              >
                <div className="inline-icon purple"><Landmark size={16} /></div>
                <div style={{ flex: 1 }}>
                  <strong>{row.legalEntity.displayName}</strong>
                  <span>{row.legalEntity.code} · {row.legalEntity.disbursementBankCode ?? "Bank not configured"} · {row.legalEntity.disbursementAccount ?? "No source account"}</span>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {row.profile?.active ? "Profile active" : "Profile inactive"}
                    {adapter ? ` · ${stageLabel(adapter.effectiveStage)}` : ""}
                  </small>
                </div>
              </button>
            );
          })}
          {data && payload.profiles.length === 0 && !loading && <div className="empty-state">No legal employers found.</div>}
        </article>

        <article className="card">
          <div className="card-header">
            <div>
              <div className="card-kicker">PAYOUT PROFILE</div>
              <h2>{selected?.legalEntity.displayName ?? "Select a legal employer"}</h2>
              <p>Source-account details remain encrypted on the legal-employer record. This profile stores operational payout controls only.</p>
            </div>
          </div>

          {selected && <PayoutProfileEditor key={selected.legalEntity.id} organizationId={organizationId}
            selected={selected} adapters={payload.adapters} xenditEnabled={data?.xenditEnabled === true} setNotice={setNotice} reload={reload}/>}
        </article>
      </div>
    </section>
  );
}

export function PayoutMethodOptions({ xenditEnabled = false, currentMethod = "bank_file" }: {
  xenditEnabled?: boolean; currentMethod?: string;
}) {
  return <>
    <option value="bank_file">Bank file / portal</option>
    {xenditEnabled === true && <option value="xendit">Xendit payroll (requires treasury enablement)</option>}
    {!xenditEnabled && currentMethod === "xendit" &&
      <option value="xendit" disabled>Xendit disabled — review existing profile</option>}
    <option value="paymongo">{xenditEnabled === true ? "PayMongo PESONet/InstaPay (legacy)" : "PayMongo PESONet/InstaPay"}</option>
    <option value="manual">Manual bank workflow</option>
  </>;
}

function PayoutProfileEditor({ organizationId, selected, adapters, xenditEnabled, setNotice, reload }: {
  organizationId: number; selected: EntityProfile; adapters: Adapter[];
  xenditEnabled: boolean;
  setNotice: (message: string) => void; reload: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => fromProfile(selected.profile));
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const selectedAdapter = adapters.find(adapter => String(adapter.id) === form.bankTemplateId) ?? null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/payout-profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          legalEntityId: selected.legalEntity.id,
          defaultMethod: form.defaultMethod,
          bankTemplateId: form.bankTemplateId ? Number(form.bankTemplateId) : null,
          bankProduct: form.bankProduct,
          sourceAccountType: form.sourceAccountType,
          companyCode: form.companyCode,
          presentingOffice: form.presentingOffice,
          branchCode: form.branchCode,
          remarks: form.remarks,
          maxAmountPerFile: form.maxAmountPerFile,
          maxRowsPerFile: form.maxRowsPerFile,
          transactionLimit: form.transactionLimit,
          dailyLimit: form.dailyLimit,
          active: form.active,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!response.ok) throw new Error(body.error ?? "Could not save company payout profile.");
      setNotice("Company payout profile updated. Payroll computation was not changed.");
      await reload();
    } catch (error) {
      if (!mounted.current) return;
      setNotice(error instanceof Error ? error.message : "Could not save company payout profile.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <form onSubmit={save} style={{ padding: "0 16px 16px" }}>
      <div className="notice notice-blue" style={{ marginBottom: 14 }}>
        <span>
          Funding source: <strong>{selected.legalEntity.disbursementAccountName ?? "Not configured"}</strong>
          {" · "}
          {selected.legalEntity.disbursementBankCode ?? "No bank code"}
          {" · "}
          {selected.legalEntity.disbursementAccount ?? "No account"}
        </span>
      </div>

      <div className="setting-form">
        <label>Default payout method
          <select value={form.defaultMethod} onChange={(e) => setForm({ ...form, defaultMethod: e.target.value })}>
            <PayoutMethodOptions xenditEnabled={xenditEnabled} currentMethod={form.defaultMethod} />
          </select>
        </label>

        <label>Bank adapter
          <select
            value={form.bankTemplateId}
            disabled={form.defaultMethod !== "bank_file"}
            onChange={(e) => setForm({ ...form, bankTemplateId: e.target.value })}
          >
            <option value="">Select adapter</option>
            {adapters.map((adapter) => (
              <option key={adapter.id} value={adapter.id}>
                {adapter.name} · {adapter.version} · {stageLabel(adapter.effectiveStage)}
              </option>
            ))}
          </select>
        </label>

        <label>Bank product / channel<input maxLength={120} value={form.bankProduct} onChange={(e) => setForm({ ...form, bankProduct: e.target.value })} placeholder="BizLink / OneHub / MBOS / eGov" /></label>
        <label>Source account type<input maxLength={32} value={form.sourceAccountType} onChange={(e) => setForm({ ...form, sourceAccountType: e.target.value })} placeholder="Checking / payroll" /></label>
        <label>Company code<input maxLength={80} value={form.companyCode} onChange={(e) => setForm({ ...form, companyCode: e.target.value })} /></label>
        <label>Presenting office<input maxLength={80} value={form.presentingOffice} onChange={(e) => setForm({ ...form, presentingOffice: e.target.value })} /></label>
        <label>Branch code<input maxLength={32} value={form.branchCode} onChange={(e) => setForm({ ...form, branchCode: e.target.value })} /></label>
        <label>Maximum amount / file<input inputMode="decimal" value={form.maxAmountPerFile} onChange={(e) => setForm({ ...form, maxAmountPerFile: e.target.value })} placeholder="Optional" /></label>
        <label>Maximum rows / file<input inputMode="numeric" value={form.maxRowsPerFile} onChange={(e) => setForm({ ...form, maxRowsPerFile: e.target.value })} placeholder="Optional" /></label>
        <label>Transaction limit<input inputMode="decimal" value={form.transactionLimit} onChange={(e) => setForm({ ...form, transactionLimit: e.target.value })} placeholder="Optional" /></label>
        <label>Daily limit<input inputMode="decimal" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} placeholder="Optional" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Bank remarks / originator reference<input maxLength={240} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></label>
      </div>

      {selectedAdapter && (
        <div className={selectedAdapter.portalValidated ? "notice notice-green" : "notice notice-slate"} style={{ marginTop: 14 }}>
          <ShieldCheck size={15} />
          <span>
            <strong>{selectedAdapter.name} {selectedAdapter.version}</strong> — {stageLabel(selectedAdapter.effectiveStage)}.
            {selectedAdapter.portalValidated
              ? " This organization has recorded accepted bank-portal UAT for the exact adapter version."
              : " Do not market this adapter as bank-validated until accepted portal UAT is recorded."}
          </span>
        </div>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 14 }}>
        <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        <span><strong>Activate payout profile</strong><br /><small>Activation configures the operational route; it does not certify the bank adapter.</small></span>
      </label>

      <div className="run-actions">
        <button className="primary-button" disabled={saving}>
          <Save size={14} /> {saving ? "Saving..." : "Save payout profile"}
        </button>
      </div>
    </form>
  );
}
