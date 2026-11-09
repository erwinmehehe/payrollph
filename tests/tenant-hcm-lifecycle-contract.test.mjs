import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/hcm/lifecycle-notifications/route.ts", "utf8");
const reader = readFileSync("src/lib/hcm-lifecycle-notification-tenant.ts", "utf8");

test("HCM lifecycle GET projects employee identities only from a same-employer join", () => {
  assert.match(route, /readScopedLifecycleNotificationTasks\(\{/);
  assert.match(reader, /eq\(hcmLifecycleNotificationTasks\.employeeId, employees\.id\)/);
  assert.match(reader, /eq\(hcmLifecycleNotificationTasks\.organizationId, employees\.organizationId\)/);
  assert.match(reader, /eq\(hcmLifecycleNotificationTasks\.organizationId, input\.organizationId\)/);
  assert.match(reader, /eq\(hcmLifecycleNotificationTasks\.ownerUserId, input\.userId\)/);
});

test("HCM lifecycle PATCH locks a scoped task with a matching-tenant worker", () => {
  assert.match(route, /db\.transaction\(async \(tx\) => \{/);
  assert.match(route, /eq\(hcmLifecycleNotificationTasks\.employeeId, employees\.id\)/);
  assert.match(route, /eq\(hcmLifecycleNotificationTasks\.organizationId, employees\.organizationId\)/);
  assert.match(route, /eq\(hcmLifecycleNotificationTasks\.organizationId, organizationId\)/);
  assert.match(route, /\.for\("update"\)/);
  assert.equal((route.match(/await tx\.update\(hcmLifecycleNotificationTasks\)/g) ?? []).length, 3);
  assert.equal((route.match(/await writeTaskEvent\(tx, \{/g) ?? []).length, 3);
  assert.match(route, /Only the assigned owner or a company-wide People administrator/);
  assert.match(route, /eq\(userOrganizations\.organizationId, organizationId\)/);
});

test("event and audit INSERTs share the mutation transaction and errors fail closed", () => {
  assert.match(route, /await writer\.insert\(hcmLifecycleNotificationEvents\)/);
  assert.match(route, /\}, writer\);/);
  assert.match(route, /status: 500, headers: PRIVATE_HEADERS/);
  assert.match(route, /Cache-Control.*private, no-store/);
  assert.match(route, /enforceSameOriginMutation\(request\)/);
  assert.match(route, /enforceSensitiveActionRateLimit\(request/);
});
