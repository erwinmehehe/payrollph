import { BACKOFF_SCHEDULE_MS, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";

export const dynamic = "force-dynamic";

export async function GET() {
  const extended = criticalReleaseFlagEnabled("publicApiV1Extended");
  return Response.json({
    name: "Linaw Public API",
    version: "v1",
    authentication: {
      scheme: "Bearer token",
      header: "Authorization: Bearer sk_live_...",
      alternative: "X-API-Key: sk_live_...",
      scopes: ["employees:read", "employees:write", "payroll:read", ...(extended ? ["org-units:read", "payslips:read", "events:read"] : [])],
    },
    rateLimit: {
      limit: 120,
      windowSeconds: 60,
      mode: "distributed (Postgres fixed-window, shared across app instances)",
      fallback: "per-process sliding window if the database is unreachable",
    },
    idempotency: {
      header: "Idempotency-Key",
      appliesTo: ["POST /api/v1/employees"],
      behaviour: "Replaying a stored key returns the original response with Idempotent-Replay: true",
    },
    endpoints: [
      { method: "GET", path: "/api/v1/employees", scope: "employees:read", pagination: "limit & offset" },
      { method: "POST", path: "/api/v1/employees", scope: "employees:write", idempotent: true },
      { method: "GET", path: "/api/v1/employees/:id", scope: "employees:read" },
      { method: "PATCH", path: "/api/v1/employees/:id", scope: "employees:write" },
      { method: "DELETE", path: "/api/v1/employees/:id", scope: "employees:write", note: "Soft-delete: marks Separating and opens the offboarding checklist" },
      { method: "GET", path: "/api/v1/payroll-runs", scope: "payroll:read", pagination: "limit & offset" },
      ...(extended ? [
        { method: "GET", path: "/api/v1/org-units", scope: "org-units:read", pagination: "limit & after" },
        { method: "GET", path: "/api/v1/payslips", scope: "payslips:read", pagination: "limit & after" },
        { method: "GET", path: "/api/v1/payslips/:id", scope: "payslips:read" },
        { method: "GET", path: "/api/v1/events", scope: "events:read", pagination: "limit & after" },
      ] : []),
    ],
    openApi: "/openapi/v1.json",
    extendedApiDefaultOff: !extended,
    webhooks: {
      events: WEBHOOK_EVENTS,
      signatureHeader: "Linaw-Signature",
      signatureFormat: "t=<unix>,v1=<hex hmac sha256 of `${t}.${body}`>",
      toleranceSeconds: 300,
      retry: {
        maxAttempts: 5,
        backoffMs: BACKOFF_SCHEDULE_MS,
        terminalStatus: "exhausted",
        drainEndpoint: "POST /api/webhooks/drain",
      },
    },
    notImplemented: [
      "OAuth client credentials",
      "Cursor pagination on legacy endpoints (new endpoints use after cursors)",
      "Hard-delete of employees (payroll history is retained)",
    ],
  });
}
