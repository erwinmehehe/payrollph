"use client";

import { useRef, useState } from "react";
import { samplePayslipText, totalPracticePayroll, type PracticePayload } from "@/lib/practice-payroll";
import styles from "./practice-payroll.module.css";

const money = (cents: number) => `PHP ${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PracticePayrollCard({ payload }: { payload?: PracticePayload }) {
  const [open, setOpen] = useState(false);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [calculated, setCalculated] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [payslipId, setPayslipId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const launch = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  if (!payload) return null;
  const scenario = payload.status === "ready" ? payload.scenarios[scenarioIndex] : null;
  const selectedIds = selected ?? scenario?.workers.map(worker => worker.id) ?? [];
  let result: ReturnType<typeof totalPracticePayroll> | null = null;
  if (calculated && scenario) {
    try { result = totalPracticePayroll(scenario, selectedIds); } catch { /* Explicit unavailable UI below. */ }
  }
  const payslip = reviewed ? result?.workers.find(worker => worker.id === payslipId) : null;
  function resetResult() {
    setCalculated(false); setAcknowledged(false); setReviewed(false); setPayslipId(null); setError("");
  }
  function close() {
    setOpen(false); setScenarioIndex(0); setSelected(null); resetResult(); launch.current?.focus();
  }
  function calculate() {
    if (!scenario) return;
    try { totalPracticePayroll(scenario, selectedIds); setCalculated(true); setError(""); }
    catch (e) { setCalculated(false); setError(e instanceof Error ? e.message : "Sample calculation is unavailable."); }
  }
  return <section className={styles.card} aria-label="Practice payroll">
    <div className={styles.header}>
      <div><span className={styles.eyebrow}>PRACTICE ONLY</span><h2>Try your first payroll with fictional people.</h2>
        <p>No bank details, government IDs, MFA enrollment or colleague invitations needed for practice. Live payroll still requires its normal controls.</p></div>
      <button ref={launch} type="button" className="primary-button" aria-expanded={open} aria-controls="practice-payroll-workspace"
        onClick={() => { setOpen(true); requestAnimationFrame(() => heading.current?.focus()); }}>Open practice payroll</button>
    </div>
    {open && <div id="practice-payroll-workspace" className={styles.workspace}>
      <div className={styles.header}><h3 ref={heading} tabIndex={-1}>Practice payroll workspace</h3><button type="button" className="secondary-button" onClick={close}>Close practice</button></div>
      <p className={styles.notice}>FICTIONAL DATA · Nothing is saved to live payroll. Closing resets this session. Payments, bank files, government filings and real approvals are unavailable.</p>
      {payload.status === "unavailable" || !scenario ? <div role="alert"><h4>Practice calculation unavailable</h4><p>No sample amounts can be verified right now. Live payroll has not changed.</p>
        <button type="button" className="secondary-button" onClick={() => window.location.reload()}>Reload to retry</button></div> : <>
        <ol className={styles.steps} aria-label="Practice steps"><li>Choose people</li><li>Calculate</li><li>Practice review</li><li>Sample payslip</li></ol>
        <label className={styles.field}>Fictional scenario<select value={scenarioIndex} onChange={event => { setScenarioIndex(Number(event.target.value)); setSelected(null); resetResult(); }}>
          {payload.scenarios.map((item, index) => <option key={item.id} value={index}>{item.name}</option>)}</select></label>
        <p>{scenario.explanation}</p>
        <p>Fixed sample cutoff: <strong>October 1–15, 2026</strong>. Standard work pattern: 22 days/month, 8 hours/day, Sunday rest day.</p>
        <fieldset><legend>Fictional employees to include</legend>{scenario.workers.map(worker => <label className={styles.worker} key={worker.id}>
          <input type="checkbox" checked={selectedIds.includes(worker.id)} onChange={event => {
            setSelected(event.target.checked ? [...selectedIds, worker.id] : selectedIds.filter(id => id !== worker.id)); resetResult();
          }} /><span><strong>{worker.name}</strong><span className={styles.detail}>{worker.basis} · {worker.inputSummary}</span></span></label>)}</fieldset>
        <p className={styles.detail}>Fixed scenarios use the existing payroll engine. Sample rates, calendars and statutory results are illustrative, not current filing certification. No live employee records are read into practice.</p>
        <button type="button" className="primary-button" onClick={calculate}>Calculate practice payroll</button>
        {error && <p role="alert">{error}</p>}
        {!calculated && !error && <p className={styles.detail}>No practice result yet. Choose employees, then calculate.</p>}
        {calculated && !result && <p role="alert">Sample results could not be verified. Change the selection and calculate again.</p>}
        {result && <section aria-label="Practice calculation results" className={styles.results}>
          <h4>Practice calculation complete</h4><p role="status">{result.workers.length} fictional employees calculated. No live run created.</p>
          <dl className={styles.totals}><div><dt>Sample gross</dt><dd>{money(result.grossCents)}</dd></div><div><dt>Sample deductions</dt><dd>{money(result.deductionCents)}</dd></div><div><dt>Sample net</dt><dd>{money(result.netCents)}</dd></div></dl>
          <h4>Practice review</h4><p>This is a learning step, not independent approval. It does not complete your real first-payroll checklist.</p>
          <label className={styles.worker}><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked); setReviewed(false); setPayslipId(null); }} />
            <span>I understand these are fictional results and no wages will be paid.</span></label>
          <button type="button" className="secondary-button" disabled={!acknowledged || reviewed} onClick={() => setReviewed(true)}>{reviewed ? "Practice review complete" : "Complete practice review"}</button>
          {reviewed && <div><p role="status">Practice review complete. Live approvals remain unchanged.</p>{result.workers.map(worker => <div className={styles.payslipRow} key={worker.id}><span>{worker.name} · {money(worker.netCents)}</span>
            <button type="button" className="secondary-button" onClick={() => setPayslipId(worker.id)}>View sample payslip for {worker.name}</button></div>)}</div>}
          {payslip && <article className={styles.payslip} aria-label={`Sample payslip for ${payslip.name}`}><h4>PRACTICE ONLY — NOT A REAL PAYSLIP</h4><pre>{samplePayslipText(payslip)}</pre></article>}
        </section>}
      </>}
    </div>}
  </section>;
}
