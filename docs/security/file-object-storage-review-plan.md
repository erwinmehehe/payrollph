# A-5: private file-object migration plan — awaiting owner review

No data migration or bucket creation is included. The current schema contains fileDataBase64 fields; inventory all file writers/readers and database/backup retention before allocating migrations. Reconcile existing private-vault/storage PRs before adding another backend.

## Proposed storage

Use an approved private S3-compatible object store, with a single reviewed provider adapter. AWS S3 with SSE-KMS is a candidate; provider, region, residency, DPA, retention, costs and key custody require owner review. Do not select a public bucket or public CDN. Object keys use opaque tenant/file IDs, never names or government identifiers. Store provider/bucket/key/version, plaintext content SHA-256, byte length, MIME type and encryption/key metadata in Postgres. KMS encryption at rest plus TLS is mandatory; use application envelope encryption for especially sensitive artifacts if threat assessment requires it.

## Access

Every download verifies current tenant membership, employee/resource scope and purpose. Issue short-lived signed GET URLs only after authorization; never log URL signatures or put them into ordinary analytics. For encrypted application envelopes, proxy authorized decryption rather than exposing unusable ciphertext. Uploads use size/MIME limits, malware checks and staged status; only verified objects become active pointers. Preserve maker/checker controls on evidence changes.

## Dual-read and backfill

Add nullable pointers/checksums behind a default-off critical flag. Reads prefer a verified pointer; inline base64 remains available only during the reviewed transition. Upload failure must not silently erase inline data. Keep new writers staged until object verification and pointer commit succeed; record orphan cleanup independently.

The backfill is a manual, resumable tenant/primary-key cursor job with bounded batches. Decode existing bytes, compute SHA-256, upload an immutable version, re-download/authenticate/hash-check and compare lengths before a compare-and-swap pointer update. Never overwrite concurrent edits. Track scanned/uploaded/verified/rewritten/conflicted/failed counts and checkpoints without file contents. An idempotent retry reuses the verified version/hash. Restore testing must cover both Postgres pointers and object versions/keys.

## Cutover and rollback

Compare source row counts, verified object counts, hash/length mismatches and unresolved rows per tenant; block cutover on any mismatch. Keep inline payloads until approved reconciliation and recovery testing complete. Rollback disables pointer preference and uses retained inline data; do not delete objects or inline payloads during rollback. After the dual-read window, remove inline bytes only in a separately approved data migration, with legal holds, backup retention and key recovery documented. Restore beyond that cutover must restore object versions as well as database state.

Review required: provider/region, encryption model, URL lifetime, retention and dual-read window, sensitive file categories and rollback ownership. Implementation waits for owner review.
