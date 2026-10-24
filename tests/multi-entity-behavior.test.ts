import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { canActOnEntityTransfer, decideEntityAccess, entityResourceAllowed, entityConfirmationMatches, summarizeEntityTransfer, validateLegalEmployerSettingsPatch, VERSIONED_EMPLOYER_FIELDS } from "../src/lib/multi-entity-policy";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";
import { groupReportHasUnattributedRows, sumPayrollAmounts } from "../src/lib/multi-entity-money";
import { parseCompanyExportKind } from "../src/lib/company-export-kind";
import { validateEmployerProfileChanges } from "../src/lib/multi-entity-registration";
import { EntityBadge, EntitySwitcher, EntityFilter } from "../src/components/workspace/multi-entity-ui";

const entities = [
  { id: 11, code: "ALPHA", legalName: "Alpha Manufacturing Inc.", displayName: "Alpha" },
  { id: 22, code: "BETA", legalName: "Beta Services Corp.", displayName: "Beta" },
];
const group = { enabled: true as const, group: true, role: "group_hr", legalEntityId: null, entities };
const scoped = { enabled: true as const, group: false, role: "hr", legalEntityId: 11, entities: [entities[0]] };

test("unknown export kinds cannot fall through to tenant-wide payroll/audit JSON", () => {
  for (const invalid of ["", " ", "alL", "audit?kind=employees", "json", "all.json", "unknown"]) {
    assert.equal(parseCompanyExportKind(invalid), null, invalid);
  }
  assert.equal(parseCompanyExportKind(null), "all");
  for (const valid of ["employees", "payroll", "audit", "all"]) {
    assert.equal(parseCompanyExportKind(valid), valid);
  }
});

