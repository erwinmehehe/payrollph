import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, ClipboardCheck, Download, FileText,
  Lock, RotateCcw, Send, ShieldAlert, Wallet, Wrench, Undo2,
} from "lucide-react";
import { Reveal, SectionHeading } from "./ui";
import { cn } from "../utils/cn";
import { compute, fmt } from "../lib/rules";

/* ---------------- data ---------------- */
type Role = "payroll" | "checker" | "owner";
type Stage = "prepare" | "approval" | "approved" | "released";
type Page = "payroll" | "approvals" | "exports";
type Target = "bdo" | "gcash" | "xero";

const roles: Record<Role, { label: string; name: string; ini: string; c: string }> = {
  payroll: { label: "Payroll officer", name: "Celine Ramos", ini: "CR", c: "#6161FF" },
  checker: { label: "Checker", name: "Rico Mendoza", ini: "RM", c: "#FF7A29" },
  owner: { label: "Owner", name: "Camille Yao", ini: "CY", c: "#00CA72" },
};

const staff = [
  { id: 1, name: "Aira Villanueva", no: "EMP-0012", monthly: 42000, ot: 8.5, holiday: false, broken: false, c: "#6161FF" },
  { id: 2, name: "Trish Dela Cruz", no: "EMP-0007", monthly: 28000, ot: 0, holiday: false, broken: true, c: "#FF5C7A" },
  { id: 3, name: "Rico Mendoza", no: "EMP-0019", monthly: 35000, ot: 0, holiday: false, broken: false, c: "#FF7A29" },
  { id: 4, name: "Miguel Santos", no: "EMP-0003", monthly: 21000, ot: 0, holiday: true, broken: false, c: "#00A6B8" },
  { id: 5, name: "Camille Yao", no: "EMP-0001", monthly: 65000, ot: 0, holiday: false, broken: false, c: "#00CA72" },
  { id: 6, name: "Dodong Reyes", no: "EMP-0024", monthly: 18000, ot: 2, holiday: false, broken: false, c: "#7C5CFF" },
];

function calc(e: (typeof staff)[number], broken: boolean) {
  const daily = (e.monthly * 12) / 261;
  const hourly = daily / 8;
  const basic = e.monthly / 2;
  const ot = e.ot * hourly * 1.25;
  const hol = e.holiday ? daily * 0.3 : 0;
  const lost = broken ? daily : 0;
  const gross = basic + ot + hol - lost;
  const c = compute(e.monthly);
  const d = { sss: c.sss / 2, ph: c.ph / 2, hdmf: c.hdmf / 2, tax: c.wtax / 2 };
  const ded = d.sss + d.ph + d.hdmf + d.tax;
  return { basic, ot, hol, lost, gross, d, ded, net: Math.max(0, gross - ded) };
}

const STAGE_IDX: Record<Stage, number> = { prepare: 0, approval: 1, approved: 2, released: 3 };
const STAGE_ROLE: Record<Stage, Role> = { prepare: "payroll", approval: "checker", approved: "owner", released: "owner" };
const STEPS = ["Prepare", "Approve", "Release", "Export"];

type Log = { t: string; who: string; text: string; tone: "ok" | "err" | "info" };

