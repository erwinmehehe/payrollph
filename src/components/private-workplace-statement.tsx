"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Confidential complaint bodies never enter a table/list response. Fetch
 * one, only after a user explicitly requests it, under server RBAC + MFA.
 */
export function PrivateWorkplaceStatement({ organizationId, caseId }: {
  organizationId: number; caseId: number;
}) {
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function toggle() {
    if (busy) return;
    if (open) {
      request.current?.abort();
      setStatement(""); setOpen(false); setError("");
      return;
    }
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true); setError("");
    try {
      const url = "/api/workplace/protected-cases?organizationId=" + organizationId + "&caseId=" + caseId;
      const response = await fetch(url, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal,
      });
      const result: { cases?: Array<{ id?: number; statement?: string }>; error?: string } =
        await response.json().catch(() => ({}));
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(result.error || "Restricted statement could not be opened.");
      const record = result.cases?.[0];
      if (!record || record.id !== caseId || typeof record.statement !== "string") {
        throw new Error("Private statement could not be verified.");
      }
      setStatement(record.statement);
      setOpen(true);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not retrieve confidential statement.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return <div className="mt-3 space-y-2">
    <button type="button" className="rounded border border-emerald-700 px-3 py-2 text-sm text-emerald-900"
      aria-expanded={open} onClick={() => { void toggle(); }} disabled={busy}>
      {busy ? "Checking access…" : open ? "Hide and clear private statement" : "Open private statement"}
    </button>
    {open ? <p className="whitespace-pre-wrap rounded-md border border-slate-200 p-3 text-sm text-slate-900">
      {statement}
    </p> : null}
    {error ? <p role="alert" className="text-xs text-red-800">{error}</p> : null}
  </div>;
}
