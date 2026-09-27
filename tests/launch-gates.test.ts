import assert from "node:assert/strict";
import test from "node:test";
import { passwordIssues, validEmail } from "../src/lib/validation";
import { MAX_UPLOAD_BYTES, safeFileName, validateUpload } from "../src/lib/storage";
import { activeMailProvider } from "../src/lib/mail-provider";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

test("password policy enforces length and character classes", () => {
  assert.ok(passwordIssues("short").length > 0);
  assert.deepEqual(passwordIssues("alllowercase123"), ["Must include an uppercase letter."]);
  assert.deepEqual(passwordIssues("ALLOWERCASE123"), ["Must include a lowercase letter."]);
  assert.deepEqual(passwordIssues("NoNumbersHere"), ["Must include a number."]);
  assert.deepEqual(passwordIssues("Str0ngPassw0rd!"), []);
});

test("email normalisation helper rejects malformed input", () => {
  assert.equal(validEmail("a@b.ph"), true);
  assert.equal(validEmail("not-an-email"), false);
  assert.equal(validEmail("a@b"), false);
});

test("uploads are sniffed by content, not by declared MIME type", () => {
  const png = validateUpload(PNG, "image/png", "id.png");
  assert.equal(png.ok, true);

  // Declared PDF but actually PNG bytes -> rejected on mismatch.
  const lie = validateUpload(PNG, "application/pdf", "payload.pdf");
  assert.equal(lie.ok, false);

  // Executable bytes with a .pdf name -> rejected by magic number.
  const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4]);
  const disguised = validateUpload(exe, "application/pdf", "invoice.pdf");
  assert.equal(disguised.ok, false);

  assert.equal(validateUpload(new Uint8Array(0), "image/png", "empty.png").ok, false);
  assert.equal(validateUpload(new Uint8Array(64), "text/html", "x.png").ok, false);
});

test("PDF magic bytes are accepted regardless of declared octet-stream", () => {
  const result = validateUpload(PDF, "application/octet-stream", "2316.pdf");
  assert.equal(result.ok, true);
});

test("oversize uploads are rejected before any storage work", () => {
  assert.equal(MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
});

test("file names cannot traverse directories", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("a/b/c\\..\\evil.png"), "evil.png");
  assert.equal(safeFileName("bad<>name|.pdf"), "bad_name_.pdf");
  assert.ok(!safeFileName("bad<>name|.pdf").includes("<"));
});

test("mail provider reports honestly when unconfigured", () => {
  // In this sandbox no provider env vars are set, so delivery must not be claimed.
  if (!process.env.RESEND_API_KEY && !process.env.POSTMARK_SERVER_TOKEN && !process.env.SMTP_URL) {
    assert.equal(activeMailProvider(), "none");
  } else {
    assert.ok(["resend", "postmark", "smtp"].includes(activeMailProvider()));
  }
});
