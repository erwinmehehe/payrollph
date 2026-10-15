import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  projectCompensationReadCatalogs,
  visibleCompensationCommittedIncrease,
  type CompensationCatalogAccess,
} from "../src/lib/hcm-compensation-read-projection";

const workers = [
  {
    id: 1, organizationId: 10, orgUnitId: 101,
    legalEntityId: 701, region: "PH", jobProfileId: 501,
    gradeId: 601, salaryBand: { id: 801 },
  },
  {
    id: 2, organizationId: 10, orgUnitId: 102,
    legalEntityId: 702, region: "NCR", jobProfileId: 502,
    gradeId: 602, salaryBand: { id: 802 },
  },
  {
    id: 3, organizationId: 11, orgUnitId: 110,
    legalEntityId: 703, region: "PH", jobProfileId: 503,
    gradeId: 603, salaryBand: { id: 803 },
  },
];
const positions = [
  {
    id: 401, organizationId: 10, code: "TEAM-A", jobProfileId: 501,
    orgUnitId: 101, legalEntityId: 701, status: "approved",
    plannedStartDate: null, annualBudget: "1111111.11",
    notes: "PRIVATE TEAM A PLAN",
  },
  {
    id: 402, organizationId: 10, code: "TEAM-B", jobProfileId: 502,
    orgUnitId: 102, legalEntityId: 702, status: "approved",
    plannedStartDate: null, annualBudget: "9876543.21",
    notes: "PRIVATE OTHER UNIT PLAN",
  },
  {
    id: 403, organizationId: 11, code: "OTHER-EMPLOYER", jobProfileId: 503,
    orgUnitId: 110, legalEntityId: 703, status: "approved",
    plannedStartDate: null, annualBudget: "8765432.10",
    notes: "PRIVATE OTHER EMPLOYER PLAN",
  },
];
const grades = [
  { id: 601, organizationId: 10, code: "G1", name: "Worker grade", sequence: 1, active: true },
  { id: 602, organizationId: 10, code: "G2", name: "Other unit grade", sequence: 2, active: true },
  { id: 603, organizationId: 11, code: "G3", name: "Foreign grade", sequence: 3, active: true },
];
const profiles = [
  { id: 501, organizationId: 10, title: "Team A job", family: "Operations", level: "I",
    gradeId: 601, grade: "G1", active: true },
  { id: 502, organizationId: 10, title: "Team B private job", family: "Finance", level: "II",
    gradeId: 602, grade: "G2", active: true },
  { id: 503, organizationId: 11, title: "Other employer job", family: "HR", level: "III",
    gradeId: 603, grade: "G3", active: true },
];
const entities = [
  { id: 701, organizationId: 10, code: "A", displayName: "Team A employer", active: true,
    birTin: "123-000-000", disbursementAccount: "PRIVATE-BANK-ACCOUNT-111" },
  { id: 702, organizationId: 10, code: "B", displayName: "Other unit employer", active: true,
    birTin: "234-000-000", disbursementAccount: "PRIVATE-BANK-ACCOUNT-222" },
  { id: 703, organizationId: 11, code: "C", displayName: "Other employer", active: true,
    birTin: "345-000-000", disbursementAccount: "PRIVATE-BANK-ACCOUNT-333" },
];
const bands = [
  { id: 801, organizationId: 10, jobProfileId: 501, gradeId: 601, legalEntityId: 701,
    locationCode: "PH", currency: "PHP", minimumAnnual: "200000.00",
    midpointAnnual: "300000.00", maximumAnnual: "400000.00",
    effectiveFrom: "2026-01-01", effectiveUntil: null, active: true },
  { id: 802, organizationId: 10, jobProfileId: 502, gradeId: 602, legalEntityId: 702,
    locationCode: "NCR", currency: "PHP", minimumAnnual: "900000.00",
    midpointAnnual: "950000.00", maximumAnnual: "990000.00",
    effectiveFrom: "2026-01-01", effectiveUntil: null, active: true },
  { id: 803, organizationId: 11, jobProfileId: 503, gradeId: 603, legalEntityId: 703,
    locationCode: "PH", currency: "PHP", minimumAnnual: "1700000.00",
    midpointAnnual: "1800000.00", maximumAnnual: "1900000.00",
    effectiveFrom: "2026-01-01", effectiveUntil: null, active: true },
];
const cycles = [
  { id: 901, organizationId: 10, name: "Main employer review", startDate: "2026-10-01",
    endDate: "2026-11-30", effectiveDate: "2026-12-15",
    status: "active", budgetPool: "876543.21" },
  { id: 902, organizationId: 11, name: "Other employer review", startDate: "2026-10-01",
    endDate: "2026-11-30", effectiveDate: "2026-12-15",
    status: "active", budgetPool: "765432.10" },
];
const raw = {
  workers,
  proposals: [{ employeeId: 1, bandId: 801 }, { employeeId: 2, bandId: 802 }],
  assignments: [{ employeeId: 1, positionId: 401 }, { employeeId: 2, positionId: 402 }],
  positions, jobProfiles: profiles, jobGrades: grades, legalEntities: entities, bands, cycles,
};
const companyWide: CompensationCatalogAccess = {
  organizationId: 10, companyWide: true, orgUnitId: null,
};
const unit: CompensationCatalogAccess = {
  organizationId: 10, companyWide: false, orgUnitId: 101,
};

