import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  normalizeSlackChannelIds,
  normalizeSlackConnectorConfig,
  validateSlackBotToken,
} from "../src/lib/slack-connector";

const read = (path: string) => readFileSync(path, "utf8");

test("Slack connector validates bot tokens and bounded allow-listed channels", () => {
  const sampleBotToken = ["xoxb", "1234567890", "abcdefghijklmnopqrstuvwxyz"].join("-");
  assert.equal(validateSlackBotToken(sampleBotToken), true);
  assert.equal(validateSlackBotToken(["xoxp", "user", "token"].join("-")), false);
  assert.deepEqual(normalizeSlackChannelIds(["C0123456789", "C0123456789", "G0123456789"]), [
    "C0123456789",
    "G0123456789",
  ]);
  assert.equal(normalizeSlackChannelIds(["https://hooks.slack.com/services/x"]), null);
  assert.deepEqual(
    normalizeSlackConnectorConfig({
      defaultChannelId: "C0123456789",
      allowedChannelIds: ["C0123456789", "G0123456789"],
    }),
    {
      defaultChannelId: "C0123456789",
      allowedChannelIds: ["C0123456789", "G0123456789"],
    },
  );
  assert.equal(
    normalizeSlackConnectorConfig({
      defaultChannelId: "C9999999999",
      allowedChannelIds: ["C0123456789"],
    }),
    null,
  );
});

test("0077 persists encrypted provider configuration and idempotent delivery evidence", () => {
  const migration = read("drizzle/0077_slack_connector.sql");
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  for (const source of [migration, schema, baseline]) {
    assert.ok(source.includes("integration_connectors"));
    assert.ok(source.includes("integration_connector_deliveries"));
    assert.ok(source.includes("integration_connector_delivery_automation_unique"));
  }
  assert.ok(migration.includes("credential_ciphertext"));
  assert.ok(migration.includes("provider_message_id"));
  assert.ok(schema.includes("integration_connectors_provider_check"));
  assert.ok(schema.includes("integration_connector_deliveries_status_check"));
});

test("Slack client is fixed to Slack API and rejects redirect-based destination changes", () => {
  const source = read("src/lib/slack-connector.ts");
  assert.ok(source.includes('const SLACK_API_ROOT = "https://slack.com/api"'));
  assert.ok(source.includes('method: "POST"'));
  assert.ok(source.includes('redirect: "error"'));
  assert.ok(source.includes("REQUEST_TIMEOUT_MS = 8_000"));
  assert.ok(source.includes('"auth.test"'));
  assert.ok(source.includes('"chat.postMessage"'));
  assert.equal(source.includes("new URL("), false);
});

test("provider credentials use dedicated AES-256-GCM encryption and are never returned in safe connector metadata", () => {
  const secret = read("src/lib/integration-secret.ts");
  const service = read("src/lib/integration-connectors.ts");
  const api = read("src/app/api/integration-connectors/route.ts");
  assert.ok(secret.includes("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY"));
  assert.ok(secret.includes('createCipheriv("aes-256-gcm"'));
  assert.ok(secret.includes('createDecipheriv("aes-256-gcm"'));
  assert.ok(secret.includes("enc:v1:"));
  assert.ok(service.includes("credentialCiphertext"));
  assert.ok(service.includes("decryptIntegrationCredential"));
  const safeStart = service.indexOf("function safeConnector");
  const safeEnd = service.indexOf("export async function listSafeIntegrationConnectors", safeStart);
  assert.equal(service.slice(safeStart, safeEnd).includes("credentialCiphertext:"), false);
  assert.ok(api.includes("encryptIntegrationCredential"));
  assert.ok(api.includes("verifySlackConnector"));
});

test("Slack connector administration is company-wide, MFA protected, audited and demo-safe", () => {
  const api = read("src/app/api/integration-connectors/route.ts");
  assert.ok(api.includes("ORG_ADMIN_ROLES"));
  assert.ok(api.includes("companyWide"));
  assert.ok(api.includes("publicDemoMutationDenied"));
  assert.ok(api.includes("enforceSameOriginMutation"));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("recordAuditEvent"));
  assert.ok(api.includes("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY"));
});

test("Slack automation delivery is idempotent and records provider evidence", () => {
  const service = read("src/lib/integration-connectors.ts");
  assert.ok(service.includes("automationExecutionId"));
  assert.ok(service.includes("actionIndex"));
  assert.ok(service.includes('existing?.status === "succeeded"'));
  assert.ok(service.includes('existing?.status === "pending"'));
  assert.ok(service.includes(".onConflictDoNothing()"));
  assert.ok(service.includes("providerMessageId"));
  assert.ok(service.includes("providerChannelId"));
  assert.ok(service.includes("Slack connector message delivered"));
  assert.ok(service.includes("Slack connector delivery failed"));
});

test("Automation Studio normalizes and executes dedicated Slack actions", () => {
  const engine = read("src/lib/automation.ts");
  assert.ok(engine.includes('type: "send_slack_message"'));
  assert.ok(engine.includes('label: "Send Slack message"'));
  assert.ok(engine.includes('if (type === "send_slack_message")'));
  assert.ok(engine.includes('if (action.type === "send_slack_message")'));
  assert.ok(engine.includes("deliverSlackAutomationMessage"));
  assert.ok(engine.includes("connectorId: action.connectorId"));
  assert.ok(engine.includes("executionId: input.executionId"));
  assert.ok(engine.includes("actionIndex: input.actionIndex"));
});

test("Automation Studio fails closed when Slack connector or channel is no longer valid", () => {
  const route = read("src/app/api/automation-studio/route.ts");
  assert.ok(route.includes("validateConnectorActions"));
  assert.ok(route.includes("Slack message actions require an active verified Slack connector."));
  assert.ok(route.includes("Slack message channel is not allow-listed on the selected connector."));
  assert.ok(route.includes('action === "publish-rule"'));
  assert.ok(route.includes('action === "rollback-rule"'));
  assert.ok(route.includes('action === "set-active"'));
  assert.ok(route.includes("connectorError"));
});

test("Studio browser receives safe connector metadata and exposes Slack administration and builder controls", () => {
  const route = read("src/app/api/automation-studio/route.ts");
  const panel = read("src/components/automation-studio-panel.tsx");
  const admin = read("src/components/slack-connector-admin.tsx");
  assert.ok(route.includes("listSafeIntegrationConnectors"));
  assert.ok(route.includes("integrationConnectors: integrationConnectors.filter"));
  assert.ok(panel.includes("SlackConnectorAdmin"));
  assert.ok(panel.includes("integrationConnectors"));
  assert.ok(panel.includes('row.type === "send_slack_message"'));
  assert.ok(panel.includes("Choose active Slack connector"));
  assert.ok(panel.includes("Choose allow-listed channel"));
  assert.ok(panel.includes("never accepts an arbitrary Slack or webhook URL"));
  assert.ok(admin.includes('type="password"'));
  assert.ok(admin.includes("Leave blank to keep current token"));
  assert.ok(admin.includes("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY"));
});

test("environment example documents the dedicated integration credential key", () => {
  const env = read(".env.local.example");
  assert.ok(env.includes("INTEGRATION_CREDENTIAL_ENCRYPTION_KEY="));
  assert.ok(env.includes("do not reuse bank/TOTP keys"));
});
