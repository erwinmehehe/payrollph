import type { MouseEventHandler } from "react";

export type PayrollOwlState =
  | "welcome"
  | "review"
  | "attention"
  | "compliance"
  | "approved"
  | "released"
  | "help";

export type PayrollOwlRole = "owner" | "hr" | "payroll" | "checker";

export function PayrollOwl({
  state = "welcome",
  className = "",
  label,
}: {
  state?: "welcome" | "review" | "attention" | "compliance" | "approved" | "released" | "help";
  className?: string;
  label?: string;
}) {
  const showClipboard = state === "review" || state === "attention" || state === "compliance";
  const showCheck = state === "approved" || state === "released";
  const showHeadset = state === "help";

  return (
    <svg
      viewBox="0 0 220 220"
      className={className}
      data-owl-state={state}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id="owl-body" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#B87343" />
          <stop offset="1" stopColor="#7D4529" />
        </linearGradient>
        <linearGradient id="owl-jacket" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#173B67" />
          <stop offset="1" stopColor="#0B2342" />
        </linearGradient>
        <filter id="owl-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#0B2342" floodOpacity=".14" />
        </filter>
      </defs>

      <g filter="url(#owl-shadow)">
        <ellipse cx="110" cy="190" rx="58" ry="9" fill="#DCE6F2" opacity=".75" />
        <path d="M63 75 49 38l31 19c10-10 49-10 60 0l31-19-14 37c11 15 16 33 16 52 0 45-27 73-63 73s-63-28-63-73c0-19 5-37 16-52Z" fill="url(#owl-body)" />
        <path d="M69 86c0-23 18-41 41-41s41 18 41 41c0 24-17 41-41 41S69 110 69 86Z" fill="#F6E2C9" />
        <ellipse cx="87" cy="86" rx="28" ry="31" fill="#FFF9F0" />
        <ellipse cx="133" cy="86" rx="28" ry="31" fill="#FFF9F0" />
        <circle cx="88" cy="89" r="15" fill="#1F2A37" />
        <circle cx="132" cy="89" r="15" fill="#1F2A37" />
        <circle cx="83" cy="84" r="5" fill="#FFFFFF" />
        <circle cx="127" cy="84" r="5" fill="#FFFFFF" />
        <path d="m110 99-10 10 10 8 10-8-10-10Z" fill="#F3A93B" />
        <path d="M90 115c6 7 13 10 20 10s14-3 20-10" fill="none" stroke="#7D4529" strokeWidth="4" strokeLinecap="round" />
        <g fill="none" stroke="#15243A" strokeWidth="5">
          <circle cx="87" cy="87" r="24" />
          <circle cx="133" cy="87" r="24" />
          <path d="M111 83h-2" />
          <path d="M62 78 51 72M158 78l11-6" />
        </g>

        <path d="M63 139c9-17 26-26 47-26 22 0 39 9 48 26l5 46H57l6-46Z" fill="url(#owl-jacket)" />
        <path d="m94 116 16 15 16-15 10 11-14 13H98l-14-13 10-11Z" fill="#FFFFFF" />
        <path d="m110 130-8 10 8 33 8-33-8-10Z" fill="#11A9A3" />
        <path d="M58 147c-13 4-21 13-21 24 0 9 7 17 16 17 12 0 21-11 25-25l-20-16ZM162 147c13 4 21 13 21 24 0 9-7 17-16 17-12 0-21-11-25-25l20-16Z" fill="#8F522F" />
        <path d="M78 184c2 9 10 15 21 15M142 184c-2 9-10 15-21 15" fill="none" stroke="#F0A53A" strokeWidth="7" strokeLinecap="round" />
      </g>

      {showClipboard && (
        <g transform="translate(128 126)">
          <rect x="0" y="0" width="61" height="72" rx="9" fill="#FFFFFF" stroke="#C9D8E8" strokeWidth="3" />
          <rect x="18" y="-5" width="25" height="11" rx="5" fill="#183B66" />
          {[18, 32, 46].map((y, index) => (
            <g key={y}>
              <rect x="10" y={y} width="10" height="10" rx="3" fill={state === "attention" && index === 0 ? "#F04438" : "#10B981"} />
              <path d={`M12 ${y + 5}l2 2 4-5`} fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="26" y={y + 2} width={index === 1 ? 23 : 27} height="5" rx="2.5" fill="#DDE6F0" />
            </g>
          ))}
        </g>
      )}

      {showCheck && (
        <g transform="translate(146 135)">
          <circle cx="24" cy="24" r="24" fill="#10B981" />
          <path d="m12 24 8 8 16-19" fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          {state === "released" && (
            <>
              <path d="M-2-5 4-16M16-8l2-14M43-2l10-10" stroke="#14B8A6" strokeWidth="4" strokeLinecap="round" />
              <circle cx="54" cy="8" r="4" fill="#F59E0B" />
            </>
          )}
        </g>
      )}

      {showHeadset && (
        <g fill="none" stroke="#183B66" strokeWidth="6" strokeLinecap="round">
          <path d="M57 91c0-35 21-59 53-59s53 24 53 59" />
          <path d="M58 91v27M162 91v27" />
          <path d="M162 115c0 18-11 27-29 27" />
        </g>
      )}
    </svg>
  );
}

export function PayrollGuide({
  role,
  state,
  eyebrow = "Payroll Guide",
  title,
  detail,
  actionLabel,
  onAction,
}: {
  role: PayrollOwlRole;
  state: PayrollOwlState;
  eyebrow?: string;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <section className="payroll-guide" data-payroll-guide-role={role}>
      <div className="payroll-guide-owl" aria-hidden>
        <PayrollOwl state={state} />
      </div>
      <div className="payroll-guide-copy">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {actionLabel && onAction ? (
        <button type="button" className="payroll-guide-action" onClick={onAction}>
          {actionLabel}
          <span aria-hidden>→</span>
        </button>
      ) : null}
    </section>
  );
}
