import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationDate } from "../src/lib/migration-date";
import { parseMigrationCsv } from "../src/lib/migration-import";

test("calendar dates stay intact in either numeric order and named-month exports", () => {
  for (const raw of ["01/15/2024", "15/01/2024", "15-Jan-2024", "2024-01-15"]) {
    assert.equal(parseMigrationDate(raw), "2024-01-15", raw);
  }
  assert.equal(parseMigrationDate("2024-02-29"), "2024-02-29");
});
test("impossible, ambiguous and timestamp values cannot silently become hire dates", () => {
  for (const raw of ["03/04/2024", "2023-02-29", "2024-02-30", "31/04/2024", "13/13/2024", "2024-01-15T23:00:00-08:00", "15-Januaryoops-2024", "15-Janfoo-2024"]) {
    assert.equal(parseMigrationDate(raw), null, raw);
  }
  const parsed = parseMigrationCsv({ source: "generic", kind: "employees", csv: "Employee ID,First Name,Last Name,Basic Salary,Hire Date\nE-1,Ana,Reyes,30000,03/04/2024" });
  assert.equal(parsed.rows.length, 0);
  assert.match(parsed.errors[0].problems.join(" "), /ambiguous.*YYYY-MM-DD/);
});
