import assert from "node:assert/strict";
import test from "node:test";
import { aggregateAnonymousSurvey, ENGAGEMENT_MIN_GROUP_SIZE } from "../src/lib/engagement-survey-privacy";

test("anonymous survey never exposes groups with fewer than five answers", () => {
  assert.equal(ENGAGEMENT_MIN_GROUP_SIZE, 5);
  const result = aggregateAnonymousSurvey(
    [
      ...Array.from({ length: 4 }, () => ({ group: "Small", score: 5 })),
      ...Array.from({ length: 5 }, (_, i) => ({ group: "Safe", score: i + 1 })),
    ],
    ["Small", "Safe"],
  );
  assert.deepEqual(result, [{ group: "Safe", count: 5, average: 3 }]);
});

test("group permissions apply before aggregation, not after", () => {
  const answers = Array.from({ length: 7 }, () => ({ group: "Secret", score: 5 }));
  assert.deepEqual(aggregateAnonymousSurvey(answers, ["Allowed"]), []);
});

test("survey ratings reject out-of-range and noninteger values", () => {
  for (const score of [0, 6, 1.5, Number.NaN]) {
    assert.throws(
      () => aggregateAnonymousSurvey([{ group: "A", score }], ["A"]),
      /whole-number rating/,
    );
  }
});
