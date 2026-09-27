"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Inbox, X } from "lucide-react";
import type { Toast, ToastKind } from "./types";

/* ==========================================================================
   Formatting
   --------------------------------------------------------------------------
   All money rendering funnels through here so the mono/tabular treatment and
   the en-PH peso format cannot drift between views.
   ========================================================================== */

const pesoFull = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesoRound = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const pesoCompact = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", notation: "compact", maximumFractionDigits: 1 });
const plainNum = new Intl.NumberFormat("en-PH");

export const money = (value: number | string) => pesoRound.format(Number(value) || 0);
export const moneyExact = (value: number | string) => pesoFull.format(Number(value) || 0);
export const shortMoney = (value: number | string) => pesoCompact.format(Number(value) || 0);
export const count = (value: number | string) => plainNum.format(Number(value) || 0);

export function formatDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value.length <= 10 ? `${value}T12:00:00` : value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatTimeOnly(value: string | Date | null) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function relativeTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

/* ==========================================================================
   Atoms
   ========================================================================== */

export function Money({ value, exact = false, tone }: { value: number | string; exact?: boolean; tone?: "net" | "deduction" }) {
  const formatted = exact ? moneyExact(value) : money(value);
  const className = tone === "net" ? "num green-number" : tone === "deduction" ? "num red-number" : "num";
  return <span className={className}>{tone === "deduction" && Number(value) > 0 ? `−${formatted}` : formatted}</span>;
}

export function Status({ value }: { value: string }) {
  const slug = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return <span className={`status status-${slug}`}>{value}</span>;
}

export function Avatar({ initials, index = 0 }: { initials: string; index?: number }) {
  return <span className={`avatar avatar-${Math.abs(index) % 5}`}>{initials}</span>;
}

export function PageHeading({
  eyebrow,
  title,
  copy,
  actions,
}: {
  eyebrow: string;
  title: string;
  copy?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {copy && <p className="heading-copy">{copy}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  icon,
  tone = "slate",
  compact = false,
  trailing,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  tone?: "mint" | "green" | "blue" | "amber" | "purple" | "red" | "slate";
  compact?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <article className={`stat-card ${compact ? "stat-compact" : ""}`}>
      <div className="stat-top">
        <span className={`stat-icon ${tone}`}>{icon}</span>
        {trailing}
      </div>
      <p>{label}</p>
      <h3>{value}</h3>
      {hint && <span>{hint}</span>}
    </article>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "on" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden />
      <span>{children}</span>
    </label>
  );
}

/* ==========================================================================
   States
   ========================================================================== */

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon ?? <Inbox size={22} className="i-amber" />}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="empty-state error" role="alert">
      <AlertTriangle size={22} className="i-red" />
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {onRetry && (
        <button type="button" className="secondary-button" onClick={onRetry} style={{ marginTop: 6 }}>
          Try again
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton" style={{ width: 28, height: 28, borderRadius: "50%" }} />
          <span className="skeleton skeleton-line" style={{ flex: 1, maxWidth: 220 }} />
          <span className="skeleton skeleton-line" style={{ width: 70 }} />
          <span className="skeleton skeleton-line" style={{ width: 70 }} />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <>
      <span className="spinner" aria-hidden />
      {label && <span className="sr-only">{label}</span>}
    </>
  );
}

/* ==========================================================================
   Toasts
   ========================================================================== */

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  function notify(message: string, kind: ToastKind = "ok") {
    if (!message) return;
    seq.current += 1;
    const id = seq.current;
    setToasts((current) => [...current, { id, kind, message }]);
  }

  function dismiss(id: number) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  return { toasts, notify, dismiss };
}

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    // Errors stay until dismissed; confirmations clear themselves.
    if (toast.kind === "err") return;
    const timer = setTimeout(() => onDismiss(toast.id), 6000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div className={`toast ${toast.kind}`}>
      {toast.kind === "err" ? <AlertTriangle size={16} className="i-red" /> : <Check size={16} className="i-green" />}
      <span>{toast.message}</span>
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
        <X size={15} />
      </button>
    </div>
  );
}

/* ==========================================================================
   Charts, hand-built SVG so no chart dependency enters the bundle.
   Every one of these renders real rows; none of them invent a series.
   ========================================================================== */

export type BarDatum = { label: string; sublabel?: string; segments: Array<{ key: string; value: number; color: string }> };

