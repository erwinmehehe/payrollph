import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emitSafeOtelError, otlpErrorEnvelope, safeOtelRecord } from "../src/lib/safe-otel-error";
import { newOperationalRequestId } from "../src/lib/ops-telemetry";

// Synthetic sentinels correspond to actual src/db/schema.ts, auth.ts and the
// bank-account-crypto/government-id-crypto storage and masking boundaries.
// No real employee, government, bank, session or secret values appear here.
const sensitive = {
  bankAccount: "SYNTHETIC_BANK_ACCOUNT_650000001234",
  bank_account: "SYNTHETIC_BANK_DB_650000001235",
  accountEnvelope: "SYNTHETIC_ENTITY_BANK_ENVELOPE",
  proposed_bank_account: "SYNTHETIC_PROPOSED_BANK_ACCOUNT",
  tin: "SYNTHETIC_TIN_123456789",
  tin_branch_code: "SYNTHETIC_TIN_BRANCH_001",
  sssNo: "SYNTHETIC_SSS_120000000",
  sss_no: "SYNTHETIC_SSS_DB_120000000",
  philHealthNo: "SYNTHETIC_PHILHEALTH_190000000000",
  philhealth_no: "SYNTHETIC_PHILHEALTH_DB_190000000000",
  pagIbigNo: "SYNTHETIC_PAGIBIG_120000000000",
  pagibig_no: "SYNTHETIC_PAGIBIG_DB_120000000000",
  sessionToken: "SYNTHETIC_SESSION_TOKEN_DO_NOT_EXPORT",
  tokenHash: "SYNTHETIC_SESSION_TOKEN_HASH",
  cookie: "SYNTHETIC_HOST_LINAW_SESSION_COOKIE",
  Authorization: "Bearer SYNTHETIC_REQUEST_AUTH_HEADER",
  "x-worker-token": "SYNTHETIC_WORKER_TOKEN",
  "x-health-token": "SYNTHETIC_HEALTH_TOKEN",
  "x-readiness-token": "SYNTHETIC_READINESS_TOKEN",
  "x-scheduler-monitor-token": "SYNTHETIC_SCHEDULER_MONITOR_TOKEN",
  requestBody: "SYNTHETIC_RAW_HTTP_REQUEST_BODY",
  bankEncryptionKey: "SYNTHETIC_BANK_DATA_ENCRYPTION_KEY",
  piiEncryptionKey: "SYNTHETIC_PII_ENCRYPTION_KEY",
} as const;
const markers = Object.values(sensitive);

const hostile = {
  // TypeScript does not protect a runtime event from extra untrusted fields.
  requestId: sensitive.sessionToken,
  subsystem: sensitive.bankAccount,
  code: sensitive.tin,
  error: new Error(sensitive.requestBody),
  request: {
    body: { employee: sensitive },
    headers: {
      authorization: sensitive.Authorization,
      cookie: "__Host-linaw_session=" + sensitive.cookie,
      "x-health-token": sensitive["x-health-token"],
    },
    url: "https://example.invalid/?session=" + sensitive.sessionToken,
  },
  headers: sensitive,
  user: { email: "synthetic-employee@example.invalid", sssNo: sensitive.sssNo },
  extra: { bank: sensitive.bank_account, governmentIdentifiers: sensitive },
};

function expectNoSensitiveData(serialized: string) {
  for (const marker of markers) {
    assert.ok(!serialized.includes(marker), "Sensitive value must not cross telemetry boundary");
  }
  for (const field of [
    "bankAccount", "bank_account", "accountEnvelope", "tin_branch_code",
    "sssNo", "sss_no", "philHealthNo", "philhealth_no", "pagIbigNo",
    "pagibig_no", "sessionToken", "tokenHash", "Authorization", "requestBody",
  ]) {
    assert.ok(!serialized.includes('"' + field + '"'), "Sensitive key must not cross telemetry boundary: " + field);
  }
  assert.ok(!serialized.includes("synthetic-employee@example.invalid"));
  assert.ok(!serialized.includes("__Host-linaw_session"));
}

test("default-OFF error exporter cannot contact any provider even with hostile request input", async () => {
  const token = "synthetic-dedicated-collector-token-at-least-32-bytes";
  let calls = 0;
  const transport = async () => {
    calls++;
    return { ok: true, status: 200 };
  };
  for (const flag of [undefined, "false", "TRUE", "1", ""]) {
    const outcome = await emitSafeOtelError(hostile as never, {
      SAFE_OTEL_ERRORS_ENABLED: flag,
      OTLP_LOGS_ENDPOINT: "https://collector.example/v1/logs",
      OTLP_LOGS_BEARER_TOKEN: token,
    }, transport);
    assert.equal(outcome, "disabled");
  }
  assert.equal(calls, 0, "Zero outbound provider calls when the release flag is off");
});

