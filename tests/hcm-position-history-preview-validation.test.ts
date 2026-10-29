import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validPositionHistoryResponse } from "../src/lib/hcm-scoped-read-validation";
import { readScopedResponse } from "../src/lib/hcm-scoped-read-failure";

type Assignment = {
  id: number;
  employeeId: number | null;
  assignmentType: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};

function assignment(id: number, effectiveFrom = "2026-10-01"): Assignment {
  return {
    id,
    employeeId: 42,
    assignmentType: "Primary",
    effectiveFrom,
    effectiveUntil: null,
  };
}

function payload(items: Assignment[], hasMore = false, partial = hasMore) {
  return {
    tenantId: 17,
    positionId: 33,
    observedAt: "2026-10-29T01:00:00.000Z",
    position: {
      source: "positions",
      id: 33,
      code: "FIXTURE-POSITION",
      status: "Active",
      currentJobTitle: "Fictional Role",
    },
    history: {
      source: "position_assignments",
      preview: { hasMore, partial, items },
    },
  };
}
const validate = (value: unknown) => validPositionHistoryResponse(value, 17, 33);
const fifty = () => Array.from({ length: 50 }, (_, index) => assignment(100 - index));

test("valid empty, short, 50-row complete, and 50-row truncated previews are retained", () => {
  for (const items of [[], [assignment(1)], [assignment(20), assignment(19)], fifty()]) {
    assert.equal(validate(payload(items, false, false)), true,
      "a terminal page can contain zero through 50 valid descending assignments");
  }
  assert.equal(validate(payload(fifty(), true, true)), true,
    "a full bounded page with additional records must be labeled partial");
  assert.equal(validate(payload([
    assignment(21, "2026-10-20"),
    assignment(20, "2026-10-19"),
    assignment(99, "2026-10-18"),
  ])), true, "descending dates prevail over IDs");
});

test("contradictory preview status and made-up truncated short/empty previews are rejected", () => {
  for (const items of [[], [assignment(1)], fifty()]) {
    assert.equal(validate(payload(items, false, true)), false,
      "partial=true cannot accompany hasMore=false");
  }
  for (const items of [[], [assignment(1)], [assignment(13), assignment(12)]]) {
    assert.equal(validate(payload(items, true, true)), false,
      "hasMore=true requires the complete 50-row bounded preview");
  }
  assert.equal(validate(payload(fifty(), true, false)), false,
    "hasMore=true and partial=false is impossible for the source projector");
  const absent = payload(fifty(), false, false) as unknown as {
    history: { preview: Record<string, unknown> };
  };
  delete absent.history.preview.partial;
  assert.equal(validate(absent), false, "missing partial flag cannot verify completeness");
});

test("position history rejects out-of-order IDs and effective dates, not just duplicates", () => {
  const malformed: Assignment[][] = [
    [assignment(7), assignment(8)],
    [assignment(8), assignment(8)],
    [assignment(10, "2026-10-01"), assignment(9, "2026-10-02")],
    [assignment(10, "2026-10-20"), assignment(9, "2026-10-19"), assignment(8, "2026-10-20")],
  ];
  for (const items of malformed) {
    assert.equal(validate(payload(items)), false,
      "verified history must follow SQL effectiveFrom DESC, assignment ID DESC");
  }
  assert.equal(validate(payload([
    assignment(10, "2026-10-20"),
    assignment(999, "2026-10-19"),
  ])), true, "different dates do not require descending ID");
});

test("existing tenant, position, date and record-shape guards remain strict", () => {
  const valid = payload([assignment(11)]);
  assert.equal(validate({ ...valid, tenantId: 18 }), false);
  assert.equal(validate({ ...valid, positionId: 44 }), false);
  assert.equal(validate({ ...valid, position: { ...valid.position, id: 44 } }), false);
  assert.equal(validate(payload([assignment(11, "2026-02-30")])), false);
  assert.equal(validate(payload([{ ...assignment(11), effectiveUntil: "2026-09-30" }])), false);
  assert.equal(validate(payload([{ ...assignment(11), employeeId: -1 }])), false);
  assert.equal(validate(payload([...fifty(), assignment(50)])), false,
    "an extra row is never a trusted preview");
});

test("HTTP 200 with malformed history metadata becomes unavailable, never empty verified HR history", async () => {
  const broken = payload([assignment(20)], true, true);
  const result = await readScopedResponse(
    async () => Response.json(broken),
    (value): value is ReturnType<typeof payload> => validate(value),
  );
  assert.deepEqual(result, { status: "unavailable", failure: "invalid" });
  const successful = payload([assignment(20)]);
  const success = await readScopedResponse(
    async () => Response.json(successful),
    (value): value is ReturnType<typeof payload> => validate(value),
  );
  assert.equal(success.status, "ready");

  const ui = readFileSync("src/components/hcm-org-explorer.tsx", "utf8");
  assert.match(ui, /readScopedResponse\(/, "UI must continue to use fail-closed scoped reads");
  assert.match(ui, /validPositionHistoryResponse\(/, "history cannot bypass JSON validation");
});
