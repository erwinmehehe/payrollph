"use client";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  MailWarning,
  Webhook,
} from "lucide-react";
import type { OperationsAttention } from "@/lib/operations-attention";

export function NeedsAttentionCenter({
  state,
  onPage,
  onOpenOutbox,
}: {
  state: OperationsAttention;
  onPage: (page: string) => void;
  onOpenOutbox?: () => void;
}) {
  const hasIssues = state.total > 0;

  return (
    <section className="ops-attention-card" aria-label="Needs attention">
      <div className="ops-attention-head">
        <div>
          <div className="ops-attention-kicker">
            {state.critical > 0 ? <CircleAlert size={14} /> : <BadgeCheck size={14} />}
            OPERATIONS
          </div>
          <h2>{hasIssues ? "Needs attention" : "Operations are clear"}</h2>
          <p>
            {hasIssues
              ? "One queue for payroll, employee data, delivery and approval problems."
              : "No current operational blocker is visible for your role."}
          </p>
        </div>
        <div className="ops-attention-summary" aria-label={state.total + " operational items"}>
          <strong>{state.total}</strong>
          <span>{state.total === 1 ? "item" : "items"}</span>
        </div>
      </div>

      {!hasIssues ? (
        <div className="ops-attention-empty">
          <BadgeCheck size={18} />
          <div>
            <strong>No action required</strong>
            <span>New payroll, delivery, payout, people-data and approval issues will appear here automatically.</span>
          </div>
        </div>
      ) : (
        <div className="ops-attention-list">
          {state.items.map((item) => {
            const Icon =
              item.key === "email-delivery"
                ? MailWarning
                : item.key === "webhook-delivery"
                  ? Webhook
                  : item.severity === "critical"
                    ? CircleAlert
                    : AlertTriangle;

            return (
              <article className="ops-attention-row" data-severity={item.severity} key={item.key}>
                <span className="ops-attention-icon" aria-hidden>
                  <Icon size={16} />
                </span>
                <div className="ops-attention-copy">
                  <div>
                    <strong>{item.title}</strong>
                    <span className="ops-attention-count">{item.count}</span>
                  </div>
                  <p>{item.detail}</p>
                </div>
                <button
                  className="ops-attention-action"
                  onClick={() => {
                    if (item.action.kind === "outbox") onOpenOutbox?.();
                    else onPage(item.action.page);
                  }}
                  disabled={item.action.kind === "outbox" && !onOpenOutbox}
                >
                  {item.action.label} <ArrowRight size={13} />
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
