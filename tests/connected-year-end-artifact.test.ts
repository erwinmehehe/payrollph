import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CONNECTED_2316_BYTES, readValidatedUnsignedCertificatePdf } from "../scripts/qa/connected-year-end-artifact";

const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
function response(bytes: Uint8Array, extra: Record<string, string> = {}) {
  return new Response(Uint8Array.from(bytes).buffer as ArrayBuffer, { status: 200, headers: {
    "content-type": "application/pdf", "cache-control": "private, no-store",
    ...extra,
  } });
}

test("fictional unsigned PDF artifact requires valid bounded PDF bytes", async () => {
  assert.deepEqual(await readValidatedUnsignedCertificatePdf(response(new Uint8Array(pdf))), pdf);
  assert.deepEqual(await readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(pdf), { "content-length": String(pdf.byteLength) })), pdf);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(pdf), { "content-length": String(pdf.byteLength + 1) })), /Truncated/);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(pdf), { "content-length": String(MAX_CONNECTED_2316_BYTES + 1) })), /oversized/);
});

test("an HTTP error, wrong MIME, malformed or active PDF is never saved as evidence", async () => {
  const rejected = new Response(Uint8Array.from(pdf).buffer as ArrayBuffer, { status: 403, headers: {
    "content-type": "application/pdf", "cache-control": "no-store",
  } });
  await assert.rejects(readValidatedUnsignedCertificatePdf(rejected), /successful response/);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(pdf), { "content-type": "text/html" })), /application/);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(Buffer.from("this is not a certificate PDF; no valid header or trailer")))), /%PDF/);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog /OpenAction 2 0 R >>\nendobj\n%%EOF\n")))), /Active PDF/);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nno terminator")))), /end-of-file/);
  await assert.rejects(readValidatedUnsignedCertificatePdf(response(
    new Uint8Array(pdf), { "cache-control": "public" })), /no-store/);
});
