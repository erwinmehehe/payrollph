import assert from "node:assert/strict";
import test from "node:test";
import { createScopedRequestOwner } from "../src/lib/scoped-async-request";

test("scoped refresh reports committed success/failure; cancelled requests cannot confirm a receipt", async () => {
  const owner = createScopedRequestOwner<string>();
  const seen: Array<{ data: number | null; error: Error | null }> = [];
  owner.activate("employer-41");
  const success = await owner.run("employer-41", async () => 201, outcome => seen.push(outcome));
  assert.equal(success?.data, 201);
  const failed = await owner.run<number>("employer-41", async () => {
    throw new Error("Verified GET failed: 503");
  }, outcome => seen.push(outcome));
  assert.equal(failed?.data, null);
  assert.match(failed?.error?.message ?? "", /503/);
  assert.equal(seen.length, 2);
  owner.cancel("employer-41");
  assert.equal(await owner.run("employer-41", async () => 200, () => {
    throw Error("Inactive scope must not commit");
  }), undefined);
});
