import test from "node:test";
import assert from "node:assert/strict";
import {
  assertHolidayList, assertHolidayDenial, assertHolidayUnchanged, assertHolidayTransition,
} from "../scripts/qa/tenant-holidays-contract.mjs";

const wide = {
  id: 12, organizationId: 7, holidayDate: "2040-06-05",
  name: "Fictional owned holiday", kind: "regular", orgUnitId: null, worksiteId: null,
};
const scoped = {
  id: 14, organizationId: 7, holidayDate: "2040-06-08",
  name: "Fictional own unit holiday", kind: "special", orgUnitId: 23, worksiteId: 42,
};
const expected = {
  organizationId: 7, rows: [wide, scoped],
  forbiddenIds: [199, 211], forbiddenMarkers: ["VICTIM-COMPANY"],
};
function read(rows = [wide, scoped], status = 200, textSuffix = "") {
  const json = { holidays: rows };
  return { status, json, text: JSON.stringify(json) + textSuffix,
    headers: new Headers() };
}
function noLeak(status = 403, text = '{"error":"Forbidden."}', headers = new Headers()) {
  return { status, text, headers, json: {} };
}
const before = {
  organization: [{ id: 7 }],
  employees: [{ id: 17, organizationId: 7 }],
  memberships: [{ id: 19, organizationId: 7, role: "owner" }],
  units: [{ id: 23, organizationId: 7 }],
  worksites: [{ id: 42, organizationId: 7 }],
  payrollRuns: [{ id: 99, organizationId: 7, status: "Released" }],
  payrollEntries: [{ entry: { id: 61, payrollRunId: 99 } }],
  approvalTasks: [{ id: 81, organizationId: 7, status: "Pending" }],
  holidays: [wide, scoped],
  audit: [],
};
const ownDetails = {
  organizationId: 7, ownerName: "Synthetic Owner",
  holidayDate: "2040-06-15", name: "Owned fresh holiday",
  kind: "special", orgUnitId: 23, worksiteId: 42, releasedRunId: 99,
};
const newRow = {
  id: 40, ...Object.fromEntries(Object.entries(ownDetails)
    .filter(([key]) => !["ownerName", "releasedRunId"].includes(key))),
};
function altered(action) {
  const next = structuredClone(before);
  if (action === "create") next.holidays.push(newRow);
  if (action === "update") next.holidays[1].name = "Owned changed holiday";
  if (action === "delete") next.holidays = next.holidays.filter(x => x.id !== scoped.id);
  next.audit.push({
    id: 150, organizationId: 7, actor: ownDetails.ownerName,
    action: {
      create: "Payroll holiday declared", update: "Payroll holiday updated",
      delete: "Payroll holiday removed",
    }[action],
    metadata: { holidayId: action === "create" ? 40 : scoped.id,
      invalidatedPayrollRunIds: [], releasedPayrollRunIdsRequiringRetroReview: [99] },
  });
  return next;
}
const created = {
  action: "create", ...ownDetails, holidayId: newRow.id,
};
const patched = {
  action: "update", organizationId: 7, ownerName: "Synthetic Owner",
  holidayId: scoped.id, holidayDate: scoped.holidayDate,
  name: "Owned changed holiday", kind: scoped.kind,
  orgUnitId: scoped.orgUnitId, worksiteId: scoped.worksiteId, releasedRunId: 99,
};
const deleted = {
  action: "delete", organizationId: 7, ownerName: "Synthetic Owner",
  holidayId: scoped.id, releasedRunId: 99,
};
const createResponse = { status: 201, json: newRow };
const patchedResponse = { status: 200, json: { ...scoped, name: "Owned changed holiday" } };
const deletedResponse = { status: 200, json: { ok: true } };