test("MULTI_ENTITY_ENABLED is false for unset, wrong case and invalid values", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "true "]) {
    assert.equal(criticalReleaseFlagEnabled("multiEntity", { MULTI_ENTITY_ENABLED: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("multiEntity", { MULTI_ENTITY_ENABLED: "true" }), true);
});

test("entity-scoped personnel cannot escalate to another entity or All", () => {
  const base = { role: "hr", availableEntityIds: [11, 22], grantedEntityIds: [11] };
  const allow = decideEntityAccess({ ...base, requested: 11 });
  assert.deepEqual(allow, { ok: true, group: false, selectedEntityId: 11, allowedEntityIds: [11] });
  assert.equal(entityResourceAllowed(allow, 11), true);
  for (const requested of [22, 999, null, "all", "-1", "0", "22foo"]) {
    const decision = decideEntityAccess({ ...base, requested });
    assert.equal(decision.ok, false, String(requested));
    assert.equal(entityResourceAllowed(decision, 11), false);
  }
  assert.equal(entityResourceAllowed(allow, 22), false);
  assert.equal(entityResourceAllowed(allow, null), false);
});

test("only dedicated group HR can read all employers in their current tenant", () => {
  const input = { role: "group_hr", availableEntityIds: [11, 22], grantedEntityIds: [] };
  const all = decideEntityAccess({ ...input, requested: "all" });
  assert.equal(all.ok, true);
  assert.equal(entityResourceAllowed(all, 11), true);
  assert.equal(entityResourceAllowed(all, 22), true);
  assert.equal(entityResourceAllowed(all, 33), false);
  assert.equal(decideEntityAccess({ ...input, requested: 33 }).ok, false);
  const selected = decideEntityAccess({ ...input, requested: 22 });
  assert.equal(selected.ok, true);
  assert.equal(entityResourceAllowed(selected, 11), false);
});

test("owner/admin/bookkeeper never inherit cross-entity group access", () => {
  for (const role of ["owner", "admin", "bookkeeper", "hr", "payroll"]) {
    const ungranted = { role, availableEntityIds: [11, 22], grantedEntityIds: [] };
    for (const requested of ["all", null, undefined, 11, 22]) {
      assert.equal(decideEntityAccess({ ...ungranted, requested }).ok, false, String(role) + ":" + String(requested));
    }
    const granted = { ...ungranted, grantedEntityIds: [11] };
    assert.equal(decideEntityAccess({ ...granted, requested: "all" }).ok, false);
    const scoped = decideEntityAccess({ ...granted, requested: 11 });
    assert.equal(entityResourceAllowed(scoped, 11), true);
    assert.equal(entityResourceAllowed(scoped, 22), false);
    assert.equal(decideEntityAccess({ ...granted, requested: 22 }).ok, false);
  }
});

test("multi-granted administrators default to one entity, not an implicit group view", () => {
  const input = { role: "owner", availableEntityIds: [22, 11], grantedEntityIds: [22, 11] };
  const initial = decideEntityAccess({ ...input, requested: undefined });
  assert.equal(initial.ok, true);
  if (initial.ok) {
    assert.equal(initial.group, false);
    assert.equal(initial.selectedEntityId, 11);
    assert.equal(entityResourceAllowed(initial, 22), false);
    assert.equal(entityResourceAllowed(initial, 11), true);
  }
  assert.equal(decideEntityAccess({ ...input, requested: "all" }).ok, false);
  const explicit = decideEntityAccess({ ...input, requested: 22 });
  assert.equal(entityResourceAllowed(explicit, 11), false);
  assert.equal(entityResourceAllowed(explicit, 22), true);
});

test("transfer permissions require two explicit grants without authorizing cross-entity reads", () => {
  const source = {
    action: "propose" as const, role: "hr", selectedEntityId: 11,
    sourceEntityId: 11, targetEntityId: 22, grantedEntityIds: [11, 22],
    actorUserId: 100,
  };
  assert.equal(canActOnEntityTransfer(source), true);
  for (const actorUserId of [0, -1, 1.5, Number.NaN]) {
    assert.equal(canActOnEntityTransfer({ ...source, actorUserId }), false);
  }
  for (const role of ["group_hr", "employee", "payroll", "checker", "manager"]) {
    assert.equal(canActOnEntityTransfer({ ...source, role }), false, role);
  }
  assert.equal(canActOnEntityTransfer({ ...source, grantedEntityIds: [11] }), false);
  assert.equal(canActOnEntityTransfer({ ...source, grantedEntityIds: [22] }), false);
  assert.equal(canActOnEntityTransfer({ ...source, targetEntityId: 999 }), false);
  assert.equal(canActOnEntityTransfer({ ...source, selectedEntityId: null }), false);
  assert.equal(canActOnEntityTransfer({ ...source, selectedEntityId: 22 }), false);
  assert.equal(canActOnEntityTransfer({ ...source, sourceEntityId: 22, targetEntityId: 22 }), false);
  const approval = { ...source, action: "approve" as const, role: "admin",
    actorUserId: 200, makerUserId: 100 };
  assert.equal(canActOnEntityTransfer(approval), true);
  for (const makerUserId of [0, -1, 1.5, Number.NaN]) {
    assert.equal(canActOnEntityTransfer({ ...approval, makerUserId }), false);
  }
  for (const action of ["approve", "reject", "apply"] as const) {
    assert.equal(canActOnEntityTransfer({ ...approval, action, makerUserId: 200 }), false);
    assert.equal(canActOnEntityTransfer({ ...approval, action, makerUserId: undefined }), false);
    assert.equal(canActOnEntityTransfer({ ...approval, action, role: "group_hr" }), false);
    assert.equal(canActOnEntityTransfer({ ...approval, action, role: "hr" }), false);
    assert.equal(canActOnEntityTransfer({ ...approval, action, grantedEntityIds: [11] }), false);
    assert.equal(canActOnEntityTransfer({ ...approval, action, grantedEntityIds: [22] }), false);
  }
});


test("transfer read/create/decision summary excludes leave and payroll evidence", () => {
  const sealed = {
    id: 44, organizationId: 7, employeeId: 101,
    fromLegalEntityId: 11, toLegalEntityId: 22,
    effectiveDate: "2026-11-01", status: "pending_approval",
    requestedByUserId: 52,
    reason: "contains private person details",
    serviceStartDate: "2012-06-01",
    leaveSnapshot: [{ leaveType: "vacation", pending: 8 }],
    thirteenthSnapshot: { sourceBasicSalaryEarned: "142345.67", lineItems: [{ gross: "9999.99" }] },
    continuityNote: "confidential",
    approvedByUserId: null,
  };
  assert.deepEqual(summarizeEntityTransfer(sealed), {
    id: 44, employeeId: 101, fromLegalEntityId: 11,
    toLegalEntityId: 22, effectiveDate: "2026-11-01",
    status: "pending_approval", requestedByUserId: 52,
  });
  const serialized = JSON.stringify({ transfer: summarizeEntityTransfer(sealed) });
  for (const secret of ["142345.67", "9999.99", "vacation", "confidential", "private person"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("legal employer confirmation fails closed for missing, different or partial names", () => {
  for (const value of ["", "Alpha", "alpha manufacturing inc.", "Beta Services Corp.", "Alpha Manufacturing Inc"]) {
    assert.equal(entityConfirmationMatches("Alpha Manufacturing Inc.", value), false);
  }
  assert.equal(entityConfirmationMatches("Alpha Manufacturing Inc.", "Alpha Manufacturing Inc."), true);
});

test("group payroll cost totals use exact centavos, including negatives and large sums", () => {
  assert.equal(sumPayrollAmounts(["0", "0.00", "100.01", "-0.01"]), "100.00");
  assert.equal(sumPayrollAmounts(["9007199254740992.01", "0.02"]), "9007199254740992.03");
  assert.equal(sumPayrollAmounts(["0.0000"]), "0.00");
  assert.equal(sumPayrollAmounts(["-0.01", "-0.02"]), "-0.03");
  for (const invalid of ["", "1e4", "Infinity", "NaN", "1.005", "0.00400", "1,000.00"]) {
    assert.throws(() => sumPayrollAmounts([invalid]), /not a valid decimal|sub-centavo/);
  }
});


test("group reports refuse non-null foreign and orphan employer attribution instead of dropping money", () => {
  const legalEntityIds = [11, 22];
  const actualPeople = [{ legalEntityId: 11, total: 2 }, { legalEntityId: 22, total: 1 }];
  const released = [{ legalEntityId: 11, runs: 1 }, { legalEntityId: 22, runs: 3 }];
  assert.equal(groupReportHasUnattributedRows(legalEntityIds, actualPeople, released), false);
  // Inactive historical legal employers remain valid when included in the
  // requesting tenant's server-owned legal-entity inventory.
  assert.equal(groupReportHasUnattributedRows([11, 22, 55],
    [...actualPeople, { legalEntityId: 55, total: 1 }], released), false);
  for (const badEntityId of [null, 33, 999999, -1, 0, 1.5]) {
    assert.equal(groupReportHasUnattributedRows(legalEntityIds,
      [...actualPeople, { legalEntityId: badEntityId, total: 1 }], released), true);
    assert.equal(groupReportHasUnattributedRows(legalEntityIds, actualPeople,
      [...released, { legalEntityId: badEntityId, runs: 1 }]), true);
  }
  assert.equal(groupReportHasUnattributedRows(legalEntityIds,
    [...actualPeople, { legalEntityId: null, total: 0 }],
    [...released, { legalEntityId: 33, runs: 0 }]), false);
});

test("employer profile patch rejects masked, empty and incomplete statutory or bank identities", () => {
  const accepted = validateEmployerProfileChanges({
    birTin: "123-456-789", birBranchCode: "12",
    disbursementBankCode: "bpi", disbursementAccountName: "Company Payroll",
    disbursementAccount: "1234567890",
  });
  assert.deepEqual(accepted, { ok: true, changes: {
    birTin: "123456789", birBranchCode: "0012",
    disbursementBankCode: "BPI", disbursementAccountName: "Company Payroll",
    disbursementAccount: "1234567890",
  }, changedFields: ["birTin", "birBranchCode", "disbursementBankCode",
    "disbursementAccountName", "disbursementAccount"] });
  for (const invalid of [
    {}, { birTin: "" }, { birTin: "••••1234" }, { birTin: "abcdefghi" },
    { birBranchCode: "" }, { birBranchCode: "abcd" },
    { birBranchCode: "12345" }, { disbursementAccount: "1234567890" },
    { disbursementAccount: "••••7890" }, { legalName: "" },
    { registeredAddress: "a" }, { legalName: null }, { unknownField: "value" },
    { disbursementBankCode: "BPI", disbursementAccountName: "Company" },
  ]) {
    assert.equal(validateEmployerProfileChanges(invalid).ok, false, JSON.stringify(invalid));
  }
});

test("registration release flag is default off and exact-true only", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "true "]) {
    assert.equal(criticalReleaseFlagEnabled("multiEntityRegistrations", {
      MULTI_ENTITY_REGISTRATIONS_ENABLED: value,
    }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("multiEntityRegistrations", {
    MULTI_ENTITY_REGISTRATIONS_ENABLED: "true",
  }), true);
});

test("flag-off entity widgets preserve empty legacy markup, including no switcher", () => {
  assert.equal(renderToStaticMarkup(createElement(EntityBadge, { legalEntityId: 11 })), "");
  assert.equal(renderToStaticMarkup(createElement(EntitySwitcher, { organizationId: 1 })), "");
  assert.equal(renderToStaticMarkup(createElement(EntityFilter, { organizationId: 1 })), "");
});

test("group-only switcher visibility is executed in server-rendered React", () => {
  const groupMarkup = renderToStaticMarkup(createElement(EntitySwitcher, { organizationId: 1, context: group }));
  const scopeMarkup = renderToStaticMarkup(createElement(EntitySwitcher, { organizationId: 1, context: scoped }));
  assert.match(groupMarkup, /Legal entity switcher/);
  assert.match(groupMarkup, /All entities/);
  assert.match(groupMarkup, /Beta/);
  assert.doesNotMatch(scopeMarkup, /<select/);
  assert.doesNotMatch(scopeMarkup, /All entities/);
  assert.match(scopeMarkup, /Assigned legal employer/);
  const badge = renderToStaticMarkup(createElement(EntityBadge, { legalEntityId: 22, context: group }));
  assert.match(badge, /Beta/);
  assert.doesNotMatch(badge, /Alpha Manufacturing Inc/);
});

test("multi-granted admin sees a selected-entity switcher without group totals or All", () => {
  const admin = { enabled: true as const, group: false, canSwitch: true,
    role: "owner", legalEntityId: 11, entities };
  const markup = renderToStaticMarkup(createElement(EntitySwitcher, {
    organizationId: 1, context: admin,
  }));
  assert.match(markup, /Legal entity switcher/);
  assert.match(markup, /Alpha/);
  assert.match(markup, /Beta/);
  assert.doesNotMatch(markup, /All entities/);
  const filterMarkup = renderToStaticMarkup(createElement(EntityFilter, {
    organizationId: 1, context: admin,
  }));
  assert.match(filterMarkup, /Legal entity switcher/);
  const scopedMarkup = renderToStaticMarkup(createElement(EntityFilter, {
    organizationId: 1, context: scoped,
  }));
  assert.equal(scopedMarkup, "");
});

test("legal employer identity and payout changes cannot overwrite a legacy registration", () => {
  for (const field of VERSIONED_EMPLOYER_FIELDS) {
    for (const value of ["changed", "", null]) {
      assert.deepEqual(
        validateLegalEmployerSettingsPatch({
          organizationId: 1, legalEntityId: 11, payrollCalendarMode: "flexible", [field]: value,
        }),
        { ok: false, code: "VERSIONED_REGISTRATION_REQUIRED" },
        field,
      );
    }
  }
  assert.deepEqual(validateLegalEmployerSettingsPatch({
    organizationId: 1, legalEntityId: 11, payrollCalendarMode: "ph_semi_monthly",
  }), { ok: true, payrollCalendarMode: "ph_semi_monthly" });
  for (const bad of [null, [], {}, { organizationId: 1, legalEntityId: 11 },
    { organizationId: 1, legalEntityId: 11, payrollCalendarMode: "weekly" },
    { organizationId: 1, legalEntityId: 11, payrollCalendarMode: "flexible", extraField: "ignore-me" },
  ]) {
    assert.deepEqual(validateLegalEmployerSettingsPatch(bad),
      { ok: false, code: "INVALID_SETTINGS_PATCH" });
  }
});

test("cross-employer transfer mutations have an independent default-off gate", () => {
  for (const value of [undefined, "", "1", "TRUE", "false", "true "]) {
    assert.equal(criticalReleaseFlagEnabled("multiEntityTransfers",
      { MULTI_ENTITY_ENABLED: "true", MULTI_ENTITY_TRANSFERS_ENABLED: value }), false);
  }
  assert.equal(criticalReleaseFlagEnabled("multiEntityTransfers",
    { MULTI_ENTITY_TRANSFERS_ENABLED: "true" }), true);
});

test("flagged multi-entity blocks every legacy employer creation, update, primary switch and unscopeable directory", () => {
  const route = readFileSync("src/app/api/legal-entities/route.ts", "utf8");
  // All POST and PATCH variants must authorize the actor and require MFA
  // before rejecting the legacy write, never executing business mutations.
  const post = route.split("export async function POST(request: Request) {")[1];
  const patch = route.split("export async function PATCH(request: Request) {")[1];
  assert.ok(post && patch);
  for (const operation of [post, patch]) {
    assert.ok(operation.indexOf("const denied = await requireAdmin(")
      < operation.indexOf('if (criticalReleaseFlagEnabled("multiEntity"))'),
      "membership and role must be checked before disclosing the feature hold");
    assert.ok(operation.indexOf('if (criticalReleaseFlagEnabled("multiEntity"))')
      < operation.indexOf('if (action === "assign_employee")')
      || operation.indexOf('if (action === "assign_employee")') === -1,
      "legacy mutation must fail before any legal-employer state changes");
    assert.match(operation, /VERSIONED_REGISTRATION_REQUIRED/);
  }
  const get = route.split("export async function GET(request: Request) {")[1]?.split("export async function POST")[0];
  assert.ok(get, "directory handler must exist");
  assert.ok(get.includes('criticalReleaseFlagEnabled("multiEntity") && !selectorMode'));
  assert.ok(get.indexOf("await ensurePrimaryLegalEntity(organizationId)")
    > get.indexOf("if (selectorMode)"),
    "unauthenticated directory GET must never bootstrap a legal employer");
});

test("employer transfer history totals retain every centavo over many source cutoffs", () => {
  const tinyPeriods = Array.from({ length: 1001 }, () => "0.01");
  assert.equal(sumPayrollAmounts(tinyPeriods), "10.01");
  assert.equal(sumPayrollAmounts([...tinyPeriods, "-0.02", "123456789.99"]), "123456799.98");
  assert.throws(() => sumPayrollAmounts(["100.00", "0.001"]), /sub-centavo/);
  // The transfer stores these exact summed decimal strings as review-only
  // evidence and does not change released payroll calculations.
  const source = readFileSync("src/app/api/multi-entity/transfers/route.ts", "utf8");
  assert.match(source, /sourceBasic = sumPayrollAmounts\(basicAmounts\)/);
  assert.match(source, /source13thPaid = sumPayrollAmounts\(paidThirteenthAmounts\)/);
});

test("tenant-authorized secondary Entities navigation remains clickable after More expands", () => {
  const css = readFileSync("src/app/workspace-theme.css", "utf8");
  const shell = readFileSync("src/components/workspace/shell.tsx", "utf8");
  // These old Overview allowlists hid authorized secondary links with a more
  // specific !important selector, overriding the current React navigation.
  assert.doesNotMatch(css, /\.app-shell:has\(\.payrollph-dashboard\) \.nav-item\[data-nav-name\]:not\(/);
  assert.doesNotMatch(css, /\.app-shell\[data-workspace-page="Overview"\] \.side-navigation \.nav-item:not\(/);
  assert.match(shell, /tenantNavigationGroups\(/);
  assert.match(shell, /secondaryItems/);
  assert.match(shell, /moreOpen \|\| secondaryHasCurrent/);
  assert.match(css, /\.app-shell \.nav-more-items \{/);
});
