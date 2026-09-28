"use client";

import { useState, type ElementType } from "react";
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

const ACCENTS: Record<DemoRoleId, string> = {
  owner: "navy",
  bookkeeper: "blue",
  payroll: "green",
  hr: "violet",
  manager: "amber",
  employee: "cyan",
  freelancer: "teal",
};

export function DemoRolePicker() {
  const [launching, setLaunching] = useState<DemoRoleId | null>(null);
  const [error, setError] = useState("");

  async function openDemo(role: DemoRoleId) {
    setLaunching(role);
    setError("");

    try {
      const sessionRole = role === "employee" ? "employee" : "bookkeeper";
      const response = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: sessionRole }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "This demo is not available on the current deployment.");
        return;
      }

      window.location.href = role === "employee" ? "/?demoRole=employee" : `/?demoRole=${role}`;
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
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>
              <ShieldCheck size={14} aria-hidden />
              No signup required
            </span>
            <h1>Explore Linaw from every seat.</h1>
            <p>
              Choose a role and enter a sample Philippine payroll workspace with the navigation and workflow focused on
              that person&apos;s job.
            </p>
          </div>

          <div className={styles.heroTrust}>
            <span><Check size={14} aria-hidden /> Sample company and employee data</span>
            <span><Check size={14} aria-hidden /> Role-focused navigation</span>
            <span><Check size={14} aria-hidden /> Employee self-service included</span>
          </div>
        </div>
      </section>

      <section className={styles.rolesSection}>
        <div className={styles.shell}>
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.kicker}>Choose a demo account</span>
              <h2>What do you want to see?</h2>
            </div>
            <p>
              Start with the role closest to yours. You can return to this page any time and switch to another demo.
            </p>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}

          <div className={styles.roleGrid}>
            {DEMO_ROLES.map((role) => {
              const Icon = ICONS[role.id];
              const busy = launching === role.id;
              const featured = role.id === "payroll";

              return (
                <article
                  className={`${styles.roleCard} ${featured ? styles.featured : ""}`}
                  data-accent={ACCENTS[role.id]}
                  key={role.id}
                >
                  {featured && <span className={styles.recommended}>Best place to start</span>}

                  <div className={styles.cardTop}>
                    <span className={styles.iconWrap} aria-hidden>
                      <Icon size={20} />
                    </span>
                    <div>
                      <span className={styles.person}>{role.person}</span>
                      <h3>{role.label}</h3>
                    </div>
                  </div>

                  <p className={styles.description}>{role.description}</p>

                  <ul className={styles.accessList}>
                    {role.access.map((item) => (
                      <li key={item}>
                        <Check size={13} aria-hidden />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <div className={styles.cardFooter}>
                    <span>
                      Opens in <strong>{role.landingPage}</strong>
                    </span>
                    <button type="button" onClick={() => void openDemo(role.id)} disabled={Boolean(launching)}>
                      {busy ? (
                        <>
                          <LoaderCircle className={styles.spin} size={15} aria-hidden />
                          Opening…
                        </>
                      ) : (
                        <>
                          Open demo <ArrowRight size={15} aria-hidden />
                        </>
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={styles.note}>
            <ShieldCheck size={16} aria-hidden />
            <div>
              <strong>These are demo experiences.</strong>
              <span>
                They use sample payroll data so you can explore the product without creating a real company account.
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
