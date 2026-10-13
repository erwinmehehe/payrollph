export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionPiiKey } = await import("./lib/pii-key-policy");
    assertProductionPiiKey();
  }
}

/** Never forward the Error, request path, headers, cookies or stack. */
export async function onRequestError() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SAFE_OTEL_ERRORS_ENABLED !== "true") return;
  const { newOperationalRequestId } = await import("./lib/ops-telemetry");
  const { emitSafeOtelError } = await import("./lib/safe-otel-error");
  await emitSafeOtelError({ requestId: newOperationalRequestId(), subsystem: "web", code: "UNHANDLED_SERVER_ERROR" });
}
