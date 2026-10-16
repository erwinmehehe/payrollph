/** CI-only PDF evidence boundary. A localhost HTTP response is still untrusted
 * bytes: bound the download and reject active-content PDF features before we
 * persist an unsigned, fictional certificate for human QA inspection. This
 * checks plausibility, not digital signatures or independent PDF certification. */
import assert from "node:assert/strict";

export const MAX_CONNECTED_2316_BYTES = 8 * 1024 * 1024;

export async function readValidatedUnsignedCertificatePdf(response: Response): Promise<Buffer> {
  assert.equal(response.status, 200, "Unsigned certificate must come from a successful response");
  assert.match(response.headers.get("content-type") ?? "", /^application\/pdf(?:\s*;|$)/i);
  assert.match(response.headers.get("cache-control") ?? "", /\bno-store\b/i);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    assert.match(declaredLength, /^[1-9]\d*$/, "PDF Content-Length must be a positive integer");
    assert.ok(Number(declaredLength) <= MAX_CONNECTED_2316_BYTES,
      "Refuse oversized unsigned certificate evidence");
  }

  assert.ok(response.body, "Missing unsigned certificate body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      assert.ok(value instanceof Uint8Array, "Invalid PDF stream chunk");
      total += value.byteLength;
      assert.ok(total <= MAX_CONNECTED_2316_BYTES, "PDF exceeded the bounded evidence limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  assert.ok(total >= 50, "Certificate evidence is unexpectedly short");
  if (declaredLength !== null) assert.equal(total, Number(declaredLength), "Truncated PDF response");
  const bytes = Buffer.concat(chunks, total);
  assert.match(bytes.subarray(0, 8).toString("latin1"), /^%PDF-(?:1\.[0-7]|2\.0)/);
  assert.match(bytes.subarray(-1024).toString("latin1"), /%%EOF\s*$/,
    "PDF has no valid end-of-file marker");
  // Reject recognizable active features. This is defense in depth, not a
  // guarantee against obfuscated PDF actions; evidence stays offline.
  assert.doesNotMatch(bytes.toString("latin1"),
    /\/(?:JS|JavaScript|OpenAction|AA|Launch|EmbeddedFiles|RichMedia)(?=[\s<>\[\]/()]|$)/i,
    "Active PDF content is not permitted in synthetic QA evidence");
  return bytes;
}
