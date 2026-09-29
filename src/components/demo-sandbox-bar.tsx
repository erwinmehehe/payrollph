"use client";

import { ArrowRight, CheckCircle2, RotateCcw, UserCheck } from "lucide-react";
import { DEMO_ROLES, demoRoleInfo, type DemoRoleId } from "@/lib/demo-roles";

export function DemoSandboxBar({
  role,
  onSwitch,
  onTask,
  busyRole,
}: {
  role: DemoRoleId;
  onSwitch: (role: DemoRoleId) => void;
  onTask: (taskId: string, page: string) => void;
  busyRole?: DemoRoleId | null;
}) {
  const info = demoRoleInfo(role);
  if (!info) return null;

  return (
    <section className="card" style={{ marginBottom: 16, overflow: "hidden" }}>
      <div className="card-header" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="card-kicker">ROLE SANDBOX</div>
          <h2 style={{ marginTop: 4 }}>{info.label} · {info.person}</h2>
          <p>{info.description}</p>
        </div>
        <span className="status status-purple"><UserCheck size={13} /> Live persona</span>
      </div>

      <div style={{ padding: "0 17px 14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DEMO_ROLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === role ? "primary-button" : "secondary-button"}
              style={{ minHeight: 34 }}
              disabled={Boolean(busyRole)}
              onClick={() => item.id !== role && onSwitch(item.id)}
            >
              {busyRole === item.id ? <RotateCcw size={13} /> : <UserCheck size={13} />}
              {item.shortLabel}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line)", padding: "14px 17px 17px" }}>
        <div className="card-kicker">TRY THESE REAL TASKS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8, marginTop: 8 }}>
          {info.tasks.map((task, index) => (
            <button
              key={task.id}
              type="button"
              className="secondary-button"
              style={{
                minHeight: 86,
                height: "auto",
                padding: "12px",
                justifyContent: "space-between",
                textAlign: "left",
                alignItems: "flex-start",
              }}
              onClick={() => onTask(task.id, task.page)}
            >
              <span style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <CheckCircle2 size={15} className="i-green" style={{ marginTop: 2, flex: "none" }} />
                <span>
                  <strong style={{ display: "block", color: "var(--ink)" }}>{index + 1}. {task.label}</strong>
                  <small style={{ display: "block", marginTop: 4, lineHeight: 1.45, color: "var(--muted)" }}>{task.detail}</small>
                </span>
              </span>
              <ArrowRight size={14} style={{ flex: "none", marginTop: 2 }} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
