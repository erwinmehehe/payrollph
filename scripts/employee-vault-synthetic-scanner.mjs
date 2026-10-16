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
    const pdf = bytes.subarray(0, 4).equals(Buffer.from("%PDF"));
    const clean = pdf && request.headers["content-type"] === "application/pdf" &&
      bytes.length >= 12 && request.headers["x-upload-filename"] !== "synthetic-threat.pdf";
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      .end(JSON.stringify({ clean, engine: "synthetic-scanner-contract-only" }));
  });
});
server.listen(3876, "127.0.0.1", () => console.log("Synthetic scanner on localhost only."));
