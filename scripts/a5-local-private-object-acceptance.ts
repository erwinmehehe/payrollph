import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { documentObjectIdentityMatches } from "../src/lib/employee-document-vault";
import { documentObjectKey, documentStorageConfig, deleteDocumentObject, putDocumentObject, signedDocumentObjectUrl } from "../src/lib/document-object-storage";
import { scanUpload } from "../src/lib/storage";

// No real storage, customer records, credentials, or production endpoint allowed.
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.EMPLOYEE_DOCUMENT_VAULT_ENABLED, "true");
const config = documentStorageConfig();
const endpoint = new URL(config.endpoint);
assert.equal(endpoint.hostname, "127.0.0.1");
assert.equal(endpoint.port, "9000");
assert.equal(config.bucket, "vault-a5-synthetic");
assert.ok(config.accessKeyId.startsWith("synthetic-"));
assert.ok(config.secretAccessKey.startsWith("synthetic-"));
const bytes = Buffer.from("%PDF-1.4\nSynthetic HR file only\n%%EOF\n");
const sha = createHash("sha256").update(bytes).digest("hex");
const key = documentObjectKey(501, 902);
assert.equal(documentObjectIdentityMatches(key, 501, 902), true);
assert.equal(documentObjectIdentityMatches(key, 501, 903), false);
assert.equal(documentObjectIdentityMatches(key, 502, 902), false);
const unsignedUrl = new URL(config.endpoint + "/" + config.bucket + "/" + key);
try {
  const anonymous = await fetch(unsignedUrl);
  assert.ok([401, 403, 404].includes(anonymous.status), "anonymous GET must not expose object");
  await putDocumentObject(key, bytes, "application/pdf", { config });
  const authorized = await fetch(signedDocumentObjectUrl(key, "GET", config, { expirySeconds: 60 }));
  assert.equal(authorized.status, 200, "signed GET must read privately stored bytes");
  const stored = Buffer.from(await authorized.arrayBuffer());
  assert.equal(stored.byteLength, bytes.byteLength);
  assert.equal(createHash("sha256").update(stored).digest("hex"), sha, "stored bytes must match source digest");
  await assert.rejects(
    putDocumentObject(key, Buffer.from("overwritten"), "application/pdf", { config }),
    /Private document upload failed/,
    "If-None-Match must prevent overwriting verified bytes",
  );
  const still = await fetch(signedDocumentObjectUrl(key, "GET", config));
  assert.deepEqual(Buffer.from(await still.arrayBuffer()), bytes, "rejected overwrite must preserve scanned bytes");
  const tampered = signedDocumentObjectUrl(key, "GET", config);
  tampered.searchParams.set("X-Amz-Signature", "0".repeat(64));
  const untrusted = await fetch(tampered);
  assert.ok([400, 401, 403].includes(untrusted.status), "tampered signature must fail");
  const expired = await fetch(signedDocumentObjectUrl(key, "GET", config, {
    now: new Date(Date.now() - 60_000),
    expirySeconds: 1,
  }));
  assert.ok([400, 401, 403].includes(expired.status), "expired signature must fail");

  // Synthetic scanner protocol only. No claim about production AV engine/provider.
  const previousUrl = process.env.MALWARE_SCAN_URL;
  const previousToken = process.env.MALWARE_SCAN_TOKEN;
  try {
    process.env.MALWARE_SCAN_URL = "http://127.0.0.1:3333/scan";
    process.env.MALWARE_SCAN_TOKEN = "synthetic-scanner-token";
    const clean = await scanUpload(bytes, { fileName: "synthetic.pdf", mime: "application/pdf" }, {
      fetchImpl: (async () => new Response(JSON.stringify({ clean: true, engine: "synthetic" }),
        { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    assert.equal(clean.scannedClean, true);
    const rejected = await scanUpload(bytes, { fileName: "synthetic.pdf", mime: "application/pdf" }, {
      fetchImpl: (async () => new Response(JSON.stringify({ clean: false, threat: "fictional-test" }),
        { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
    });
    assert.equal(rejected.scannedClean, false, "threat decision must fail closed");
    const down = await scanUpload(bytes, { fileName: "synthetic.pdf", mime: "application/pdf" }, {
      fetchImpl: (async () => { throw new Error("synthetic network outage"); }) as typeof fetch,
    });
    assert.equal(down.scannedClean, false, "scanner outage must fail closed");
    assert.equal(down.unavailable, true);
  } finally {
    if (previousUrl === undefined) delete process.env.MALWARE_SCAN_URL;
    else process.env.MALWARE_SCAN_URL = previousUrl;
    if (previousToken === undefined) delete process.env.MALWARE_SCAN_TOKEN;
    else process.env.MALWARE_SCAN_TOKEN = previousToken;
  }
  console.log("PASS A5 synthetic MinIO private object + scoped keys + hash + overwrite + expiry + scanner fail-closed");
} finally {
  await deleteDocumentObject(key, { config }).catch(() => {});
}
