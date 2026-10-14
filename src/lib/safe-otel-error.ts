import { postValidatedWebhook } from "@/lib/security-network";
import { criticalReleaseFlagEnabled } from "@/lib/critical-release-flags";
import { newOperationalRequestId } from "@/lib/ops-telemetry";

/** Strict schema: raw Error objects, URL, headers, body, PII and arbitrary
 * messages never enter logs or the OTLP envelope. */
const SUBSYSTEMS = new Set(["web", "scheduler"]);
const CODES = new Set(["UNHANDLED_SERVER_ERROR", "CRON_TICK_FAILED"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
export type SafeOperationalError = {
  requestId: string;
  subsystem: "web" | "scheduler";
  code: "UNHANDLED_SERVER_ERROR" | "CRON_TICK_FAILED";
};

export function safeOtelRecord(input: SafeOperationalError, now = Date.now()) {
  return {
    event: "sanitized_server_error" as const,
    requestId: UUID_V4.test(input.requestId) ? input.requestId : newOperationalRequestId(),
    subsystem: SUBSYSTEMS.has(input.subsystem) ? input.subsystem : "web",
    code: CODES.has(input.code) ? input.code : "UNHANDLED_SERVER_ERROR",
    timestamp: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
  };
}

export function otlpErrorEnvelope(input: SafeOperationalError, now = Date.now()) {
  const record = safeOtelRecord(input, now);
  return { resourceLogs: [{
    resource: { attributes: [attr("service.name", "linaw-payrollph")] },
    scopeLogs: [{ scope: { name: "linaw.sanitized-errors" }, logRecords: [{
      timeUnixNano: (BigInt(Date.parse(record.timestamp)) * BigInt(1_000_000)).toString(),
      severityNumber: 17, severityText: "ERROR",
      body: { stringValue: record.event },
      attributes: [
        attr("request.id", record.requestId),
        attr("error.subsystem", record.subsystem),
        attr("error.code", record.code),
      ],
    }] }],
  }] };
}
export function approvedOtlpEndpoint(raw: string | undefined) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password
      || u.hash || u.search || !u.pathname.endsWith("/v1/logs")) return null;
    return u.toString();
  } catch { return null; }
}
type Transport = typeof postValidatedWebhook;
/** A failed tracker may not break the original request or leak secrets. */
export async function emitSafeOtelError(
  input: SafeOperationalError,
  env: Readonly<Record<string, string | undefined>> = process.env,
  transport: Transport = postValidatedWebhook,
): Promise<"disabled" | "misconfigured" | "delivered" | "failed"> {
  if (!criticalReleaseFlagEnabled("sanitizedErrorTelemetry", env)) return "disabled";
  const record = safeOtelRecord(input);
  console.error(JSON.stringify(record));
  const endpoint = approvedOtlpEndpoint(env.OTLP_LOGS_ENDPOINT);
  const token = env.OTLP_LOGS_BEARER_TOKEN?.trim();
  if (!endpoint || !token || token.length < 32) return "misconfigured";
  // Socket timeouts do not bound DNS resolution or injected transports.
  // Bound the entire export and abort the HTTPS request at the deadline.
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const expired = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        controller.abort();
        reject(new Error("Sanitized OTLP delivery deadline exceeded."));
      }, 2_000);
    });
    const delivery = transport({
      url: endpoint,
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(otlpErrorEnvelope({
        requestId: record.requestId, subsystem: record.subsystem, code: record.code,
      })),
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    const response = await Promise.race([delivery, expired]);
    return response.ok ? "delivered" : "failed";
  } catch { return "failed"; }
  finally { if (deadline) clearTimeout(deadline); }
}
