import assert from "node:assert/strict";
import test from "node:test";
import { buildRotationTemplateDraft } from "../src/lib/workforce-rotation-template";

const pattern = { id: 4, code: "BPO-DAY", name: "BPO daytime", cycleDays: 7 };
const patterns = [pattern];
const days = Array.from({ length: 7 }, (_, i) => ({
  id: i + 10, patternId: 4, dayIndex: i, isRestDay: i >= 5,
}));
const segments = days.slice(0, 5).map(day => ({
  patternDayId: day.id, segmentOrder: 1, shiftDefinitionId: 99,
}));
const base = { pattern, patterns, days, segments, shiftIds: [99] };

test("a seven-day rotation is copied into an editable, unassigned draft", () => {
  const outcome = buildRotationTemplateDraft(base);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.code, "BPO-DAY-COPY-1");
  assert.deepEqual(outcome.choices, ["99", "99", "99", "99", "99", "REST", "REST"]);
  assert.equal(outcome.name, "BPO daytime (copy)");
});

test("the copy code remains unique when prior copies exist", () => {
  const existing = { ...pattern, id: 15, code: "BPO-DAY-COPY-1" };
  const result = buildRotationTemplateDraft({ ...base, patterns: [pattern, existing] });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.code, "BPO-DAY-COPY-2");
});

test("split shift days, missing shift IDs and inconsistent rest days fail closed", () => {
  const extra = { patternDayId: 10, segmentOrder: 2, shiftDefinitionId: 99 };
  const split = buildRotationTemplateDraft({ ...base, segments: [...segments, extra] });
  assert.equal(split.ok, false);
  const missing = buildRotationTemplateDraft({ ...base, shiftIds: [] });
  assert.equal(missing.ok, false);
  const restDaySegment = { patternDayId: 15, segmentOrder: 1, shiftDefinitionId: 99 };
  assert.equal(buildRotationTemplateDraft({ ...base, segments: [...segments, restDaySegment] }).ok, false);
});

test("wrong cycle length or incomplete/duplicate days never create a draft", () => {
  assert.equal(buildRotationTemplateDraft({
    ...base, pattern: { ...pattern, cycleDays: 14 },
    patterns: [{ ...pattern, cycleDays: 14 }],
  }).ok, false);
  assert.equal(buildRotationTemplateDraft({ ...base, days: days.slice(1) }).ok, false);
  assert.equal(buildRotationTemplateDraft({
    ...base, days: days.map((day, i) => i === 1 ? { ...day, dayIndex: 0 } : day),
  }).ok, false);
});

test("a rotation outside the visible catalog is not copied", () => {
  assert.equal(buildRotationTemplateDraft({ ...base, patterns: [] }).ok, false);
});
