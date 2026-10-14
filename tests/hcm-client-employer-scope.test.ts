import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  hcmReadScopeValid, hcmReadScopeParams, hcmReadScopeKey,
  hcmResponseMatchesReadScope, type HcmReadScope,
} from "../src/lib/hcm-client-employer-scope";
import { HcmPeopleOperationsInbox } from "../src/components/hcm-people-operations-inbox";
import { HcmEmploymentLifecycleActionCenter } from "../src/components/hcm-employment-lifecycle-action-center";

const scope: HcmReadScope = { organizationId: 25, multiEntityEnabled: true, legalEntityId: 201 };

test("explicit employer scope is mandatory for multi-entity HCM read requests", () => {
  assert.equal(hcmReadScopeValid(scope), true);
  assert.equal(hcmReadScopeParams(scope)?.toString(), "organizationId=25&legalEntityId=201");
  assert.equal(hcmReadScopeParams({ ...scope, legalEntityId: null }), null,
    "Group All is not a legal-employer read scope");
  for (const legalEntityId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(hcmReadScopeParams({ ...scope, legalEntityId }), null);
  }
  for (const organizationId of [0, -1, 1.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(hcmReadScopeParams({ ...scope, organizationId }), null);
  }
  const legacy = { organizationId: 25, multiEntityEnabled: false, legalEntityId: null };
  assert.equal(hcmReadScopeParams(legacy)?.toString(), "organizationId=25",
    "Feature-OFF HR queries remain single-employer compatible");
  assert.notEqual(hcmReadScopeKey(scope), hcmReadScopeKey({ ...scope, legalEntityId: 202 }),
    "Switching employers must remount the panel, reset filters and old private payload");
  assert.notEqual(hcmReadScopeKey(scope), hcmReadScopeKey({ ...scope, organizationId: 26 }));
  assert.notEqual(hcmReadScopeKey(scope), hcmReadScopeKey({ ...scope, multiEntityEnabled: false }));
});

test("the client accepts ONLY matching tenant and legal employer response scope", () => {
  const response = { organizationId: 25, legalEntityId: 201, rows: [{ employeeId: 1 }] };
  assert.equal(hcmResponseMatchesReadScope(response, scope), true);
  for (const payload of [
    { ...response, organizationId: 26 },
    { ...response, legalEntityId: 202 },
    { ...response, legalEntityId: null },
    { organizationId: 25 },
    { organizationId: "25", legalEntityId: 201 },
    { organizationId: 25, legalEntityId: "201" },
    null,
    [],
  ]) {
    assert.equal(hcmResponseMatchesReadScope(payload, scope), false,
      "Wrong employer, tenant or unscoped result cannot enter state");
  }
  const legacy = { organizationId: 25, legalEntityId: null, multiEntityEnabled: false };
  assert.equal(hcmResponseMatchesReadScope({ organizationId: 25, legalEntityId: null }, legacy), true);
  assert.equal(hcmResponseMatchesReadScope({ organizationId: 25, legalEntityId: 201 }, legacy), false);
  assert.equal(hcmResponseMatchesReadScope({ organizationId: 25 }, legacy), false,
    "No unverified organization-only response is accepted");
});

test("missing legal employer displays an empty guarded HCM state", () => {
  const people = renderToStaticMarkup(createElement(HcmPeopleOperationsInbox, {
    organizationId: 25, multiEntityEnabled: true, legalEntityId: null,
    onOpenWorker: () => false, onPage: () => {},
  }));
  const lifecycle = renderToStaticMarkup(createElement(HcmEmploymentLifecycleActionCenter, {
    organizationId: 25, multiEntityEnabled: true, legalEntityId: null,
    onOpenEmployee: () => {}, onOpenSeparation: () => {},
  }));
  assert.match(people, /Select one authorized legal employer/);
  assert.match(lifecycle, /Select one authorized legal employer/);
  assert.doesNotMatch(people, /Loading tenant-scoped HR follow-ups/);
  assert.doesNotMatch(lifecycle, /Lifecycle action center/);
});

test("both HCM callers request and verify scope, and the People page supplies selected employer", () => {
  const people = readFileSync("src/components/workspace/people.tsx", "utf8");
  const inbox = readFileSync("src/components/hcm-people-operations-inbox.tsx", "utf8");
  const lifecycle = readFileSync("src/components/hcm-employment-lifecycle-action-center.tsx", "utf8");
  assert.match(people, /<HcmPeopleOperationsInbox[\s\S]*?legalEntityId=\{data\.multiEntity\?\.legalEntityId \?\? null\}/);
  assert.match(people, /<HcmEmploymentLifecycleActionCenter[\s\S]*?legalEntityId=\{data\.multiEntity\?\.legalEntityId \?\? null\}/);
  for (const component of [inbox, lifecycle]) {
    assert.match(component, /key=\{hcmReadScopeKey\(scope\)\}/,
      "Tenant+employer selection must remount and reset private state");
    assert.match(component, /hcmReadScopeParams\(/,
      "No organization-only request is permitted when multi-entity is enabled");
    assert.match(component, /hcmResponseMatchesReadScope\(/,
      "Scope validation must happen before private payload is displayed");
    assert.match(component, /\.abort\(\)/,
      "In-flight old-employer requests must be aborted on switch or unmount");
  }
});
