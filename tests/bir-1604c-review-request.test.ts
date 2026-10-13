import assert from "node:assert/strict";
import test from "node:test";
import { BirReviewBodyError, BIR_REVIEW_MAX_BYTES, readBirReviewBody } from "../src/lib/bir-1604c-review-request";

const url = "https://payrollph.example/api/bir/annual-employer/candidate";
function request(body: string, type = "application/json") {
  return new Request(url, { method: "POST", headers: { "content-type": type }, body });
}
test("bounded review accepts normal JSON without guessing numeric fields", async () => {
  const body = { mode: "check", records: [{ employeeNo: "EMP001" }] };
  assert.deepEqual(await readBirReviewBody(request(JSON.stringify(body))), body);
});
test("invalid JSON, non-JSON and overly large uploads reject without echoing private source", async () => {
  await assert.rejects(() => readBirReviewBody(request("confidential")), (err: unknown) =>
    err instanceof BirReviewBodyError && err.code === "INVALID_JSON" &&
    !err.message.includes("confidential"));
  await assert.rejects(() => readBirReviewBody(request("secret-tin", "text/plain")), (err: unknown) =>
    err instanceof BirReviewBodyError && err.code === "INVALID_CONTENT_TYPE");
  await assert.rejects(() => readBirReviewBody(request("x".repeat(BIR_REVIEW_MAX_BYTES + 1))), (err: unknown) =>
    err instanceof BirReviewBodyError && err.code === "REVIEW_TOO_LARGE");
});
test("aborted review cannot be processed as an empty valid dataset", async () => {
  const controller = new AbortController();
  const req = new Request(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: "{}", signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(() => readBirReviewBody(req), (err: unknown) =>
    err instanceof BirReviewBodyError && err.code === "BODY_UNAVAILABLE");
});
