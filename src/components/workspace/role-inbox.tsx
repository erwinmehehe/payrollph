"use client";

import { ArrowRight, CheckCircle2, Clock3 } from "lucide-react";
import type { RoleInbox } from "@/lib/role-inbox";

export function RoleInboxPanel({
  inbox,
  onPage,
}: {
  inbox: RoleInbox;
  onPage: (page: string) => void;
}) {
  return (
    <section className="role-inbox" data-role-inbox={inbox.role}>
      <div className="role-inbox-head">
        <div>
          <span className="card-kicker">YOUR HANDOFF INBOX</span>
          <h2>{inbox.items.length ? "Needs you now" : "Nothing needs you right now"}</h2>
          <p>
            {inbox.items.length
              ? `${inbox.items.length} action${inbox.items.length === 1 ? "" : "s"} before the payroll can move forward.`
              : `The current handoff owner is ${inbox.currentOwner}. You can wait until the run returns to your stage.`}
          </p>
        </div>
        <span className={`role-inbox-state ${inbox.items.length ? "active" : "waiting"}`}>
          {inbox.items.length ? <Clock3 size={13} /> : <CheckCircle2 size={13} />}
          {inbox.items.length ? `${inbox.items.length} open` : `Waiting on ${inbox.currentOwner}`}
        </span>
      </div>

      {inbox.items.length > 0 && (
        <div className="role-inbox-list">
          {inbox.items.map((item) => (
            <button
              type="button"
              className={`role-inbox-item ${item.tone}`}
              key={item.id}
              onClick={() => onPage(item.page)}
            >
              <span className="role-inbox-dot" aria-hidden />
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <span className="role-inbox-cta">
                {item.cta} <ArrowRight size={13} />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
