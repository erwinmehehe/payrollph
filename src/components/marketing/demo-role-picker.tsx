"use client";

import { useMemo, useState, type ElementType } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Calculator,
  Check,
  CircleDollarSign,
  LoaderCircle,
  ShieldCheck,
  UserRound,
  UserRoundCheck,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { DEMO_ROLES, type DemoRoleId } from "@/lib/demo-roles";
import styles from "./demo-role-picker.module.css";

const ICONS: Record<DemoRoleId, ElementType> = {
  owner: BriefcaseBusiness,
  bookkeeper: Calculator,
  payroll: CircleDollarSign,
  hr: UsersRound,
  manager: UserRoundCheck,
  employee: UserRound,
  freelancer: WalletCards,
};

export function DemoRolePicker() {
  const [selectedRole, setSelectedRole] = useState<DemoRoleId>("payroll");
  const [launching, setLaunching] = useState<DemoRoleId | null>(null);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => DEMO_ROLES.find((role) => role.id === selectedRole) ?? DEMO_ROLES[0],
    [selectedRole],
  );
  const SelectedIcon = ICONS[selected.id];

  async function openDemo(role: DemoRoleId) {
    setLaunching(role);
    setError("");

    try {
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "This demo is not available on the current deployment.");
        return;
      }

      window.location.href = typeof payload.redirectTo === "string" ? payload.redirectTo : `/?demoRole=${role}`;
    } catch {
      setError("Could not open the demo workspace. Please try again.");
    } finally {
      setLaunching(null);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.shell}>
          <div className={styles.heroInner}>
            <span className={styles.eyebrow}>
              <ShieldCheck size={14} aria-hidden />
              No signup required
            </span>
            <h1>See Linaw from the seat you actually use.</h1>
            <p>
              Open the sample payroll workspace as an owner, payroll administrator, HR team member, manager, employee,
              bookkeeper or freelancer. Each demo starts with the navigation and work that matter to that role.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.demoSection}>
        <div className={styles.shell}>
          <div className={styles.sectionIntro}>
            <span className={styles.kicker}>Role-based product demo</span>
            <h2>Choose a seat.</h2>
            <p>You can switch roles inside the demo at any time.</p>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <div className={styles.demoLayout}>
            <div className={styles.roleList} role="tablist" aria-label="Demo roles">
              {DEMO_ROLES.map((role) => {
                const Icon = ICONS[role.id];
                const active = role.id === selected.id;

                return (
                  <button
                    className={`${styles.roleRow} ${active ? styles.active : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    key={role.id}
                    onClick={() => setSelectedRole(role.id)}
                  >
                    <span className={styles.roleIcon} aria-hidden>
                      <Icon size={16} />
                    </span>
                    <span className={styles.roleText}>
                      <strong>{role.label}</strong>
                      <small>{role.person}</small>
                    </span>
                    {role.id === "payroll" && <span className={styles.suggested}>Start here</span>}
                    <ArrowRight size={14} aria-hidden />
                  </button>
                );
              })}
            </div>

            <article className={styles.roleDetail} role="tabpanel">
              <div className={styles.detailTop}>
                <span className={styles.detailIcon} aria-hidden>
                  <SelectedIcon size={20} />
                </span>
                <div>
                  <span className={styles.personLabel}>{selected.person}</span>
                  <h3>{selected.label}</h3>
                </div>
              </div>

              <p className={styles.description}>{selected.description}</p>

              <div className={styles.detailMeta}>
                <div>
                  <span>Starts in</span>
                  <strong>{selected.landingPage}</strong>
                </div>
                <div>
                  <span>Workspace</span>
                  <strong>Sample Philippine payroll</strong>
                </div>
              </div>

              <div className={styles.accessBlock}>
                <span className={styles.accessLabel}>What you can explore</span>
                <div className={styles.accessList}>
                  {selected.access.map((item) => (
                    <span key={item}>
                      <Check size={13} aria-hidden />
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className={styles.previewPanel}>
                <div className={styles.previewBar}>
                  <span>linaw</span>
                  <span>{selected.shortLabel} workspace</span>
                </div>
                <div className={styles.previewBody}>
                  <span className={styles.previewNav}>Overview</span>
                  <span className={styles.previewNavActive}>{selected.landingPage}</span>
                  <span className={styles.previewNav}>Approvals</span>
                  <div className={styles.previewContent}>
                    <span>{selected.shortLabel}</span>
                    <strong>{selected.landingPage}</strong>
                    <p>{selected.access[0]}</p>
                  </div>
                </div>
              </div>

              <div className={styles.detailFooter}>
                <div>
                  <strong>Sample data only</strong>
                  <span>Nothing in the demo changes a real company payroll.</span>
                </div>
                <button
                  type="button"
                  onClick={() => void openDemo(selected.id)}
                  disabled={Boolean(launching)}
                >
                  {launching === selected.id ? (
                    <>
                      <LoaderCircle className={styles.spin} size={15} aria-hidden />
                      Opening…
                    </>
                  ) : (
                    <>
                      Open {selected.shortLabel} demo <ArrowRight size={15} aria-hidden />
                    </>
                  )}
                </button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
