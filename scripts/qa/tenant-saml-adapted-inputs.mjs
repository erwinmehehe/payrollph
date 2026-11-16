/** Maps the two reviewed SAML adapters back to the exact bytes the executed PG16 proof pinned. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SAML_ADAPTED_ARCHIVE = "scripts/qa/tenant-saml-adapted-inputs-archive.json";
const ARCHIVE_BLOB = "df14dee0b3ba83fa15c04f9649d87a5c587ca377";
const blob = (bytes) => createHash("sha1").update("blob " + Buffer.byteLength(bytes) + "\0").update(bytes).digest("hex");

/** Unrecognised bytes pass through untouched so the receipt's own drift check still rejects them. */
export function samlExecutedInputRead(read = readFileSync) {
  // The archive is a tooling file pinned by blob; baseline reads from another revision never contain it.
  const raw = readFileSync(SAML_ADAPTED_ARCHIVE);
  assert.equal(blob(raw), ARCHIVE_BLOB, "SAML adapted-inputs archive changed");
  const a = JSON.parse(raw);
  assert.equal(a.schema, "saml-adapted-executed-inputs-archive-v1");
  return (path, ...args) => {
    const value = read(path, ...args);
    if (!Object.hasOwn(a.adaptedBlobs, path) || blob(value) !== a.adaptedBlobs[path]) return value;
    assert.equal(blob(a.files[path]), a.originalBlobs[path], "Archived original SAML input changed: " + path);
    return args[0] ? a.files[path] : Buffer.from(a.files[path]);
  };
}