/* ---------------- tiny helpers ---------------- */
function Num({ v }: { v: number }) {
  const [d, setD] = useState(v);
  const from = useRef(v);
  useEffect(() => {
    const s = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 550);
      const cur = s + (v - s) * (1 - Math.pow(1 - p, 3));
      from.current = cur;
      setD(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return <>{fmt(d)}</>;
}

function Chip({ children, tone }: { children: ReactNode; tone: "green" | "blue" | "amber" | "red" | "purple" | "slate" }) {
  const m = {
    green: "bg-[#E3FAF0] text-[#0A8A53]",
    blue: "bg-[#ECECFF] text-[#4A4AE0]",
    amber: "bg-[#FFF4D6] text-[#9A6B00]",
    red: "bg-[#FFE8EC] text-[#D12D4B]",
    purple: "bg-[#F1EDFF] text-[#6D4DE0]",
    slate: "bg-[#F1F2F8] text-[#5B6080]",
  }[tone];
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold", m)}>{children}</span>;
}

/* ---------------- component ---------------- */
export default function Demo() {
  const [role, setRole] = useState<Role>("payroll");
  const [page, setPage] = useState<Page>("payroll");
  const [stage, setStage] = useState<Stage>("prepare");
  const [fixed, setFixed] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(2);
  const [log, setLog] = useState<Log[]>([
    { t: "09:14:02", who: "System", text: "Run created · Mar 1–15, 2026 · 6 employees", tone: "info" },
    { t: "09:14:05", who: "Engine", text: "Calculated 6 entries · 1 exception: INCOMPLETE_PUNCH", tone: "info" },
  ]);
  const [toast, setToast] = useState<{ tone: "ok" | "err" | "info"; text: string; k: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [acked, setAcked] = useState(false);
  const [target, setTarget] = useState<Target>("bdo");
  const [dry, setDry] = useState<"idle" | "running" | "ok">("idle");
  const [file, setFile] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const clock = useRef(9 * 3600 + 14 * 60 + 5);
  const tt = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useMemo(() => staff.map((e) => ({ e, r: calc(e, e.broken && !fixed.includes(e.id)), broken: e.broken && !fixed.includes(e.id) })), [fixed]);
  const totals = useMemo(() => rows.reduce((a, x) => ({ gross: a.gross + x.r.gross, ded: a.ded + x.r.ded, net: a.net + x.r.net }), { gross: 0, ded: 0, net: 0 }), [rows]);
  const exceptions = rows.filter((x) => x.broken).length;

  const flash = (tone: "ok" | "err" | "info", text: string) => {
    setToast({ tone, text, k: Date.now() });
    if (tt.current) clearTimeout(tt.current);
    tt.current = setTimeout(() => setToast(null), 4200);
  };
  const push = (who: string, text: string, tone: Log["tone"] = "ok") => {
    clock.current += 9 + Math.floor(Math.random() * 40);
    const s = clock.current;
    const t = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
    setLog((l) => [{ t, who, text, tone }, ...l]);
  };
  const deny = (code: number, text: string, action: string) => {
    flash("err", `${code} · ${text}`);
    push(`${roles[role].name}`, `${action} refused (${code})`, "err");
  };

  /* ---- actions ---- */
  const fix = (id: number) => {
    if (role !== "payroll") return deny(403, "Only a payroll officer can edit punches.", "Punch edit");
    setFixed((f) => [...f, id]);
    setOpen(null);
    push(roles.payroll.name, "Corrected punch for Trish Dela Cruz · recalculated");
    if (stage === "approval" || stage === "approved") {
      setStage("prepare");
      flash("info", "Recalculated. The earlier approval is now stale and was reset.");
      push("Engine", "Approval invalidated after recalculation", "info");
    } else flash("ok", "Punch corrected. Totals recalculated.");
  };
  const submit = () => {
    if (role !== "payroll") return deny(403, "Only the payroll officer prepares and submits a run.", "Submit");
    setStage("approval");
    push(roles.payroll.name, `Submitted for approval${exceptions ? ` with ${exceptions} open exception` : ""}`);
    flash("ok", "Submitted. Waiting on the checker.");
  };
  const approve = () => {
    if (role === "payroll") return deny(403, "Maker cannot approve their own run.", "Approve");
    if (role === "owner") return deny(403, "Only the checker or a delegate can approve.", "Approve");
    setStage("approved");
    push(roles.checker.name, "Approved run");
    flash("ok", "Approved. Release is now available to the owner.");
  };
  const sendBack = () => {
    if (role !== "checker") return deny(403, "Only the checker can send a run back.", "Send back");
    setStage("prepare");
    push(roles.checker.name, "Sent back for changes", "info");
    flash("info", "Sent back to the payroll officer.");
  };
  const doRelease = () => {
    setStage("released");
    setConfirm(false);
    setAcked(exceptions > 0);
    push(roles.owner.name, exceptions ? `Released with ${exceptions} acknowledged exception` : "Released run");
    push("System", "Generated 6 payslip PDFs · queued 6 payslip-ready emails", "info");
    flash("ok", "Released. Payslips generated and emails queued.");
  };
  const release = () => {
    if (role !== "owner") return deny(403, "Release requires owner or admin.", "Release");
    if (exceptions > 0 && !acked) {
      setAck(false);
      setConfirm(true);
      return;
    }
    doRelease();
  };
  const primary = {
    prepare: { label: "Submit for approval", icon: Send, run: submit },
    approval: { label: "Approve run", icon: CheckCircle2, run: approve },
    approved: { label: "Release payroll", icon: Lock, run: release },
    released: { label: "Open exports", icon: Download, run: () => setPage("exports") },
  }[stage];

  const hint = (() => {
    if (stage === "prepare")
      return { r: "payroll" as Role, t: exceptions ? "Trish has an incomplete punch, so the engine derived zero hours for that day. Fix it, or submit as is and see what release asks for." : "No exceptions left. Submit the run for approval." };
    if (stage === "approval") return { r: "checker" as Role, t: "Submitted. Try approving as the Payroll officer first: the server refuses. Then switch to the checker." };
    if (stage === "approved") return { r: "owner" as Role, t: "Approved. Only the owner can release. Try it as the checker to see the 403." };
    return { r: "owner" as Role, t: exported ? "That is the whole run. Every step is in the audit trail." : "Released and payslips queued. Open Exports to validate and generate a bank file." };
  })();

  /* ---- exports ---- */
  const pickTarget = (t: Target) => { setTarget(t); setDry("idle"); setFile(null); };
  const runDry = () => {
    if (role === "checker") return deny(403, "Checkers cannot export bank files.", "Dry-run");
    setDry("running");
    setTimeout(() => { setDry("ok"); push(roles[role].name, `Dry-run validated · ${{ bdo: "BDO DAT", gcash: "GCash CSV", xero: "Xero journal" }[target]}`, "info"); }, 900);
  };
  const generate = () => {
    if (role === "checker") return deny(403, "Checkers cannot export bank files.", "Export");
    const pad = (n: number) => String(Math.round(n * 100)).padStart(9, "0");
    let out = "";
    if (target === "bdo") {
      out = [`H|LINAW|20260320|${rows.length}|${pad(totals.net)}`, ...rows.map((x) => `D|${x.e.no}|${x.e.name.toUpperCase()}|0012-3456-78${10 + x.e.id}|${pad(x.r.net)}`), `T|${rows.length}|${pad(totals.net)}`].join("\n");
    } else if (target === "gcash") {
      out = ["mobile,name,amount,reference", ...rows.map((x, i) => `0917${1234500 + i},${x.e.name},${x.r.net.toFixed(2)},PAY-2026-03A-${x.e.no}`)].join("\n");
    } else {
      const s = rows.reduce((a, x) => ({ sss: a.sss + x.r.d.sss, ph: a.ph + x.r.d.ph, hd: a.hd + x.r.d.hdmf, tx: a.tx + x.r.d.tax }), { sss: 0, ph: 0, hd: 0, tx: 0 });
      out = ["*Narration,*Date,*AccountCode,Debit,Credit",
        `Payroll Mar 1-15,2026-03-20,6100 Salaries,${totals.gross.toFixed(2)},`,
        `Payroll Mar 1-15,2026-03-20,2210 SSS Payable,,${s.sss.toFixed(2)}`,
        `Payroll Mar 1-15,2026-03-20,2220 PhilHealth Payable,,${s.ph.toFixed(2)}`,
        `Payroll Mar 1-15,2026-03-20,2230 Pag-IBIG Payable,,${s.hd.toFixed(2)}`,
        `Payroll Mar 1-15,2026-03-20,2240 Withholding Tax,,${s.tx.toFixed(2)}`,
        `Payroll Mar 1-15,2026-03-20,1010 Bank,,${totals.net.toFixed(2)}`].join("\n");
    }
    setFile(out);
    setExported(true);
    push(roles[role].name, `Generated ${{ bdo: "BDO DAT", gcash: "GCash CSV", xero: "Xero journal" }[target]} · export logged`);
    flash("ok", "File generated. Export recorded in the audit trail.");
  };

  const reset = () => {
    setRole("payroll"); setPage("payroll"); setStage("prepare"); setFixed([]); setOpen(2); setConfirm(false); setAck(false); setAcked(false);
    setTarget("bdo"); setDry("idle"); setFile(null); setExported(false); setToast(null);
    setLog([{ t: "09:14:02", who: "System", text: "Run created · Mar 1–15, 2026 · 6 employees", tone: "info" }, { t: "09:14:05", who: "Engine", text: "Calculated 6 entries · 1 exception: INCOMPLETE_PUNCH", tone: "info" }]);
    clock.current = 9 * 3600 + 14 * 60 + 5;
  };

  const stageChip = {
    prepare: <Chip tone="blue">Draft</Chip>,
    approval: <Chip tone="amber"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#E8A800]" />Awaiting checker</Chip>,
    approved: <Chip tone="amber">Approved · not released</Chip>,
    released: <Chip tone="green"><Check className="h-3 w-3" strokeWidth={3} />Released</Chip>,
  }[stage];

  const nav: { id: Page; label: string; icon: typeof Wallet; badge?: string }[] = [
    { id: "payroll", label: "Payroll", icon: Wallet, badge: exceptions ? String(exceptions) : undefined },
    { id: "approvals", label: "Approvals", icon: ClipboardCheck },
    { id: "exports", label: "Exports", icon: Download },
  ];

  return (
    <section id="demo" className="scroll-mt-20 bg-[#F7F8FC] py-20 sm:py-28">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <SectionHeading title={<>Run payroll. <span className="text-[#6161FF]">Try to break it.</span></>} />
          <Reveal delay={120}>
            <p className="max-w-[400px] text-[15.5px] leading-relaxed text-[#5B6080]">
              A playable simulation on the real statutory math. Fix an exception, get it approved, release and export. Switch roles and the server rules push back. Nothing is saved.
            </p>
          </Reveal>
        </div>

        <Reveal delay={150}>
          <div className="relative mt-10 overflow-hidden rounded-[26px] border border-[#E2E4F0] bg-white shadow-[0_2px_6px_rgba(16,18,38,.05),0_40px_90px_-34px_rgba(70,70,190,.35)]">
            <div className="flex items-center gap-3 border-b border-[#EDEFF7] bg-[#FAFBFD] px-4 py-2.5">
              <div className="flex gap-1.5" aria-hidden><span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" /></div>
              <span className="mono hidden rounded-lg border border-[#E8EAF3] bg-white px-3 py-1 text-[11.5px] text-[#7C82A1] sm:block">linaw.ph/{page}</span>
              <Chip tone="purple">Simulation · saves nothing</Chip>
              <button onClick={reset} className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-[#5B6080] transition-colors hover:bg-[#F1F2F8]">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-[#EDEFF7] px-4 py-3">
              <span className="text-[12.5px] font-bold text-[#7C82A1]">Acting as</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Acting as">
                {(Object.keys(roles) as Role[]).map((k) => (
                  <button key={k} role="radio" aria-checked={role === k} onClick={() => setRole(k)}
                    className={cn("flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-[13px] font-bold transition-all",
                      role === k ? "border-[#11141F] bg-[#11141F] text-white shadow-md" : "border-[#E2E4F0] bg-white text-[#2B2F45] hover:border-[#B9BDE0]")}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: roles[k].c }}>{roles[k].ini}</span>
                    {roles[k].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid lg:grid-cols-[190px_1fr]">
              <aside className="hidden border-r border-[#EDEFF7] bg-[#FAFBFD] p-3 lg:block">
                <ul className="space-y-1">
                  {nav.map((n) => (
                    <li key={n.id}>
                      <button onClick={() => setPage(n.id)} aria-current={page === n.id}
                        className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] transition-all", page === n.id ? "bg-white font-bold shadow-sm ring-1 ring-[#E2E4F0]" : "font-medium text-[#5B6080] hover:bg-white/70")}>
                        <n.icon className={cn("h-4 w-4", page === n.id ? "text-[#6161FF]" : "text-[#9AA0BB]")} aria-hidden />
                        {n.label}
                        {n.badge && <span className="ml-auto rounded-full bg-[#FF5C7A] px-1.5 text-[10px] font-extrabold text-white">{n.badge}</span>}
                        {n.id === "exports" && stage !== "released" && <Lock className="ml-auto h-3.5 w-3.5 text-[#B9BDD6]" aria-hidden />}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 px-3 text-[11.5px] leading-snug text-[#9AA0BB]">People, Time, Leave and Reports live in the full workspace.</p>
              </aside>

              <div className="min-w-0 p-4 sm:p-6">
                <div className="mb-4 flex gap-1.5 lg:hidden">
                  {nav.map((n) => (
                    <button key={n.id} onClick={() => setPage(n.id)} className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold", page === n.id ? "bg-[#ECECFF] text-[#4A4AE0]" : "bg-[#F4F5FA] text-[#5B6080]")}>
                      <n.icon className="h-3.5 w-3.5" aria-hidden />{n.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[12.5px] font-semibold text-[#9AA0BB]">Masigla Foods · Semi-monthly</p>
                    <h3 className="font-display text-[24px] font-extrabold sm:text-[28px]">Mar 1–15, 2026</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {exceptions > 0 && <Chip tone="red"><AlertTriangle className="h-3 w-3" />{exceptions} exception</Chip>}
                    {stageChip}
                  </div>
                </div>

                <ol className="mt-4 grid grid-cols-4 gap-1.5 sm:gap-2" aria-label="Payroll stages">
                  {STEPS.map((s, i) => {
                    const cur = STAGE_IDX[stage];
                    const done = i < cur || (i === 3 && exported);
                    const now = i === cur && !done;
                    return (
                      <li key={s} className={cn("relative overflow-hidden rounded-xl border px-2.5 py-2 transition-all duration-500 sm:px-3",
                        done ? "border-[#BFF0D9] bg-[#E3FAF0]" : now ? "border-[#6161FF]/40 bg-[#ECECFF]" : "border-[#EDEFF7] bg-[#FAFBFD]")}>
                        <div className="flex items-center gap-1.5">
                          {done ? <CheckCircle2 key="d" className="stamp h-4 w-4 text-[#0A8A53]" aria-hidden /> : now ? <span className="h-2 w-2 animate-pulse rounded-full bg-[#6161FF]" aria-hidden /> : <Lock className="h-3.5 w-3.5 text-[#B9BDD6]" aria-hidden />}
                          <span className={cn("text-[12px] font-extrabold sm:text-[13px]", done ? "text-[#0A8A53]" : now ? "text-[#4A4AE0]" : "text-[#9AA0BB]")}>{s}</span>
                        </div>
                        <p className="mt-0.5 hidden text-[11px] text-[#7C82A1] sm:block">{["Payroll officer", "Checker", "Owner", "Owner / Payroll"][i]}</p>
                      </li>
                    );
                  })}
                </ol>

                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[#D9D9FF] bg-gradient-to-r from-[#F4F4FF] to-white px-4 py-3" aria-live="polite">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6161FF] text-[11px] font-extrabold text-white">→</span>
                  <p className="min-w-[200px] flex-1 text-[13.5px] font-medium leading-snug text-[#2B2F45]">{hint.t}</p>
                  {role !== hint.r && (
                    <button onClick={() => setRole(hint.r)} className="inline-flex items-center gap-1.5 rounded-full bg-[#6161FF] px-3.5 py-1.5 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]">
                      Switch to {roles[hint.r].label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>

                {page === "payroll" && (
                  <div className="pop-in">
                    <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                      {[["Gross", totals.gross, "#6161FF"], ["Deductions", totals.ded, "#FF7A29"], ["Net", totals.net, "#00CA72"]].map(([l, v, c]) => (
                        <div key={l as string} className="rounded-2xl border border-[#E8EAF3] p-3 sm:p-4">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#9AA0BB]">{l as string}</p>
                          <p className="mono mt-1 truncate text-[14px] font-bold sm:text-[20px]">₱<Num v={v as number} /></p>
                          <div className="mt-2 h-1 rounded-full" style={{ background: c as string }} />
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 overflow-hidden rounded-2xl border border-[#E8EAF3]">
                      <div className="hidden grid-cols-[1.7fr_1fr_1fr_1fr_24px] gap-3 bg-[#FAFBFD] px-4 py-2.5 text-[10.5px] font-extrabold uppercase tracking-wider text-[#9AA0BB] sm:grid">
                        <span>Register</span><span className="text-right">Gross</span><span className="text-right">Deductions</span><span className="text-right">Net</span><span />
                      </div>
                      <ul className="divide-y divide-[#F1F2F8]">
                        {rows.map(({ e, r, broken }) => {
                          const isOpen = open === e.id;
                          return (
                            <li key={e.id} className={cn(broken && "bg-[#FFFAFB]")}>
                              <button onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}
                                className="grid w-full grid-cols-[1fr_auto_20px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#FAFBFD] sm:grid-cols-[1.7fr_1fr_1fr_1fr_24px]">
                                <span className="flex min-w-0 items-center gap-3">
                                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ background: e.c }}>{e.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
                                  <span className="min-w-0">
                                    <span className="block truncate text-[13.5px] font-bold">{e.name}</span>
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                      <span className="mono text-[11px] text-[#9AA0BB]">{e.no}</span>
                                      {broken && <span className="mono rounded bg-[#FFE8EC] px-1.5 text-[10px] font-semibold text-[#D12D4B]">INCOMPLETE_PUNCH</span>}
                                      {e.holiday && <span className="mono rounded bg-[#F1EDFF] px-1.5 text-[10px] font-semibold text-[#6D4DE0]">HOLIDAY 1.3×</span>}
                                      {e.ot > 0 && <span className="mono rounded bg-[#ECECFF] px-1.5 text-[10px] font-semibold text-[#4A4AE0]">OT {e.ot}h</span>}
                                      {e.broken && !broken && <span className="mono rounded bg-[#E3FAF0] px-1.5 text-[10px] font-semibold text-[#0A8A53]">FIXED</span>}
                                    </span>
                                  </span>
                                </span>
                                <span className="mono hidden text-right text-[13px] sm:block">{fmt(r.gross)}</span>
                                <span className="mono hidden text-right text-[13px] text-[#7C82A1] sm:block">{fmt(r.ded)}</span>
                                <span className="mono text-right text-[13.5px] font-bold">{fmt(r.net)}</span>
                                <ChevronDown className={cn("h-4 w-4 text-[#9AA0BB] transition-transform", isOpen && "rotate-180")} aria-hidden />
                              </button>
                              {isOpen && (
                                <div className="pop-in border-t border-[#F1F2F8] bg-[#FAFBFD] px-4 py-4">
                                  {broken && (
                                    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#FFD5DC] bg-white p-3">
                                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FFE8EC]"><Wrench className="h-4 w-4 text-[#D12D4B]" aria-hidden /></span>
                                      <div className="min-w-[180px] flex-1">
                                        <p className="text-[13px] font-bold">Mar 6 · clock-in 08:02 · no clock-out</p>
                                        <p className="text-[12px] text-[#7C82A1]">Engine derived 0 hours and deducted 1 day. Correct it from the timesheet.</p>
                                      </div>
                                      <button onClick={() => fix(e.id)} className="rounded-full bg-[#11141F] px-4 py-2 text-[12.5px] font-bold text-white transition-transform hover:scale-[1.03]">Set clock-out 17:05</button>
                                    </div>
                                  )}
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <dl className="space-y-1.5 text-[13px]">
                                      <dt className="text-[11px] font-extrabold uppercase tracking-wider text-[#9AA0BB]">Earnings</dt>
                                      <div className="flex justify-between"><dd className="text-[#5B6080]">Basic (semi-monthly)</dd><dd className="mono">{fmt(r.basic)}</dd></div>
                                      {e.ot > 0 && <div className="flex justify-between"><dd className="text-[#5B6080]">Overtime 1.25× · {e.ot}h</dd><dd className="mono">{fmt(r.ot)}</dd></div>}
                                      {e.holiday && <div className="flex justify-between"><dd className="text-[#5B6080]">Holiday premium</dd><dd className="mono">{fmt(r.hol)}</dd></div>}
                                      {broken && <div className="flex justify-between"><dd className="text-[#D12D4B]">Incomplete punch (−1 day)</dd><dd className="mono text-[#D12D4B]">−{fmt(r.lost)}</dd></div>}
                                    </dl>
                                    <dl className="space-y-1.5 text-[13px]">
                                      <dt className="text-[11px] font-extrabold uppercase tracking-wider text-[#9AA0BB]">Deductions</dt>
                                      {([["SSS", r.d.sss, "RA 11199"], ["PhilHealth", r.d.ph, "RA 11223"], ["Pag-IBIG", r.d.hdmf, "RA 9679"], ["Withholding", r.d.tax, "RA 10963"]] as [string, number, string][]).map(([n, v, ra]) => (
                                        <div key={n} className="flex justify-between"><dd className="text-[#5B6080]">{n} <span className="mono text-[10.5px] text-[#B0B5CC]">{ra}</span></dd><dd className="mono">−{fmt(v)}</dd></div>
                                      ))}
                                    </dl>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#11141F] p-3 pl-4 text-white">
                      <p className="text-[13px] text-white/70">
                        Next up: <span className="font-bold text-white">{roles[STAGE_ROLE[stage]].label}</span>
                        {role !== STAGE_ROLE[stage] && <span className="ml-2 text-[#FFD666]">· you are acting as {roles[role].label}</span>}
                      </p>
                      <div className="flex gap-2">
                        {stage === "approval" && (
                          <button onClick={sendBack} className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2.5 text-[13px] font-bold transition-colors hover:bg-white/10"><Undo2 className="h-4 w-4" aria-hidden />Send back</button>
                        )}
                        <button onClick={primary.run} className="btn-primary inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13.5px] font-bold text-[#11141F]">
                          <primary.icon className="h-4 w-4" aria-hidden />{primary.label}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {page === "approvals" && (
                  <div className="pop-in mt-4 grid gap-4 xl:grid-cols-[1fr_1.1fr]">
                    <div className="space-y-2.5">
                      {([
                        ["payroll", "Prepare and submit", stage !== "prepare"],
                        ["checker", "Review and approve", stage === "approved" || stage === "released"],
                        ["owner", "Release payroll", stage === "released"],
                      ] as [Role, string, boolean][]).map(([k, t, done], i) => (
                        <div key={k} className={cn("flex items-center gap-3 rounded-2xl border p-4 transition-all", done ? "border-[#BFF0D9] bg-[#F4FDF9]" : "border-[#E8EAF3] bg-white")}>
                          <span className="flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-extrabold text-white" style={{ background: roles[k].c }}>{roles[k].ini}</span>
                          <div className="flex-1">
                            <p className="text-[14px] font-bold">{i + 1}. {t}</p>
                            <p className="text-[12.5px] text-[#7C82A1]">{roles[k].name} · {roles[k].label}</p>
                          </div>
                          {done ? <Chip tone="green"><Check className="h-3 w-3" strokeWidth={3} />Done</Chip> : <Chip tone="slate">Pending</Chip>}
                        </div>
                      ))}
                      <div className="rounded-2xl border border-dashed border-[#D9DCEC] p-4 text-[12.5px] leading-relaxed text-[#7C82A1]">
                        <ShieldAlert className="mb-1 inline h-4 w-4 text-[#7C5CFF]" aria-hidden /> A decision from outside the approver or delegate chain returns <span className="mono font-semibold text-[#D12D4B]">403</span>. Delegates are recorded as <span className="mono">decidedBy</span> + <span className="mono">decidedOnBehalfOf</span>.
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#E8EAF3]">
                      <p className="border-b border-[#F1F2F8] bg-[#FAFBFD] px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-[#9AA0BB]">Audit trail · {log.length} events</p>
                      <ul className="max-h-[360px] divide-y divide-[#F1F2F8] overflow-y-auto">
                        {log.map((l, i) => (
                          <li key={`${l.t}-${i}`} className="pop-in flex gap-3 px-4 py-2.5 text-[12.5px]">
                            <span className="mono shrink-0 text-[#9AA0BB]">{l.t}</span>
                            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", l.tone === "ok" ? "bg-[#00CA72]" : l.tone === "err" ? "bg-[#FF5C7A]" : "bg-[#579BFC]")} aria-hidden />
                            <span><span className="font-bold">{l.who}</span> <span className="text-[#5B6080]">{l.text}</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {page === "exports" && (
                  <div className="pop-in mt-4">
                    {stage !== "released" ? (
                      <div className="flex flex-col items-center rounded-2xl border border-dashed border-[#D9DCEC] bg-[#FAFBFD] px-6 py-14 text-center">
                        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[#E2E4F0]"><Lock className="h-6 w-6 text-[#9AA0BB]" aria-hidden /></span>
                        <p className="font-display mt-4 text-[20px] font-extrabold">Exports are locked until release</p>
                        <p className="mt-1 max-w-[380px] text-[14px] text-[#5B6080]">Bank files stay locked so no one can pay out a run that has not been prepared, approved and released.</p>
                        <button onClick={() => setPage("payroll")} className="mt-5 rounded-full bg-[#11141F] px-5 py-2.5 text-[13.5px] font-bold text-white">Back to the run</button>
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {([["bdo", "BDO DAT", "Bank disbursement", Wallet], ["gcash", "GCash CSV", "Wallet disbursement", Send], ["xero", "Xero journal", "Accounting", FileText]] as [Target, string, string, typeof Wallet][]).map(([k, t, s, Ic]) => (
                            <button key={k} onClick={() => pickTarget(k)} aria-pressed={target === k}
                              className={cn("flex items-center gap-3 rounded-2xl border p-4 text-left transition-all", target === k ? "border-[#6161FF] bg-[#F4F4FF] shadow-[0_10px_24px_-14px_rgba(97,97,255,.6)]" : "border-[#E8EAF3] hover:border-[#B9BDE0]")}>
                              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-[#E2E4F0]"><Ic className="h-5 w-5 text-[#4A4AE0]" aria-hidden /></span>
                              <span><span className="block text-[14px] font-bold">{t}</span><span className="block text-[12px] text-[#7C82A1]">{s}</span></span>
                            </button>
                          ))}
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-[320px_1fr]">
                          <div className="rounded-2xl border border-[#E8EAF3] p-4">
                            <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#9AA0BB]">1 · Dry-run validation</p>
                            {dry === "idle" && <p className="mt-2 text-[13px] text-[#5B6080]">Validate before any file is produced.</p>}
                            {dry === "running" && <p className="mt-2 flex items-center gap-2 text-[13px] text-[#5B6080]"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#6161FF] border-t-transparent" />Validating {rows.length} rows…</p>}
                            {dry === "ok" && (
                              <ul className="mt-3 space-y-2 text-[13px]">
                                {[`${rows.length} rows · 0 duplicates`, target === "bdo" ? "12-digit account format valid" : target === "gcash" ? "Mobile numbers match 09XX format" : "Debits equal credits", `Net ₱${fmt(totals.net)} matches register`].map((c) => (
                                  <li key={c} className="pop-in flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#00CA72]" aria-hidden />{c}</li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-4 flex gap-2">
                              <button onClick={runDry} disabled={dry === "running"} className="flex-1 rounded-full border border-[#D9DCEC] px-4 py-2.5 text-[13px] font-bold transition-colors hover:border-[#11141F] disabled:opacity-50">{dry === "ok" ? "Re-run" : "Run dry-run"}</button>
                              <button onClick={generate} disabled={dry !== "ok"} className="flex-1 rounded-full bg-[#11141F] px-4 py-2.5 text-[13px] font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-30">Generate</button>
                            </div>
                          </div>
                          <div className="overflow-hidden rounded-2xl border border-[#E8EAF3] bg-[#FBFBFE]">
                            <p className="border-b border-[#EDEFF7] bg-white px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-[#9AA0BB]">2 · File preview · sample layout</p>
                            {file ? <pre className="mono pop-in max-h-[250px] overflow-auto p-4 text-[11.5px] leading-relaxed text-[#2B2F45]">{file}</pre>
                              : <p className="flex h-[150px] items-center justify-center px-6 text-center text-[13px] text-[#9AA0BB]">Run the dry-run, then generate to see the file.</p>}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {toast && (
              <div key={toast.k} role="status" className={cn("pop-in pointer-events-none absolute bottom-5 left-1/2 z-20 flex w-[calc(100%-2rem)] max-w-[460px] -translate-x-1/2 items-start gap-2.5 rounded-2xl px-4 py-3 text-[13px] font-semibold shadow-xl ring-1",
                toast.tone === "err" ? "bg-[#FFF6F7] text-[#9E2239] ring-[#FFD5DC]" : toast.tone === "ok" ? "bg-[#F1FCF7] text-[#0A6B41] ring-[#BFF0D9]" : "bg-[#F4F4FF] text-[#3B3BB8] ring-[#D9D9FF]")}>
                {toast.tone === "err" ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                {toast.text}
              </div>
            )}

            {confirm && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/70 p-4 backdrop-blur-sm" onKeyDown={(e) => e.key === "Escape" && setConfirm(false)}>
                <div role="dialog" aria-modal="true" aria-labelledby="rel-title" className="pop-in w-full max-w-[440px] rounded-3xl border border-[#E2E4F0] bg-white p-6 shadow-2xl">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFF4D6]"><AlertTriangle className="h-5 w-5 text-[#9A6B00]" aria-hidden /></span>
                  <h4 id="rel-title" className="font-display mt-4 text-[22px] font-extrabold">Release with an open exception?</h4>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[#5B6080]">Trish Dela Cruz still has an <span className="mono text-[12px] font-semibold text-[#D12D4B]">INCOMPLETE_PUNCH</span>. Her net pay reflects zero hours for that day. The server requires your explicit acknowledgement.</p>
                  <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#E8EAF3] p-3 text-[13.5px] font-semibold">
                    <input autoFocus type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#6161FF]" />
                    I acknowledge 1 unresolved exception and want to release anyway.
                  </label>
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={() => setConfirm(false)} className="rounded-full border border-[#D9DCEC] px-5 py-2.5 text-[13.5px] font-bold">Cancel</button>
                    <button onClick={() => { setAcked(true); doRelease(); }} disabled={!ack} className="rounded-full bg-[#11141F] px-5 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-30">Release anyway</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
