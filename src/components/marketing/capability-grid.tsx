"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Check, CircleSlash, MinusCircle } from "lucide-react";
import { Segmented } from "@/components/workspace/ui";

export type PublicCapability = {
  id: string;
  area: string;
  label: string;
  detail: string;
  status: "verified" | "partial" | "absent";
  proof: string;
};

const STATUS_LABEL: Record<PublicCapability["status"], string> = {
  verified: "Verified",
  partial: "Partial",
  absent: "Not built",
};

/**
 * The public capability grid. Statuses and evidence come from the server's own
 * capability report, so this page cannot claim something the code does not do.
 */
export function CapabilityGrid({
  capabilities,
  counts,
}: {
  capabilities: PublicCapability[];
  counts: { verified: number; partial: number; absent: number };
}) {
  const [filter, setFilter] = useState<"all" | PublicCapability["status"]>("all");

  const rows = useMemo(
    () => (filter === "all" ? capabilities : capabilities.filter((row) => row.status === filter)),
    [capabilities, filter],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 18,
        }}
      >
        <Segmented
          label="Capability filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All (${capabilities.length})` },
            { value: "verified", label: `Verified (${counts.verified})` },
            { value: "partial", label: `Partial (${counts.partial})` },
            { value: "absent", label: `Not built (${counts.absent})` },
          ]}
        />
        <a className="link-button" href="/scorecard">
          Full scorecard, including the competitor grid <ArrowUpRight size={12} style={{ display: "inline", verticalAlign: "middle" }} />
        </a>
      </div>

      <div className="card table-card">
        <div className="data-table-wrap slim-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Area</th>
                <th>Status</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong style={{ display: "block", color: "var(--ink)", fontSize: 12.5, fontWeight: 650 }}>{row.label}</strong>
                    <span style={{ display: "block", marginTop: 2, color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}>
                      {row.detail}
                    </span>
                  </td>
                  <td style={{ color: "var(--muted)" }}>{row.area}</td>
                  <td>
                    <span className={`parity-cell ${row.status === "verified" ? "yes" : row.status === "partial" ? "limited" : "no"}`}>
                      {row.status === "verified" && <Check size={9} style={{ marginRight: 4 }} />}
                      {row.status === "partial" && <MinusCircle size={9} style={{ marginRight: 4 }} />}
                      {row.status === "absent" && <CircleSlash size={9} style={{ marginRight: 4 }} />}
                      {STATUS_LABEL[row.status]}
                    </span>
                  </td>
                  <td className="mono" style={{ color: "var(--muted)", fontSize: 10.5 }}>
                    {row.proof}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>
            Status reflects implementation evidence from this deployment&apos;s code and automated tests. Live external
            readiness, such as provider credentials or government portal validation, is tracked separately.
          </span>
        </div>
      </div>
    </div>
  );
}
