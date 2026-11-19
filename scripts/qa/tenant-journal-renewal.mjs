import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function blob(raw) {
  return createHash("sha1").update("blob " + raw.length + "\0").update(raw).digest("hex");
}

export function verifyJournalRenewal(manifest) {
  const raw = readFileSync(new URL("./tenant-journal-renewal-receipt.json", import.meta.url));
  assert.equal(blob(raw), "d99260864f0adfed408401a18c97c857ec561bd9", "Journal receipt changed");
  const receipt = JSON.parse(raw);
  const route = manifest.allApiRouteFiles[receipt.route];
  const row = route.methods.find(method => method.name === "GET");
  assert.equal(route.gitBlobSha, receipt.sourcePins[receipt.route]);
  assert.equal(row.status, "COVERED");
  assert.deepEqual(row.testedBy, receipt.proof);
  for (const [path, expected] of Object.entries(receipt.sourcePins)) {
    const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    assert.equal(blob(Buffer.from(source)), expected, "Journal proof source changed: " + path);
  }
  return 1;
}
