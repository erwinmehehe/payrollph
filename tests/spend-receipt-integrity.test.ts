import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readVerifiedSpendReceipt } from "../src/lib/spend-receipt-storage";

test("private receipt reads verify identity, byte count and SHA-256 without following redirects", async () => {
  const prior = { ...process.env };
  Object.assign(process.env, { DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "synthetic-receipts", DOCUMENT_OBJECT_STORAGE_REGION: "us-east-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic", DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-not-live" });
  const bytes = Buffer.from("%PDF-1.7"), input = { key: "private-documents/1/2/00000000-0000-4000-8000-000000000001",
    organizationId: 1, employeeId: 2, byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
  try {
    const provider = (body: Uint8Array, status = 200): typeof fetch => async (_url, options) => {
      assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
      assert.ok(options?.signal); return new Response(new Uint8Array(body), { status });
    };
    assert.deepEqual(await readVerifiedSpendReceipt(input, provider(bytes)), bytes);
    await assert.rejects(readVerifiedSpendReceipt(input, provider(Buffer.from("%PDF-1.8"))), /HASH_MISMATCH/);
    await assert.rejects(readVerifiedSpendReceipt(input, provider(bytes.subarray(0, 4))), /HASH_MISMATCH/);
    await assert.rejects(readVerifiedSpendReceipt(input, provider(Buffer.concat([bytes, bytes]))), /SIZE_MISMATCH/);
    await assert.rejects(readVerifiedSpendReceipt(input, provider(bytes, 302)), /READ_UNAVAILABLE/);
    let fetched = false;
    await assert.rejects(readVerifiedSpendReceipt({ ...input, organizationId: 3 }, async () => {
      fetched = true; return new Response(bytes);
    }), /IDENTITY_INVALID/);
    assert.equal(fetched, false);
    await assert.rejects(readVerifiedSpendReceipt({ ...input, byteSize: 5242881 }, provider(bytes)), /IDENTITY_INVALID/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  }
});
