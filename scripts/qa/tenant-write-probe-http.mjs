/** Discovery of owned writes only; NEVER an own/foreign tenant acceptance suite. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { proposeBody, proposeFixture, probeEligibility } from "./tenant-write-generator.mjs";

export function requireWriteProbeTarget(env = process.env) {
  let app, database;
  try { app = new URL(env.SECURITY_SMOKE_URL); database = new URL(env.DATABASE_URL); }
  catch { throw Error("WRITE_PROBE_TARGET_REFUSED"); }
  if (env.CI !== "true" || env.TENANT_WRITE_PROBE_MODE !== "fictional-disposable-only"
    || env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" || env.NODE_ENV !== "production"
    || app.origin !== "http://127.0.0.1:3000" || app.pathname !== "/" || app.search || app.hash || app.username || app.password
    || database.protocol !== "postgresql:" || database.hostname !== "127.0.0.1" || database.port !== "5432"
    || database.pathname !== "/app_db" || database.search || database.hash
    || env.DEMO_MODE !== "false" || env.WORKER_ENABLED === "true" || env.CENTRAL_SCHEDULER_ENABLED === "true"
    || env.PAYMONGO_DISBURSEMENTS_ENABLED !== "false" || env.XENDIT_PAYOUTS_ENABLED !== "false"
    || env.FINAL_PAY_MANUAL_RELEASE_ENABLED === "true") throw Error("WRITE_PROBE_TARGET_REFUSED");
  for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY", "SENDGRID_API_KEY", "SMTP_HOST", "SMTP_PASSWORD", "TWILIO_AUTH_TOKEN", "SLACK_BOT_TOKEN", "MALWARE_SCAN_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY"]) {
    if (env[name]) throw Error("WRITE_PROBE_EXTERNAL_CONFIGURATION_REFUSED");
  }
  return app.origin;
}

export function classifyProbe(status, { flags = [], code = "" } = {}) {
  if (status >= 200 && status < 300) return "works";
  if ([404, 501].includes(status) && (flags.length || /DISABLED|NOT_ENABLED|FEATURE_OFF/.test(code))) return "needs flag";
  if ([400, 422].includes(status)) return "validation error";
  if ([401, 403, 404, 409].includes(status)) return "needs fixture";
  return "unavailable";
}

export function renderProbePath(route, rowId) {
  if (/\[\[|\.\.\./.test(route)) throw Error("UNSUPPORTED_PATH_PARAMETER");
  if (!/^[a-zA-Z0-9_/\[\]-]+$/.test(route) || route.startsWith("/")) throw Error("INVALID_PROBE_PATH");
  return "/api/" + route.replace(/\[([^\]]+)\]/g, (_, key) => {
    if (key !== "id" || !Number.isSafeInteger(rowId) || rowId <= 0) throw Error("UNRESOLVED_PATH_PARAMETER");
    return String(rowId);
  });
}

function safeError(json) {
  const value = typeof json?.error === "string" ? json.error : "";
  return value.replace(/(?:postgres(?:ql)?|https?):\/\/\S+/g, "[URL]")
    .replace(/(?:Bearer\s+|sk_live_|sk_test_|xnd_)[\w.-]+/gi, "[REDACTED]").slice(0, 240);
}

// A directory read refuses employees without an explicit reviewed pay profile.
// Seed both fictional records before trying to bind the HTTP server to the DB.
export async function seedProbeWorker(insert, context) {
  const worker = await insert("employees", context, { organizationId: context.organizationId,
    legalEntityId: context.legalEntityId, orgUnitId: context.orgUnitId,
    employeeNo: context.marker, firstName: "Fictional", lastName: context.marker, title: "Probe", avatarInitials: "FP",
    basicRate: "20000.00", startDate: "2026-01-05" });
  context.employeeId = worker.id; context.references["employees.id"] = worker.id;
  await insert("employeePayProfiles", context, { organizationId: context.organizationId, employeeId: worker.id,
    payBasis: "monthly", rateAmount: "20000.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
  return worker;
}

export function probeBindingVerified(status, payload, context) {
  return status === 200 && Array.isArray(payload) && payload.some((row) =>
    row?.id === context.employeeId && row.organizationId === context.organizationId && row.employeeNo === context.marker);
}

export async function runWriteProbe(plan, catalogue, env = process.env) {
  const origin = requireWriteProbeTarget(env); // Before importing or opening any app DB client.
  const databaseModule = await import("../../src/db/index.ts");
  const { db, pool } = databaseModule.default ?? databaseModule;
  const schemaModule = await import("../../src/db/schema.ts"); const schema = schemaModule.default ?? schemaModule;
  const report = [];
  try {
    const { rows: [identity] } = await pool.query("SELECT current_database() AS database, (SELECT count(*)::int FROM organizations) AS organizations");
    if (identity.database !== "app_db" || identity.organizations !== 0) throw Error("WRITE_PROBE_REQUIRES_EMPTY_DISPOSABLE_DB");
    const insert = async (symbol, context, overrides) => {
      const table = catalogue[symbol]; if (!table) throw Error("FIXTURE_TABLE_UNRESOLVED");
      const proposal = proposeFixture(table, context, overrides);
      if (proposal.unresolved.length) throw Error("FIXTURE_REFERENCE_UNRESOLVED");
      const [row] = await db.insert(schema[symbol]).values(proposal.values).returning();
      return row;
    };
    for (const item of plan.writes) {
      // Recompute eligibility, never trust an edited JSON executionHold.
      const hold = probeEligibility(item.route, item.method, item.handler);
      const outcome = { key: item.key, category: "manual review", reason: hold, coverageCredits: 0,
        isolationProven: false, persistedChangeVerified: false };
      if (hold) { report.push(outcome); continue; }
      let phase = "fixture";
      try {
        const context = { marker: "WPROBE-" + randomBytes(6).toString("hex"), uuid: randomUUID(), references: {} };
        const org = await insert("organizations", context, { name: context.marker, legalName: context.marker });
        context.organizationId = org.id; context.references["organizations.id"] = org.id;
        const entity = await insert("legalEntities", context, { organizationId: org.id, code: context.marker, legalName: context.marker, displayName: context.marker, primaryEntity: true });
        context.legalEntityId = entity.id; context.references["legal_entities.id"] = entity.id;
        const unit = await insert("orgUnits", context, { organizationId: org.id, legalEntityId: entity.id, code: context.marker, name: context.marker, type: "department" });
        context.orgUnitId = unit.id; context.references["org_units.id"] = unit.id;
        const owner = await insert("users", context, { email: context.marker + "@example.invalid", name: context.marker,
          passwordHash: "fictional-session-only-no-password", role: "owner", totpEnabled: true });
        context.userId = owner.id; context.references["users.id"] = owner.id;
        await db.insert(schema.userOrganizations).values({ userId: owner.id, organizationId: org.id, role: "owner", active: true });
        await seedProbeWorker(insert, context);
        const token = randomBytes(32).toString("hex");
        await db.insert(schema.sessions).values({ userId: owner.id, tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now()+3_600_000), lastSeenAt: new Date(), mfaVerifiedAt: new Date(), authMethod: "oidc" });
        const headers = { cookie: "__Host-linaw_session=" + token, origin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
        // Bind the listening server to this freshly seeded DB/session before any HTTP mutation.
        phase = "binding";
        const binding = await fetch(origin + "/api/employees?organizationId=" + org.id, { headers,
          redirect: "manual", signal: AbortSignal.timeout(10_000) });
        // Retain only status/identity-verification, never directory bodies or session headers.
        outcome.bindingStatus = binding.status;
        let bindingJson; try { bindingJson = await binding.json(); } catch { bindingJson = null; }
        outcome.bindingVerified = probeBindingVerified(binding.status, bindingJson, context);
        if (!outcome.bindingVerified) throw Error("PROBE_SERVER_BINDING_UNVERIFIED");
        phase = "fixture";
        const table = catalogue[item.handler.tables[0]];
        if (!table?.columns.some(c => c.key === "organizationId")) {
          outcome.reason = "write-target-has-no-explicit-organization-scope"; report.push(outcome); continue;
        }
        if (item.method !== "POST" || item.handler.fields.some(f => f.name === "id") || item.route.includes("[")) {
          const existing = await insert(table.symbol, context, { organizationId: org.id }); context.rowId = existing.id;
        }
        const proposal = proposeBody(item.handler, table, context);
        if (proposal.unresolved.length) { outcome.category = "needs fixture"; outcome.reason = "unresolved-body-references"; outcome.fields = proposal.unresolved; report.push(outcome); continue; }
        // Financial destinations/credentials are never invented by fictionalValue().
        outcome.proposedBody = proposal.body;
        const path = renderProbePath(item.route, context.rowId) + "?organizationId=" + org.id;
        phase = "http";
        const response = await fetch(origin + path, { method: item.method, headers, body: JSON.stringify(proposal.body),
          redirect: "manual", signal: AbortSignal.timeout(10_000) });
        let json; try { json = await response.json(); } catch { json = null; }
        const code = typeof json?.code === "string" && /^[A-Z0-9_:-]{1,80}$/.test(json.code) ? json.code : "";
        outcome.status = response.status;
        outcome.category = classifyProbe(response.status, { flags: item.handler.flags.filter(key => env[key] !== "true"), code });
        outcome.reason = safeError(json) || "http-" + response.status;
        if (code) outcome.code = code;
        // A 2xx merely prioritizes a candidate for a future row-specific DB expect.
        // It cannot prove persisted state, cross-tenant denial, or even a non-noop write.
      } catch (error) {
        outcome.category = phase === "fixture" ? "needs fixture" : "unavailable";
        outcome.reason = phase === "fixture" ? "fixture-unresolved" : "server-binding-or-transport-unavailable";
        const cause = error.cause ?? error;
        if (typeof cause.code === "string" && /^[A-Z0-9_]{2,40}$/.test(cause.code)) outcome.fixtureErrorCode = cause.code;
        for (const key of ["column", "constraint"]) if (typeof cause[key] === "string" && /^[a-zA-Z0-9_]{1,100}$/.test(cause[key])) outcome[key] = cause[key];
      }
      report.push(outcome);
    }
    const summary = Object.fromEntries(["works", "needs flag", "needs fixture", "validation error", "manual review", "unavailable"]
      .map(category => [category, report.filter(r => r.category === category).length]));
    return { kind: "tenant-write-discovery-results", coverageCredits: 0, isolationAccepted: false, summary, report };
  } finally { await pool.end(); }
}
