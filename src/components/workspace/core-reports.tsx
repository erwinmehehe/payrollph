"use client";
import { useState, type ReactNode } from "react";
export function CoreReports({ analytics, exports }: { analytics?: ReactNode; exports?: ReactNode }) {
  const [tab, setTab] = useState<"reports" | "exports">(analytics ? "reports" : "exports");
  return <section aria-label="Reports"><h1>Reports</h1><div role="group" aria-label="Report view">{analytics && <button type="button" aria-pressed={tab === "reports"} onClick={() => setTab("reports")}>Reports</button>}{exports && <button type="button" aria-pressed={tab === "exports"} onClick={() => setTab("exports")}>Payroll exports</button>}</div>{tab === "reports" ? analytics : exports}</section>;
}
