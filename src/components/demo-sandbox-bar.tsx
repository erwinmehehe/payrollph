"use client";

import { ArrowRight, CheckCircle2, RotateCcw, ShieldCheck, UserCheck } from "lucide-react";
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
    <section className="card demo-sandbox">
      <div className="card-header demo-sandbox-head">
        <div>
          <div className="card-kicker">ROLE SANDBOX</div>
          <h2>{info.label} · {info.person}</h2>
          <p>{info.description}</p>
        </div>
        <span className="demo-persona-badge">
          <UserCheck size={13} aria-hidden />
          Live persona
        </span>
      </div>

      <div className="demo-sandbox-body">
        <div className="demo-role-switcher" aria-label="Demo personas">
          {DEMO_ROLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={(item.id === role ? "primary-button" : "secondary-button") + " demo-role-button"}
              disabled={Boolean(busyRole)}
              onClick={() => item.id !== role && onSwitch(item.id)}
            >
              {busyRole === item.id ? <RotateCcw size={13} className="animate-spin" /> : <UserCheck size={13} />}
              {item.shortLabel}
            </button>
          ))}
        </div>

        <div className="demo-access-panel">
          <div className="demo-access-title">
            <ShieldCheck size={13} className="i-green" aria-hidden />
            <span>THIS ROLE CAN SEE</span>
          </div>
          <div className="demo-access-chips">
            {info.access.map((item) => (
              <span key={item} className="demo-access-chip">
                <CheckCircle2 size={12} className="i-green" aria-hidden />
                <span>{item}</span>
              </span>
            ))}
          </div>
          <p className="demo-access-note">
            Navigation is scoped to the selected persona. Owner-only administration stays hidden, and every write action is still checked by the server.
          </p>
        </div>
      </div>

      <div className="demo-task-section">
        <div className="card-kicker">TRY THESE REAL TASKS</div>
        <div className="demo-task-grid">
          {info.tasks.map((task, index) => (
            <button
              key={task.id}
              type="button"
              className="secondary-button demo-task-card"
              onClick={() => onTask(task.id, task.page)}
            >
              <span className="demo-task-copy">
                <CheckCircle2 size={16} className="i-green" aria-hidden />
                <span>
                  <strong>{index + 1}. {task.label}</strong>
                  <small>{task.detail}</small>
                </span>
              </span>
              <ArrowRight className="demo-task-arrow" size={15} aria-hidden />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
