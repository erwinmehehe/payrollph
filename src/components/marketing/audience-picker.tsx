"use client";

import { useState } from "react";

const AUDIENCES = [
  { id: "freelancer", label: "Freelancer", note: "People, payroll and approvals stay hidden until you need them." },
  { id: "team", label: "Small team", note: "One company, one semi-monthly run, payslips emailed on release." },
  { id: "bookkeeper", label: "Bookkeeper", note: "Switch between client businesses. Each one is tenant-isolated." },
  { id: "branch", label: "Multi-branch", note: "Department-scoped access, delegated approvers, webhooks." },
] as const;

/**
 * Purely a copy switch in the hero, changing which line explains the product.
 * It does not change what the workspace preview below shows, that preview
 * is real and always renders the same seeded demo regardless of this pick.
 */
export function AudiencePicker() {
  const [active, setActive] = useState<(typeof AUDIENCES)[number]["id"]>("bookkeeper");
  const current = AUDIENCES.find((a) => a.id === active)!;

  return (
    <div className="audience-picker">
      <p>Complexity is opt-in. I am a…</p>
      <div className="audience-pills" role="radiogroup" aria-label="Choose your setup">
        {AUDIENCES.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={active === a.id}
            className={`audience-pill ${active === a.id ? "active" : ""}`}
            onClick={() => setActive(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="audience-note" aria-live="polite">
        {current.note}
      </p>
    </div>
  );
}
