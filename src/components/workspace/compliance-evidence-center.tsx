"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  FileCheck2,
  RefreshCcw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type { DashboardData } from "./types";
import { EmptyState, Spinner, Status, money } from "./ui";

type Domain = {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  status: "proven" | "partial" | "missing" | "blocked";
  detail: string;
};

type Finding = {
  severity: string;
  kind: string;
  title: string;
  detail: string;
  amount: number | null;
  action: string;
};

type Overview = {
  checkedAt: string;
  score: number;
  scoreLabel: string;
  disclaimer: string;
  domains: Domain[];
  knownRemittanceExposure: number;
  findings: Finding[];
  evidence: {
    activeApprovedRules: number;
    latestPayrollRun: { id: number; periodLabel: string; status: string; blockingFindings: number } | null;
    filing: { accepted: number; required: number };
    remittance: { due: number; confirmed: number; overdue: number };
    bank: { acceptedValidations: number };
  };
};

type LocalValidation = {
  document: string;
  agency: string;
  status: string;
  checks: Array<{ rule: string; passed: boolean; message: string }>;
  nextStep: string;
};

const DOMAIN_ICONS: Record<string, typeof ShieldCheck> = {
  rules: Scale,
  payroll: ShieldCheck,
  filing: FileCheck2,
  remittance: BadgeCheck,
  bank: Banknote,
};

export function ComplianceEvidenceCenter({
  data,
  setNotice,
}: {
  data: DashboardData;
  setNotice: (message: string) => void;
}) {
  const organizationId = data.selectedOrganization.id;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [localValidations, setLocalValidations] = useState<LocalValidation[]>([]);
  const [loading, setLoading] = useState(true);
  const [preflighting, setPreflighting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/compliance/overview?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load compliance evidence.");
      setOverview(body as Overview);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load compliance evidence.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, setNotice]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runLocalPreflight() {
    setPreflighting(true);
    try {
      const response = await fetch("/api/compliance/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Government filing preflight failed.");
      setLocalValidations(Array.isArray(body.validations) ? body.validations : []);
      setNotice("Local filing preflight completed. Portal acceptance is still tracked separately.");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Government filing preflight failed.");
    } finally {
      setPreflighting(false);
    }
  }

  const topFinding = overview?.findings[0] ?? null;

  return (
    <>
      <section className="card" data-compliance-evidence-center style={{ marginTop: 16 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">COMPLIANCE EVIDENCE READINESS</div>
            <h2>Show what is proven, what is exposed, and what still needs evidence.</h2>
            <p>
              This score is built from recorded payroll controls, current rule governance, agency filing acknowledgements,
              contribution remittance evidence, and bank UAT. It is not a legal-compliance certificate.
            </p>
          </div>
          <div className="heading-actions">
            <button className="secondary-button" disabled={loading} onClick={() => void load()}>
              {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} />} Refresh
            </button>
            <button className="primary-button" disabled={preflighting} onClick={() => void runLocalPreflight()}>
              <ShieldCheck size={14} /> {preflighting ? "Checking..." : "Run local filing preflight"}
            </button>
          </div>
        </div>

        {overview && (
          <>
            <div className="run-stats">
              <div>
                <span>{overview.scoreLabel}</span>
                <strong>{overview.score}/100</strong>
              </div>
              <div>
                <span>Known overdue remittance exposure</span>
                <strong className={overview.knownRemittanceExposure > 0 ? "" : "green-number"}>
                  {money(overview.knownRemittanceExposure)}
                </strong>
              </div>
              <div>
                <span>Agency formats accepted</span>
                <strong>{overview.evidence.filing.accepted}/{overview.evidence.filing.required}</strong>
              </div>
              <div>
                <span>Due remittances confirmed</span>
                <strong>{overview.evidence.remittance.confirmed}/{overview.evidence.remittance.due}</strong>
              </div>
            </div>

            <section className="module-grid three" style={{ padding: "0 18px 18px" }}>
              {overview.domains.map((domain) => {
                const Icon = DOMAIN_ICONS[domain.key] ?? ShieldCheck;
                return (
                  <article className="card compliance-tile" key={domain.key} style={{ boxShadow: "none" }}>
                    <div className="inline-icon mint"><Icon size={18} /></div>
                    <span>{domain.label.toUpperCase()}</span>
                    <h2>{domain.points}/{domain.maxPoints}</h2>
                    <p>{domain.detail}</p>
                    <Status value={domain.status === "proven" ? "Proven" : domain.status === "blocked" ? "Blocked" : domain.status === "partial" ? "Partial" : "Evidence needed"} />
                  </article>
                );
              })}
            </section>

            {topFinding ? (
              <div className="notice notice-red" style={{ margin: "0 18px 18px" }}>
                <AlertTriangle size={15} />
                <span>
                  <strong>{topFinding.title}.</strong> {topFinding.detail} {topFinding.action}
                </span>
              </div>
            ) : (
              <div className="notice notice-green" style={{ margin: "0 18px 18px" }}>
                <BadgeCheck size={15} />
                <span>No currently recorded compliance-evidence finding needs action.</span>
              </div>
            )}

            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Risk / evidence gap</th>
                    <th>Severity</th>
                    <th>Known amount</th>
                    <th>Required action</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.findings.slice(0, 20).map((finding, index) => (
                    <tr key={`${finding.kind}-${index}`}>
                      <td>
                        <strong>{finding.title}</strong>
                        <div className="id">{finding.detail}</div>
                      </td>
                      <td><Status value={finding.severity} /></td>
                      <td className="num">{finding.amount == null ? "Not quantified" : money(finding.amount)}</td>
                      <td>{finding.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {overview.findings.length === 0 && (
                <EmptyState icon={<BadgeCheck size={20} className="i-green" />} title="No recorded evidence gap">
                  Continue recording filing, remittance, bank and payroll evidence so this stays defensible.
                </EmptyState>
              )}
            </div>

            <p className="disclaimer" style={{ margin: 18 }}>{overview.disclaimer}</p>
          </>
        )}
      </section>

      {localValidations.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            <div>
              <div className="card-kicker">LOCAL FILING PREFLIGHT</div>
              <h2>Data readiness before you touch an agency portal.</h2>
              <p>These checks do not count as filing acceptance. They surface missing data and the next official step.</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Document</th><th>Local status</th><th>Checks</th><th>Next step</th></tr></thead>
              <tbody>
                {localValidations.map((validation) => {
                  const passed = validation.checks.filter((check) => check.passed).length;
                  return (
                    <tr key={`${validation.agency}-${validation.document}`}>
                      <td><strong>{validation.document}</strong><div className="id">{validation.agency}</div></td>
                      <td><Status value={validation.status.replaceAll("_", " ")} /></td>
                      <td>{passed}/{validation.checks.length} local checks passed</td>
                      <td>{validation.nextStep}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