export function StackedBars({
  data,
  height = 168,
  formatValue = money,
  legend,
}: {
  data: BarDatum[];
  height?: number;
  formatValue?: (value: number) => string;
  legend?: Array<{ key: string; label: string; color: string }>;
}) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const clipId = useId();

  const totals = data.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0));
  const max = Math.max(...totals, 1);
  const width = 100;
  const slot = width / Math.max(data.length, 1);
  const barWidth = Math.min(slot * 0.56, 11);

  if (!data.length) {
    return <EmptyState title="Nothing to chart yet">This chart appears once at least one payroll run has been calculated.</EmptyState>;
  }

  return (
    <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
      {/* preserveAspectRatio="none" stretches the viewBox horizontally, so the
          height must be pinned explicitly, `height: auto` would scale it to
          1.68x the container width. */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ height, width: "100%" }}
        role="img"
        aria-label="Payroll cost by run"
      >
        <g className="chart-grid">
          {[0, 0.25, 0.5, 0.75, 1].map((step) => (
            <line key={step} x1={0} x2={width} y1={height - step * (height - 22)} y2={height - step * (height - 22)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={width} height={height} />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          {data.map((row, index) => {
            const x = index * slot + (slot - barWidth) / 2;
            let cursor = height - 22;
            return (
              <g
                key={`${row.label}-${index}`}
                className="chart-bar"
                onMouseEnter={() => setHover({ index, x: ((index + 0.5) / data.length) * 100, y: height - 22 - (totals[index] / max) * (height - 34) })}
                onFocus={() => setHover({ index, x: ((index + 0.5) / data.length) * 100, y: height - 22 - (totals[index] / max) * (height - 34) })}
                tabIndex={0}
                role="listitem"
                aria-label={`${row.label}: ${formatValue(totals[index])}`}
              >
                {row.segments.map((segment) => {
                  const barHeight = (segment.value / max) * (height - 34);
                  cursor -= barHeight;
                  return <rect key={segment.key} x={x} y={cursor} width={barWidth} height={Math.max(barHeight, 0)} fill={segment.color} />;
                })}
              </g>
            );
          })}
        </g>
      </svg>
      {/* Axis labels sit outside the SVG. preserveAspectRatio="none" stretches
          the viewBox horizontally to fill the card, which distorts glyphs along
          with the bars, so the labels are laid out as HTML over the empty band
          the bars already reserve at the bottom. */}
      <div className="chart-axis-row" aria-hidden>
        {data.map((row, index) => (
          <span key={`label-${index}`}>{row.label}</span>
        ))}
      </div>
      {hover && (
        <div className="chart-tip" style={{ left: `${hover.x}%`, top: hover.y }}>
          <strong>{formatValue(totals[hover.index])}</strong>
          <em>{data[hover.index].sublabel ?? data[hover.index].label}</em>
        </div>
      )}
      {legend && (
        <div className="chart-legend">
          {legend.map((item) => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, color = "var(--brand)" }: { values: number[]; color?: string }) {
  const path = useMemo(() => {
    if (values.length < 2) return "";
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 26 - ((value - min) / span) * 22;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [values]);

  if (!path) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const lastY = 26 - ((values[values.length - 1] - min) / span) * 22;

  return (
    <svg className="sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={100} cy={lastY} r={2.4} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type BatterySlice = { key: "ok" | "review" | "blocked" | "pending"; label: string; value: number };

export function Battery({ slices }: { slices: BatterySlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const colors: Record<BatterySlice["key"], string> = {
    ok: "var(--success-bright)",
    review: "var(--review-bright)",
    blocked: "var(--danger-bright)",
    pending: "var(--line-strong)",
  };
  return (
    <div>
      <div className="battery" role="img" aria-label={slices.map((slice) => `${slice.value} ${slice.label}`).join(", ")}>
        {total === 0 ? (
          <span className="pending" style={{ width: "100%" }} />
        ) : (
          slices
            .filter((slice) => slice.value > 0)
            .map((slice) => <span key={slice.key} className={slice.key} style={{ width: `${(slice.value / total) * 100}%` }} />)
        )}
      </div>
      <div className="battery-legend">
        {slices.map((slice) => (
          <span key={slice.key}>
            <i style={{ background: colors[slice.key] }} />
            <b>{slice.value}</b> {slice.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Progress({ percent, tone }: { percent: number; tone?: "amber" | "blue" | "purple" | "red" }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <span className={tone ?? ""} style={{ width: `${clamped}%` }} />
    </div>
  );
}
