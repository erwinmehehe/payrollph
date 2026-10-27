import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { recordedPeopleHomeInstant } from "../src/lib/hcm-people-home-instant";

test("People Home keeps valid recorded UTC and PH-offset instants", () => {
  assert.equal(recordedPeopleHomeInstant("2024-02-29T12:00:00.000Z"),
    "2024-02-29T12:00:00.000Z");
  assert.equal(recordedPeopleHomeInstant("2024-02-29T12:30:00+08:00"),
    "2024-02-29T04:30:00.000Z");
  assert.equal(recordedPeopleHomeInstant(new Date("2026-10-27T13:00:00Z")),
    "2026-10-27T13:00:00.000Z");
  assert.equal(recordedPeopleHomeInstant(null), null);
  assert.equal(recordedPeopleHomeInstant(undefined), null);
});

test("People Home never turns an invalid deadline into a different valid calendar date", () => {
  for (const invalid of [
    "2026-02-30T12:00:00Z", "2025-02-29T12:00:00Z",
    "2026-04-31T12:00:00Z", "2026-13-01T12:00:00Z",
    "2026-10-27T24:00:00Z", "2026-10-27T12:60:00Z",
    "2026-10-27T12:00:60Z", "2026-10-27T12:00:00",
    "2026-10-27", "1", "2026-10-27T12:00:00+25:00",
    "2026-10-27T12:00:00+08:60", "",
  ]) assert.equal(recordedPeopleHomeInstant(invalid), null, invalid);
  assert.equal(recordedPeopleHomeInstant(new Date(Number.NaN)), null);
});

test("read-only People Home decisions and owned cases use the same verified instant gate", () => {
  const projection = readFileSync("src/lib/hcm-people-home-worklist.ts", "utf8");
  assert.match(projection, /import \{ recordedPeopleHomeInstant as recordedInstant \} from/);
  assert.equal((projection.match(/dueAt: recordedInstant\(item\.dueAt\)/g) ?? []).length, 2);
  assert.match(projection, /recordedSourceDate\(item\.dueDate\)/,
    "the separate date-only lifecycle validator must remain intact");
  for (const mutation of ["db.update(", "db.insert(", "db.delete("]) {
    assert.ok(!projection.includes(mutation), "read projection cannot introduce writes");
  }
});
