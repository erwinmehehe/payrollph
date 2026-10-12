"use client";

import { NAVIGATION } from "./nav";

type Props = { visiblePages: readonly string[]; allowedPages: readonly string[]; onPage: (page: string) => void };

/** Navigation is presentation only: the server still checks every module request. */
export function MoreModulesPage({ visiblePages, allowedPages, onPage }: Props) {
  const items = NAVIGATION.filter(group => group.label !== "Workspace")
    .map(group => ({
      label: group.label,
      items: group.items.filter(item => item.name !== "More modules" && !visiblePages.includes(item.name)),
    })).filter(group => group.items.length > 0);
  return <section aria-label="More modules">
    <div className="page-heading"><div>
      <div className="eyebrow">WORKSPACE MODULES</div>
      <h1>More modules</h1>
      <p>Start with People, Time, Payroll and Reports. Open other modules when your role permits them.</p>
    </div></div>
    {items.length === 0 && <p className="empty-state">No additional modules are available for this workspace.</p>}
    {items.map(group => <section key={group.label} className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h2>{group.label}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,210px),1fr))", gap: 12 }}>
        {group.items.map(item => {
          const allowed = allowedPages.includes(item.name);
          const Icon = item.icon;
          return <article key={item.name} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12 }}>
            <strong style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon size={16}/>{item.name}</strong>
            <p style={{ fontSize: 12 }}>{item.hint}</p>
            {allowed ? <button type="button" className="secondary-button" onClick={() => onPage(item.name)}>
              Open {item.name}
            </button> : <span className="badge" aria-label={item.name + " unavailable"}>Not available to this role</span>}
          </article>;
        })}
      </div>
    </section>)}
  </section>;
}
