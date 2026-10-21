/**
 * Localhost TLS scanner TEST DOUBLE for one known synthetic PDF ONLY.
 * It is not malware certification, a production scanner, or a provider.
 * Everything else remains unavailable (HTTP 503, fail closed).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

export const FIXTURE_PDF = "%PDF-1.4\nFICTIONAL PAYROLLPH TENANT SCOPE PROOF\n%%EOF\n";
const SHA = createHash("sha256").update(FIXTURE_PDF).digest("hex");
const uri = new URL(process.env.MALWARE_SCAN_URL ?? "");
const db = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.CI, "true");
assert.equal(db.hostname, "127.0.0.1");
assert.equal(db.port, "5432");
assert.equal(db.pathname, "/app_db");
assert.equal(uri.protocol, "https:");
assert.equal(uri.hostname, "127.0.0.1");
assert.equal(uri.port, "8443");
assert.ok(process.env.MALWARE_SCAN_TOKEN?.startsWith("ci-"));
assert.ok(process.env.TENANT_SCANNER_KEY && process.env.TENANT_SCANNER_CERT);
const token = process.env.MALWARE_SCAN_TOKEN;
const options = {
  key: readFileSync(process.env.TENANT_SCANNER_KEY),
  cert: readFileSync(process.env.TENANT_SCANNER_CERT),
};
const reply = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const server = createServer(options, async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    reply(res, 200, { ok: true, scope: "synthetic-one-file-only" });
    return;
  }
  if (req.method !== "POST" || req.url !== "/scan") {
    reply(res, 404, { error: "Not found" }); return;
  }
  if (req.headers.authorization !== "Bearer " + token) {
    reply(res, 401, { error: "Invalid scanner token" }); return;
  }
  const chunks = [];
  let count = 0;
  for await (const chunk of req) {
    count += chunk.byteLength;
    if (count > 1024 * 1024) {
      reply(res, 413, { error: "Synthetic file too large" }); return;
    }
    chunks.push(chunk);
  }
  const hash = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
  if (hash !== SHA || req.headers["content-type"] !== "application/pdf") {
    reply(res, 503, { error: "Synthetic scanner deliberately unavailable for unapproved bytes" });
    return;
  }
  reply(res, 200, { clean: true, engine: "CI known-bytes test double (not a malware scan)" });
});
server.listen(8443, "127.0.0.1", () => console.log("Local synthetic scanner listening"));