test("scoped HR HTTP JSON excludes company-wide budget, bank, statutory and other-unit pay", async () => {
  const projected = projectCompensationReadCatalogs({ ...raw, access: unit });
  const response = Response.json({ access: unit, ...projected });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.cycles.length, 1);
  assert.equal(body.cycles[0].id, 901);
  assert.equal(body.cycles[0].budgetPool, null,
    "Budget must be redacted, never zeroed or inferred from the unit's proposals.");
  assert.deepEqual(body.legalEntities, [{ id: 701, code: "A", displayName: "Team A employer" }]);
  assert.deepEqual(body.positions.map((p: { id: number }) => p.id), [401]);
  assert.deepEqual(body.bands.map((p: { id: number }) => p.id), [801]);
  assert.deepEqual(body.jobProfiles.map((p: { id: number }) => p.id), [501]);
  assert.deepEqual(body.jobGrades.map((p: { id: number }) => p.id), [601]);
  const serialized = await Response.json(body).text();
  for (const forbidden of [
    "876543.21", "765432.10", "9876543.21", "1111111.11",
    "PRIVATE-BANK-ACCOUNT", "birTin", "disbursementAccount",
    "PRIVATE OTHER UNIT PLAN", "Team B private job", "950000.00",
    "Other unit employer", "Other employer", "1700000.00",
  ]) assert.ok(!serialized.includes(forbidden), "Leaked: " + forbidden);
  assert.ok(serialized.includes("200000.00"),
    "A visible worker's legitimate salary band must remain accessible.");
});

test("company-wide HR keeps authorized cycle budget, not disbursement secrets", async () => {
  const projected = projectCompensationReadCatalogs({ ...raw, access: companyWide });
  const body = await Response.json(projected).json();
  assert.equal(body.cycles.length, 1);
  assert.equal(body.cycles[0].budgetPool, "876543.21");
  assert.deepEqual(body.bands.map((p: { id: number }) => p.id), [801, 802]);
  assert.deepEqual(body.positions.map((p: { id: number }) => p.id), [401, 402]);
  assert.deepEqual(body.legalEntities.map((p: { id: number }) => p.id), [701, 702]);
  const text = JSON.stringify(body);
  for (const forbidden of [
    "PRIVATE-BANK-ACCOUNT", "birTin", "disbursementAccount",
    "9876543.21", "1111111.11", "PRIVATE OTHER UNIT PLAN", "765432.10",
  ]) assert.ok(!text.includes(forbidden), "Unexpected serialized sensitive field: " + forbidden);
});

test("missing unit or invalid employer scopes expose no catalogs", async () => {
  for (const access of [
    { ...unit, orgUnitId: null },
    { ...unit, organizationId: 0 },
    { ...companyWide, organizationId: 0 },
  ]) {
    const payload = projectCompensationReadCatalogs({ ...raw, access });
    assert.deepEqual(Object.values(payload).map((rows) => rows.length), [0, 0, 0, 0, 0, 0],
      "No unrelated employer catalogs may be returned.");
  }
});