test("a real populated owned holiday list passes", () => {
  assert.doesNotThrow(() => assertHolidayList(read(), expected));
});
test("a fake empty 200 does not count as an owned-data proof", () => {
  assert.throws(() => assertHolidayList(read([]), expected), /exact owned and authorized/);
});
test("an otherwise correct response with a foreign holiday is denied", () => {
  assert.throws(() => assertHolidayList(read([...expected.rows, {
    ...scoped, id: 199, organizationId: 88,
  }]), expected), /exact owned and authorized/);
});
test("a fabricated row carrying the correct ID but wrong employer is denied", () => {
  assert.throws(() => assertHolidayList(read([{ ...wide, organizationId: 88 }, scoped]), expected),
    /another employer/);
});
test("same-tenant peer unit or worksite data substitution is denied", () => {
  assert.throws(() => assertHolidayList(read([wide, { ...scoped, worksiteId: 200 }]), expected),
    /worksiteId/);
});
test("an actual other-company marker in a valid 200 body is denied", () => {
  assert.throws(() => assertHolidayList(read([wide, scoped], 200, "VICTIM-COMPANY"), expected),
    /foreign tenant/);
});
test("a foreign GET status 200 cannot pass a 403 denial contract", () => {
  assert.throws(() => assertHolidayDenial(noLeak(200), 403, ["VICTIM-COMPANY"]),
    /was not rejected/);
});
test("a clean 403 foreign employer denial is allowed", () => {
  assert.doesNotThrow(() => assertHolidayDenial(noLeak(403), 403, ["VICTIM-COMPANY"]));
});
test("foreign company markers in denied response bodies fail", () => {
  assert.throws(() => assertHolidayDenial(noLeak(403, "VICTIM-COMPANY"), 403, ["VICTIM-COMPANY"]),
    /leaked restricted employer data/);
});
test("foreign company markers in denied response headers fail", () => {
  assert.throws(() => assertHolidayDenial(noLeak(403, "Denied",
    new Headers({ "x-error-detail": "VICTIM-COMPANY" })), 403, ["VICTIM-COMPANY"]),
  /in a header/);
});
test("CREATE 201 needs real persisted own row plus one correct audit", () => {
  assert.doesNotThrow(() => assertHolidayTransition(before, altered("create"), createResponse, created));
  assert.throws(() => assertHolidayTransition(before, before, createResponse, created),
    /persist a NEW owned holiday/);
});
test("CREATE success is rejected if the audit omits the actual actor", () => {
  const next = altered("create");
  next.audit[0].actor = "Fake reviewer";
  assert.throws(() => assertHolidayTransition(before, next, createResponse, created),
    /Synthetic Owner|same-value|Expected values to be strictly equal/);
});
test("CREATE success is rejected if released payroll amounts are changed", () => {
  const next = altered("create");
  next.payrollRuns[0].status = "Draft";
  assert.throws(() => assertHolidayTransition(before, next, createResponse, created),
    /payrollRuns/);
});
test("CREATE success is rejected if a different holiday also changes", () => {
  const next = altered("create");
  next.holidays[0].name = "Collateral modified!";
  assert.throws(() => assertHolidayTransition(before, next, createResponse, created),
    /only the explicitly targeted holiday/);
});
test("CREATE success cannot omit retro-review marker for Released payroll", () => {
  const next = altered("create");
  next.audit[0].metadata.releasedPayrollRunIdsRequiringRetroReview = [];
  assert.throws(() => assertHolidayTransition(before, next, createResponse, created),
    /retro review/);
});
test("UPDATE 200 requires an actual changed owned holiday and one audit", () => {
  assert.doesNotThrow(() => assertHolidayTransition(before, altered("update"), patchedResponse, patched));
  assert.throws(() => assertHolidayTransition(before, before, patchedResponse, patched),
    /no-op/);
});
test("UPDATE cannot change an unrelated employee record", () => {
  const next = altered("update");
  next.employees[0].organizationId = 55;
  assert.throws(() => assertHolidayTransition(before, next, patchedResponse, patched),
    /employees/);
});
test("DELETE 200 requires actual removal and a single valid audit", () => {
  assert.doesNotThrow(() => assertHolidayTransition(before, altered("delete"), deletedResponse, deleted));
  assert.throws(() => assertHolidayTransition(before, before, deletedResponse, deleted),
    /actually remove/);
});
test("DELETE cannot silently alter another holiday", () => {
  const next = altered("delete");
  next.holidays[0].name = "Changed another holiday";
  assert.throws(() => assertHolidayTransition(before, next, deletedResponse, deleted),
    /only the explicitly targeted holiday/);
});
test("denied actions must leave all real rows, audit and payroll exactly unchanged", () => {
  assert.doesNotThrow(() => assertHolidayUnchanged(before, structuredClone(before), "denied"));
  assert.throws(() => assertHolidayUnchanged(before, altered("update"), "denied"),
    /must remain unchanged/);
});
