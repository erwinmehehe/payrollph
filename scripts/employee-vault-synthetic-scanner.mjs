/** Localhost scanner contract fixture only; NOT a real malware engine. */
import assert from "node:assert/strict";
import { createServer } from "node:http";

assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.EMPLOYEE_VAULT_BROWSER_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(process.env.NODE_ENV, "development");
const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/app_db");

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/scan" ||
      request.headers.authorization !== "Bearer synthetic-vault-scanner-only") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let length = 0;
  request.on("data", chunk => {
    length += chunk.length;
    if (length > 5 * 1024 * 1024) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (response.writableEnded) return;
    const bytes = Buffer.concat(chunks);
    // This synthetic scanner exercises the same PDF/PNG/JPEG transport
    // paths as the vault, without claiming to perform actual malware analysis.
    const mime = request.headers["content-type"];
    const signatureMatches = mime === "application/pdf"
      ? bytes.subarray(0, 4).equals(Buffer.from("%PDF"))
      : mime === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : mime === "image/jpeg"
          ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
          : false;
    const clean = signatureMatches && bytes.length >= 12 &&
      !String(request.headers["x-upload-filename"] ?? "").startsWith("synthetic-threat.");
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(JSON.stringify({ clean, engine: "synthetic-scanner-contract-only" }));
  });
});
server.listen(3876, "127.0.0.1", () => console.log("Synthetic scanner on localhost only."));
