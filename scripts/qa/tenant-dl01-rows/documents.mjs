/** DL-01 private document POST: CI-only HTTPS scanner and read-back object store. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { victimSnapshot } from "../tenant-dl01-closure-shared.mjs";

export const METHODS = Object.freeze(["POST /api/documents"]);
const pdf = (label) => Buffer.from(
  "%PDF-1.4\nSYNTHETIC-PROOF-TENANT-QA:DL01-" + label + "\n%%EOF\n");
const upload = (ctx, actor, fields = {}) => ctx.request("/api/documents", {
  method: "POST", cookie: actor.operator.cookie,
  fields: { organizationId: actor.org.id, employeeId: actor.worker.id,
    kind: "other", ...fields },
  file: { bytes: pdf(actor.label), mime: "application/pdf",
    name: "dl01-" + actor.label + "-fictional.pdf" },
});
const persisted = async (ctx, org) => ctx.db.select().from(ctx.s.documents)
  .where(eq(ctx.s.documents.organizationId, org));

export async function prepare(ctx) {
  // Both attackers first; then an actual higher-ID victim-only private object.
  for (const employer of ctx.all) {
    const result = ctx.exact(await upload(ctx, employer), 201,
      "DL-01 document real own multipart upload " + employer.label);
    assert.ok(Number.isSafeInteger(result.json?.id));
    assert.equal(result.json?.storage, "private-object");
    assert.equal(result.json?.sha256, createHash("sha256").update(pdf(employer.label)).digest("hex"));
    assert.equal(result.json?.byteSize, pdf(employer.label).length);
    const docs = await persisted(ctx, employer.org.id);
    const row = docs.find(d => d.id === result.json.id);
    assert.ok(row && row.employeeId === employer.worker.id);
    assert.equal(row.organizationId, employer.org.id);
    assert.equal(row.scannedClean, true);
    assert.equal(row.content, "", "private content must never be in legacy base64");
    assert.match(row.objectStorageKey, /^private-documents\/[1-9]\d*\/[1-9]\d*\/[0-9a-f-]{36}$/);
    assert.equal(row.sha256, result.json.sha256);
    employer.document = row;
    ctx.noVictim(result, ctx.victim, "DL-01 own private upload");
  }
  assert.ok(ctx.victim.document.id > 6 &&
    ctx.attackers.every(a => ctx.victim.document.id > a.document.id),
    "Real victim document id must exceed both attacker document IDs");
}

export async function verify(ctx) {
  const victimBefore = await victimSnapshot(ctx.victim);
  for (const e of ctx.attackers) {
    // The exact same authenticated writer cannot attach a victim-owned worker
    // even when it correctly names its own employer.
    const forged = ctx.exact(await upload(ctx, e,
      { employeeId: ctx.victim.worker.id }), 404,
    "DL-01 document POST rejects actual victim employee under own employer");
    ctx.noVictim(forged, ctx.victim, "Forged private document worker");
    const foreign = ctx.exact(await upload(ctx, e,
      { organizationId: ctx.victim.org.id, employeeId: ctx.victim.worker.id }), 403,
    "DL-01 document POST denies real victim employer");
    ctx.noVictim(foreign, ctx.victim, "Foreign private document");
    assert.deepEqual((await persisted(ctx, e.org.id)).map(x => x.id), [e.document.id],
      "Denied upload cannot create or replace an attacker-visible record");
    assert.deepEqual(await victimSnapshot(ctx.victim), victimBefore,
      "Denied documents must leave the victim document, storage identity and audit unchanged");
  }
}
