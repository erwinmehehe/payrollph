import assert from "node:assert/strict";
import test from "node:test";
import { documentObjectKey, documentStorageConfig, signedDocumentObjectUrl } from "../src/lib/document-object-storage";

import { documentBytesMayBeReleased } from "../src/lib/employee-document-vault";
const config = {
  endpoint: "https://objects.example.test", bucket: "employee-hr-private", region: "ap-southeast-1",
  accessKeyId: "unit-test-key", secretAccessKey: "unit-test-secret",
};
test("tenant-separated private object names cannot be requested through path traversal", () => {
  const keyA = documentObjectKey(10, 41);
  const keyB = documentObjectKey(11, 41);
  assert.match(keyA, /^private-documents\/10\/41\/[0-9a-f-]{36}$/);
  assert.match(keyB, /^private-documents\/11\/41\/[0-9a-f-]{36}$/);
  assert.notEqual(keyA, keyB);
  assert.throws(() => documentObjectKey(0, 41));
  assert.throws(() => signedDocumentObjectUrl("../private", "GET", config));
});
test("private signed URLs are short-lived and bound to method and path", () => {
  const now = new Date("2026-10-12T01:30:00Z");
  const key = "private-documents/10/41/00000000-0000-4000-8000-000000000001";
  const get = signedDocumentObjectUrl(key, "GET", config, { now });
  const put = signedDocumentObjectUrl(key, "PUT", config, { now });
  assert.equal(get.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(get.searchParams.get("X-Amz-Date"), "20261012T013000Z");
  assert.notEqual(put.searchParams.get("X-Amz-Signature"), get.searchParams.get("X-Amz-Signature"));
  assert.ok(!get.toString().includes(config.secretAccessKey));
  assert.throws(() => signedDocumentObjectUrl(key, "GET", config, { expirySeconds: 301 }));
});
test("object store configuration fails closed without private credentials or HTTPS in production", () => {
  assert.throws(() => documentStorageConfig({ NODE_ENV: "production" }));
  assert.throws(() => documentStorageConfig({
    NODE_ENV: "production", DOCUMENT_OBJECT_STORAGE_ENDPOINT: "http://untrusted.example.test",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "private-documents", DOCUMENT_OBJECT_STORAGE_REGION: "ap-southeast-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "a", DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "b",
  }), /HTTPS/);
});

test("pending private COEs stay unreadable through flag rollback, including staging", () => {
  const pending = { scannedClean: false, isProduction: false, vaultEnabled: false, hasPrivateObject: true };
  assert.equal(documentBytesMayBeReleased(pending), false);
  assert.equal(documentBytesMayBeReleased({ ...pending, vaultEnabled: true }), false);
  assert.equal(documentBytesMayBeReleased({ ...pending, isProduction: true }), false);
  assert.equal(documentBytesMayBeReleased({ ...pending, hasPrivateObject: false }), true,
    "legacy development compatibility remains unchanged when the vault is OFF");
  assert.equal(documentBytesMayBeReleased({ ...pending, scannedClean: true }), true);
});

test("signed attachment URLs preserve private S3 authentication and reject unsafe overrides", () => {
  const config = documentStorageConfig({
    NODE_ENV: "test",
    DOCUMENT_OBJECT_STORAGE_ENDPOINT: "https://objects.example.invalid/",
    DOCUMENT_OBJECT_STORAGE_BUCKET: "private-documents",
    DOCUMENT_OBJECT_STORAGE_REGION: "us-east-1",
    DOCUMENT_OBJECT_STORAGE_ACCESS_KEY_ID: "synthetic-key",
    DOCUMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY: "synthetic-secret",
  });
  const key = "private-documents/10/41/00000000-0000-4000-8000-000000000001";
  const url = signedDocumentObjectUrl(key, "GET", config, {
    responseContentDisposition: 'attachment; filename="contract.pdf"',
  });
  assert.equal(url.searchParams.get("response-content-disposition"), 'attachment; filename="contract.pdf"');
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.throws(() => signedDocumentObjectUrl(key, "PUT", config, {
    responseContentDisposition: 'attachment; filename="contract.pdf"',
  }), /Invalid private document download filename/);
  assert.throws(() => signedDocumentObjectUrl(key, "GET", config, {
    responseContentDisposition: 'attachment; filename="bad\r\nname.pdf"',
  }), /Invalid private document download filename/);
});
