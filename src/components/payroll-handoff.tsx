"use client";

import { Check, Circle, Clock3 } from "lucide-react";
import type { PayrollHandoffKey, PayrollHandoffStage } from "@/lib/payroll-handoff";

export function PayrollHandoff({
  stages,
  period,
  status,
  payDate,
  viewerRole,
  compact = false,
}: {
  stages: PayrollHandoffStage[];
  period: string;
  status: string;
  payDate?: string | null;
  viewerRole?: PayrollHandoffKey | null;
  compact?: boolean;
}) {
  const current = stages.find((stage) => stage.state === "current") ?? stages[stages.length - 1];

  return (
    <section className={`payroll-handoff ${compact ? "compact" : ""}`} data-payroll-handoff>
      <div className="payroll-handoff-head">
        <div>
          <span className="card-kicker">PAYROLL HANDOFF</span>
          <h2>{period}</h2>
          <p>{current.owner} owns the next visible step · {current.label}</p>
        </div>
        <div className="payroll-handoff-meta">
          <span className="status">{status}</span>
          {payDate && <small>Pay date {displayPayDate(payDate)}</small>}
        </div>
      </div>

      <div className="handoff-steps" role="list" aria-label="Payroll handoff">
        {stages.map((stage, index) => {
          const mine = viewerRole === stage.key;
          return (
            <div
              className={`handoff-step ${stage.state} ${mine ? "mine" : ""}`}
              key={stage.key}
              role="listitem"
              data-handoff-stage={stage.key}
            >
              <div className="handoff-step-marker">
                {stage.state === "done" ? <Check size={13} /> : stage.state === "current" ? <Clock3 size={13} /> : <Circle size={11} />}
              </div>
              <div className="handoff-step-copy">
                <div className="handoff-step-top">
                  <span>{index + 1}</span>
                  <strong>{stage.owner}</strong>
                  {mine && <em>You</em>}
                </div>
                <b>{stage.label}</b>
                <p>{stage.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}


function displayPayDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value + "T00:00:00+08:00"),
  );
}