test("allowlisted error record and OTLP envelope drop every bank, PH government ID, session, auth and body field", () => {
  const record = safeOtelRecord(hostile as never, Date.parse("2026-10-18T00:00:00Z"));
  assert.deepEqual(Object.keys(record).sort(), ["event", "requestId", "subsystem", "code", "timestamp"].sort());
  assert.equal(record.subsystem, "web");
  assert.equal(record.code, "UNHANDLED_SERVER_ERROR");
  assert.match(record.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  expectNoSensitiveData(JSON.stringify(record));
  const envelope = otlpErrorEnvelope(hostile as never);
  const log = envelope.resourceLogs[0].scopeLogs[0].logRecords[0];
  assert.deepEqual(log.attributes.map(attribute => attribute.key), [
    "request.id", "error.subsystem", "error.code",
  ]);
  expectNoSensitiveData(JSON.stringify(envelope));
});

test("opted-in HTTPS transport carries only sanitized fixed-schema body and its own collector bearer", async () => {
  const collectorToken = "synthetic-collector-only-token-minimum-32-characters";
  const captured: Array<{ body: string; headers: Record<string, string> }> = [];
  const result = await emitSafeOtelError({
    ...hostile,
    requestId: newOperationalRequestId(),
  } as never, {
    SAFE_OTEL_ERRORS_ENABLED: "true",
    OTLP_LOGS_ENDPOINT: "https://collector.example/v1/logs",
    OTLP_LOGS_BEARER_TOKEN: collectorToken,
  }, async request => {
    captured.push({ body: request.body, headers: request.headers });
    return { ok: true, status: 200 };
  });
  assert.equal(result, "delivered");
  assert.equal(captured.length, 1);
  const delivery = captured[0];
  assert.equal(delivery.headers.Authorization, "Bearer " + collectorToken);
  assert.deepEqual(Object.keys(delivery.headers).sort(), ["Authorization", "Content-Type"].sort());
  assert.ok(!delivery.body.includes(collectorToken), "Collector secret never becomes log content");
  expectNoSensitiveData(delivery.body);
  const body = JSON.parse(delivery.body);
  assert.equal(body.resourceLogs[0].scopeLogs[0].logRecords.length, 1);
  assert.equal(body.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue, "sanitized_server_error");
});

test("existing hooks have no raw Error/request forwarding and example keeps remote telemetry disabled", () => {
  const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
  const emitter = readFileSync("src/lib/safe-otel-error.ts", "utf8");
  const env = readFileSync(".env.local.example", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(env, /^SAFE_OTEL_ERRORS_ENABLED=false$/m);
  assert.match(env, /^OTLP_LOGS_ENDPOINT=$/m);
  assert.match(env, /^OTLP_LOGS_BEARER_TOKEN=$/m);
  assert.match(instrumentation, /export async function onRequestError\(\)/);
  assert.match(instrumentation, /code: "UNHANDLED_SERVER_ERROR"/);
  assert.match(emitter, /criticalReleaseFlagEnabled\("sanitizedErrorTelemetry", env\)/);
  assert.ok(!("sentry" in pkg.dependencies));
  assert.ok(!("@sentry/nextjs" in pkg.dependencies));
  assert.ok(!("@sentry/nextjs" in (pkg.devDependencies ?? {})));
});

test("UUIDv4 is a shape check, not origin proof; runtime instrumentation generates IDs itself", () => {
  const generatedByServer = newOperationalRequestId();
  const valid = safeOtelRecord({
    requestId: generatedByServer, subsystem: "web", code: "UNHANDLED_SERVER_ERROR",
  });
  assert.equal(valid.requestId, generatedByServer,
    "Existing safe exporter preserves UUIDv4 values; it does not establish their provenance");
  const rejected = safeOtelRecord(hostile as never);
  assert.match(rejected.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(rejected.requestId, sensitive.sessionToken);
  expectNoSensitiveData(JSON.stringify(rejected));
  const instrumentation = readFileSync("src/instrumentation.ts", "utf8");
  assert.match(instrumentation, /requestId:\s*newOperationalRequestId\(\)/,
    "The current unhandled web error hook must generate its own request ID");
});
