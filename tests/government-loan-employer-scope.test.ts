import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("src/components/government-loan-remittance-panel.tsx", "utf8");
const route = readFileSync("src/app/api/compliance/government-loan-remittances/route.ts", "utf8");
const selector = readFileSync("src/app/api/legal-entities/route.ts", "utf8");

test("UI requires authorized active legal employers before any loan read", () => {
  assert.match(panel, /mode=selector/);
  assert.match(panel, /parseAuthorizedLegalEmployers/);
  assert.match(panel, /selectedLegalEntityId === null/);
  assert.match(panel, /entries.length === 1 \? entries\[0\].id : null/);
  assert.match(panel, /key=\{organizationId \+ ":" \+ selectedLegalEntityId\}/);
  assert.match(panel, /disabled=\{mutationBusy\}/);
  assert.match(panel, /body\.legalEntityId !== legalEntityId/);
  assert.match(panel, /"&legalEntityId=" \+ legalEntityId/);
  assert.match(panel, /JSON\.stringify\(\{ organizationId, legalEntityId, action/);
});

test("server enforces grants on GET, POST and authorized selector", () => {
  assert.match(route, /resolveMultiEntityContext\(/);
  assert.match(route, /assertEntityResource\(scope\.context, legalEntityId\)/);
  assert.equal((route.match(/requireLegalEmployerGrant\(user\.id, organizationId, legalEntity\.id, request\)/g) ?? []).length, 2);
  assert.match(selector, /inArray\(legalEntities\.id, scope\.context\.entities\.map\(entity => entity\.id\)\)/);
  assert.match(selector, /eq\(legalEntities\.organizationId, organizationId\)/);
  assert.match(selector, /eq\(legalEntities\.active, true\)/);
});
