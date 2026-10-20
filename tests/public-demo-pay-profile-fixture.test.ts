import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { verifiedFictionalPayProfileRows } from "../src/lib/public-demo-pay-profile-fixture";

const people = [
  ["Mariel", "Santos", "38500.00"],
  ["Jonas", "Reyes", "29200.00"],
  ["Aira", "Villanueva", "36500.00"],
  ["Paolo", "Cruz", "32500.00"],
  ["Nina", "Garcia", "24500.00"],
  ["Rico", "Mendoza", "21800.00"],
  ["Trish", "Dela Cruz", "41000.00"],
  ["Eli", "Tan", "34800.00"],
].map(([firstName, lastName, basicRate]) => ({ firstName, lastName, basicRate }));

function staff() {
  return people.map((person, index) => ({
    id: index + 41,
    organizationId: 1,
    employeeNo: "LL-" + String(index + 101).padStart(3, "0"),
    firstName: person.firstName,
    lastName: person.lastName,
    email: (person.firstName + "." + person.lastName)
      .toLowerCase().replace(/[^a-z.]/g, "") + "@linaw.ph",
    basicRate: person.basicRate,
  }));
}

test("complete fictional roster derives eight exact monthly pay profiles", () => {
  const rows = verifiedFictionalPayProfileRows(1, staff(), people);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], {
    employeeId: 41, organizationId: 1, payBasis: "monthly",
    rateAmount: "38500.00", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  });
  assert.equal(rows[7].rateAmount, "34800.00");
  assert.deepEqual(rows.map(row => row.employeeId), [41, 42, 43, 44, 45, 46, 47, 48]);
});

test("incomplete, extra, and duplicate fictional rosters fail closed", () => {
  const original = staff();
  for (const changed of [
    original.slice(1),
    [...original, { ...original[0], id: 88, employeeNo: "OTHER" }],
    original.map((row, i) => i === 6 ? { ...row, employeeNo: original[0].employeeNo } : row),
    original.map((row, i) => i === 6 ? { ...row, id: original[0].id } : row),
  ]) assert.throws(
    () => verifiedFictionalPayProfileRows(1, changed, people), /ROSTER_UNVERIFIED/,
  );
});

test("foreign tenant, altered worker identity, and changed pay fail closed", () => {
  const original = staff();
  for (const patch of [
    { organizationId: 2 }, { employeeNo: "LL-999" }, { firstName: "Customer" },
    { email: "person@example.com" }, { basicRate: "0.01" },
  ]) {
    const changed = original.map((row, i) => i === 0 ? { ...row, ...patch } : row);
    assert.throws(
      () => verifiedFictionalPayProfileRows(1, changed, people), /ROSTER_UNVERIFIED/,
    );
  }
  assert.throws(() => verifiedFictionalPayProfileRows(0, original, people), /ROSTER_UNVERIFIED/);
  assert.throws(() => verifiedFictionalPayProfileRows(1, original, people.slice(1)), /ROSTER_UNVERIFIED/);
  assert.throws(() => verifiedFictionalPayProfileRows(1, original,
    people.map((person, i) => i === 0 ? { ...person, basicRate: "-5.00" } : person)
  ), /ROSTER_UNVERIFIED/);
});

test("public demo creates missing profiles without weakening real-employer read-only gates", () => {
  const demo = readFileSync("src/db/public-demo.ts", "utf8");
  const readOnly = readFileSync("src/lib/pay-basis-schema.ts", "utf8");
  assert.match(demo, /verifiedFictionalPayProfileRows\(organization\.id, staff, people\)/);
  assert.match(demo, /insert\(employeePayProfiles\)[\s\S]*?onConflictDoNothing\(\{\s*target:\s*employeePayProfiles\.employeeId\s*\}\)/);
  assert.match(demo, /PUBLIC_DEMO_PAY_PROFILE_INCOMPLETE/);
  assert.match(demo, /ne\(organizations\.name, PUBLIC_DEMO_ORG\)/);
  assert.match(demo, /if \(organization\.legalName !== "Loom & Local Philippines Inc\."\)/);
  assert.match(readOnly, /READONLY_PAY_PROFILES_REQUIRE_REVIEWED_BACKFILL/);
});
