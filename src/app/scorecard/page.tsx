import { buildCapabilityReport } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

const statusClass = (status: string) =>
  status === "verified" ? "status-tested" : status === "partial" ? "status-awaiting-approval" : "status-not-certified";
const statusLabel = (status: string) =>
  status === "verified" ? "Verified" : status === "partial" ? "Partial" : "Not built";

const cell = (value: string) => {
  if (value === "yes") return <span className="parity-cell yes">Yes</span>;
  if (value === "no") return <span className="parity-cell no">No</span>;
  if (value === "limited") return <span className="parity-cell limited">Limited</span>;
  return <span className="parity-cell unknown">Unknown</span>;
};

export default async function ScorecardPage() {
  const report = await buildCapabilityReport();

  return (
    <main className="marketing-page">
      <header className="marketing-nav">
        <div className="marketing-brand">
          <div className="brand-mark"><span>sa</span></div>
          <strong>linaw</strong>
        </div>
        <div className="marketing-nav-actions">
          <a className="secondary-button" href="/welcome">Home</a>
          <a className="secondary-button" href="/status">Status</a>
          <a className="primary-button" href="/login">Sign in</a>
        </div>
      </header>

      <section className="card marketing-hero">
        <p className="eyebrow">CAPABILITY SCORECARD</p>
        <h1>Verified claims only.</h1>
        <p className="heading-copy">
          Every row below is generated from this deployment&apos;s code and automated evidence, not a marketing claim.
          &ldquo;Verified&rdquo; means the implementation is proven by an executing test or request-path code. External
          provider readiness is reported separately.
        </p>
        <div className="stats-grid" style={{ marginBottom: 0, marginTop: 20 }}>
          <article className="stat-card">
            <div className="stat-icon mint"><span>✓</span></div>
            <p>VERIFIED</p>
            <h3>{report.counts.verified}</h3>
            <span>proven by code or test</span>
          </article>
          <article className="stat-card">
            <div className="stat-icon orange"><span>~</span></div>
            <p>PARTIAL</p>
            <h3>{report.counts.partial}</h3>
            <span>surface exists, piece missing</span>
          </article>
          <article className="stat-card">
            <div className="stat-icon purple"><span>-</span></div>
            <p>NOT BUILT</p>
            <h3>{report.counts.absent}</h3>
            <span>stated, not implied</span>
          </article>
        </div>
      </section>

      <section className="marketing-section">
        <p className="eyebrow">CAPABILITY MATRIX</p>
        <h2>What is actually true here</h2>
        <article className="card table-card">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>AREA</th><th>CAPABILITY</th><th>STATUS</th><th>EVIDENCE</th></tr></thead>
              <tbody>
                {report.capabilities.map((capability) => (
                  <tr key={capability.id}>
                    <td><small className="mwe-tag">{capability.area}</small></td>
                    <td><div className="person-cell"><div><strong>{capability.label}</strong><span>{capability.detail}</span></div></div></td>
                    <td><Status value={statusLabel(capability.status)} /></td>
                    <td><small className="payslip-note">{capability.proof}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="marketing-section">
        <p className="eyebrow">COMPETITIVE PARITY</p>
        <h2>Linaw vs the incumbents</h2>
        <p className="section-copy">
          The <strong>Linaw column is measured</strong> against this codebase. Competitor columns are our reading of
          their public positioning and are <strong>not</strong> independently verified, treat them as a starting point,
          not evidence.
        </p>
        <article className="card table-card">
          <div className="data-table-wrap">
            <table className="data-table parity-table">
              <thead>
                <tr>
                  <th>CAPABILITY</th>
                  <th>LINAW</th>
                  {report.competitors.map((name) => <th key={name}>{name}</th>)}
                </tr>
              </thead>
              <tbody>
                {report.parity.map((row) => (
                  <tr key={row.capability}>
                    <td><strong>{row.capability}</strong></td>
                    <td><span className={`status status-${row.linaw === "verified" ? "tested" : row.linaw === "partial" ? "awaiting-approval" : "not-certified"}`}>{statusLabel(row.linaw)}</span></td>
                    {report.competitors.map((name) => <td key={name}>{cell(row.competitors[name])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="marketing-section">
        <div className="notice notice-amber marketing-notice">
          <span>
            <strong>Implementation and live readiness are different checks.</strong> SSO / SAML is not built.
            Certified government filing still needs portal validation, and live bank submission still needs the
            external payout account enabled. Email adapters can be code-verified while live delivery configuration is
            reported separately. The deployment gate list is at <a className="link-button" href="/api/readiness">/api/readiness</a> and the
            JSON version of this scorecard at <a className="link-button" href="/api/capabilities">/api/capabilities</a>.
          </span>
        </div>
      </section>

      <footer className="marketing-footer">
        <span>Linaw · capability scorecard</span>
        <span><a className="link-button" href="/status">Status</a> · <a className="link-button" href="/welcome">Home</a></span>
      </footer>
    </main>
  );
}

function Status({ value }: { value: string }) {
  const cls = value === "Verified" ? "status-tested" : value === "Partial" ? "status-awaiting-approval" : "status-not-certified";
  return <span className={`status ${cls}`}>{value}</span>;
}
