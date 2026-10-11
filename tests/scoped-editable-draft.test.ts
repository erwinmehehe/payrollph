import assert from "node:assert/strict";
import test from "node:test";
import { currentEditableValue } from "../src/lib/scoped-editable-draft";

test("editing uses the draft only for its exact fetched source", () => {
  const source = { minimumRestMinutes: 60 };
  const edited = { minimumRestMinutes: 120 };
  assert.equal(currentEditableValue(null, source), source);
  assert.equal(currentEditableValue({ source, value: edited }, source), edited);
  assert.deepEqual(source, { minimumRestMinutes: 60 });
});

test("loading, employer/access changes and fresh responses cannot reuse an old policy draft", () => {
  const source = { minimumRestMinutes: 60 };
  const draft = { source, value: { minimumRestMinutes: 120 } };
  assert.equal(currentEditableValue(draft, null), null);
  const sameValuesNewResponse = { ...source };
  assert.equal(currentEditableValue(draft, sameValuesNewResponse), sameValuesNewResponse);
  const anotherEmployer = { minimumRestMinutes: 300 };
  assert.equal(currentEditableValue(draft, anotherEmployer), anotherEmployer);
});