test("source GET enforces org role before projecting only allowlisted catalog and employee fields", () => {
  const code = readFileSync("src/app/api/compensation/route.ts", "utf8");
  const get = code.slice(code.indexOf("export async function GET("), code.indexOf("export async function POST("));
  const role = get.indexOf("await assertOrganizationRole(user.id, organizationId, COMPENSATION_MANAGER_ROLES");
  const scope = get.indexOf("const access = await getAccess(user.id, organizationId)");
  const dbQuery = get.indexOf("const [");
  const projected = get.indexOf("projectCompensationReadCatalogs({");
  const response = get.indexOf("return Response.json({", projected);
  const payload = get.slice(response);
  assert.ok(role > 0 && scope > role && dbQuery > scope && projected > dbQuery && response > projected);
  assert.match(get.slice(scope, dbQuery), /!access\.companyWide && \(!access\.orgUnitId \|\| !access\.orgUnitName\)/);
  for (const safeCatalog of ["cycles","positions","legalEntities","bands","jobProfiles","jobGrades"]) {
    assert.ok(get.includes(safeCatalog + ": catalog." + safeCatalog), "Missing safe " + safeCatalog);
  }
  assert.ok(get.includes("employees: enrichedEmployees.map("));
  assert.ok(get.includes("const scopedProposals = proposals.filter((row) => visibleIds.has(row.employeeId))"));
  assert.ok(get.includes("proposals: scopedProposals.map("));
  assert.ok(get.includes("componentAssignments: componentAssignments.filter((row) => visibleIds.has(row.employeeId))"));
  assert.ok(!payload.includes("legalEntities: entities,"));
  assert.ok(!payload.includes("positions: positionRows,"));
  assert.ok(!payload.includes("cycles,\n    proposals:"));
  const projection = readFileSync("src/lib/hcm-compensation-read-projection.ts", "utf8");
  for(const mutator of ["db.insert(", "db.update(", "db.delete(", "fetch(", "process.env"]) {
    assert.ok(!projection.includes(mutator), "Projection cannot write or fetch.");
  }
});


test("unit-scoped committed increases are centavo-safe, visible-only and not a budget", () => {
  const rows = [
    {id: 1, cycleId: 9, status: "scheduled", currentAnnual: "200000.00", proposedAnnual: "212345.67"},
    {id: 2, cycleId: 9, status: "applied", currentAnnual: "100000.00", proposedAnnual: "101000.01"},
    {id: 3, cycleId: 9, status: "proposed", currentAnnual: "0.00", proposedAnnual: "99999.99"},
    {id: 4, cycleId: 9, status: "cancelled", currentAnnual: "0.00", proposedAnnual: "19999.99"},
    {id: 5, cycleId: 9, status: "scheduled", currentAnnual: "120000.00", proposedAnnual: "110000.00"},
    {id: 6, cycleId: 12, status: "scheduled", currentAnnual: "0.00", proposedAnnual: "987654.32"},
  ];
  assert.equal(visibleCompensationCommittedIncrease(9, rows), 13345.68);
  assert.equal(visibleCompensationCommittedIncrease(12, rows), 987654.32);
  assert.equal(visibleCompensationCommittedIncrease(null, rows), null);
  assert.equal(visibleCompensationCommittedIncrease(9, [rows[0], rows[0]]), null);
  assert.equal(visibleCompensationCommittedIncrease(9, [
    {...rows[0], proposedAnnual: "212345.678"},
  ]), null);
  assert.equal(visibleCompensationCommittedIncrease(9, [
    {...rows[0], status: "unknown"},
  ]), null);
  const panel = readFileSync("src/components/compensation-panel.tsx", "utf8");
  assert.match(panel, /access\?\.companyWide\s*\?\s*summarizeCompensationCycleBudget/);
  assert.ok(panel.includes("visibleCompensationCommittedIncrease(activeCycle?.id ?? null, proposals)"));
  assert.ok(panel.includes("organization budget is restricted"));
});
