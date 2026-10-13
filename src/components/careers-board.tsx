"use client";

import { useState, type FormEvent } from "react";
import { obtainIntakeProof } from "@/lib/public-intake-proof-client";

type Job = { id: number; title: string; department: string; employmentType: string; description: string | null };

export function CareersBoard({ organizationId, organizationName, jobs, privacyNoticeVersion, privacyNoticeUrl }: {
  organizationId: number; organizationName: string; jobs: Job[];
  privacyNoticeVersion?: string; privacyNoticeUrl?: string;
}) {
  const [selected, setSelected] = useState<Job | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !consent) return;
    setStatus("sending"); setError("");
    try {
      const intakeProof = await obtainIntakeProof(email);
      if (!intakeProof) throw new Error("Security check unavailable.");
      const response = await fetch("/api/careers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, requisitionId: selected.id, fullName, email, phone,
          notes, consent, intakeProof, privacyNoticeVersion, website,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Application could not be submitted.");
      setStatus("sent"); setFullName(""); setEmail(""); setPhone(""); setNotes(""); setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit application."); setStatus("error");
    }
  }
  return <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8" aria-label="Careers">
    <header className="mb-8"><p className="text-sm font-semibold uppercase tracking-wider">Careers</p>
      <h1 className="text-3xl font-bold">{organizationName}</h1>
      <p>Current published opportunities. Only roles intentionally published by this employer appear here.</p>
    </header>
    {jobs.length === 0 && <section className="rounded-xl border p-6" role="status">No published openings at this time.</section>}
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {jobs.map(job => <article className="rounded-xl border p-5" key={job.id}>
        <h2 className="text-xl font-semibold">{job.title}</h2>
        <p className="text-sm">{job.department} · {job.employmentType}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm">{job.description || "Contact the recruiting team for details."}</p>
        <button type="button" className="mt-4 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white"
          onClick={() => { setSelected(job); setStatus("idle"); setError(""); }}>
          Apply for this role
        </button>
      </article>)}
    </div>
    {selected && <section className="mt-8 rounded-xl border p-5" aria-label="Job application form">
      <h2 className="text-xl font-bold">Apply for {selected.title}</h2>
      <p className="my-2 text-sm">Use accurate contact information. Do not enter government ID or bank details. No resume upload is requested.</p>
      {status === "sent" ? <div role="status" className="rounded-lg border p-4">
        Application received. This does not constitute an offer or employment.
        <button type="button" className="ml-3 underline" onClick={() => setSelected(null)}>Return to roles</button>
      </div> : <form className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={event => void apply(event)}>
        <label className="grid gap-2">Full name<input required minLength={4} maxLength={160} className="rounded border p-2" value={fullName} onChange={e=>setFullName(e.target.value)}/></label>
        <label className="grid gap-2">Email<input required type="email" maxLength={160} className="rounded border p-2" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label className="grid gap-2">Phone (optional)<input maxLength={32} className="rounded border p-2" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
        <label className="grid gap-2 sm:col-span-2">Message (optional)
          <textarea maxLength={1000} rows={4} className="rounded border p-2" value={notes} onChange={e=>setNotes(e.target.value)}/>
        </label>
        <label className="sr-only" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={event=>setWebsite(event.target.value)}/></label>
        <label className="flex items-start gap-2 sm:col-span-2">
          <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/>
          <span>I consent to this employer processing my application details for recruitment under the <a className="underline" href={privacyNoticeUrl || "#"} target="_blank" rel="noopener noreferrer">recruitment privacy notice</a> (version {privacyNoticeVersion || "not configured"}).</span>
        </label>
        {error && <p role="alert" className="sm:col-span-2">{error}</p>}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" disabled={!consent || status === "sending"} className="rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white disabled:opacity-50">
            {status === "sending" ? "Sending…" : "Submit application"}
          </button>
          <button type="button" onClick={() => setSelected(null)} className="rounded-lg border px-4 py-2">Cancel</button>
        </div>
      </form>}
    </section>}
  </main>;
}
