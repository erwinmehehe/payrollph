/**
 * Disposable, localhost-only scanner for ESS synthetic QA.
 * This is NOT a malware scanner and may not be configured in deployed environments.
 * Tests use explicit filenames to simulate scanner outage and detected threats.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";

assert.equal(process.env.CI, "true");
assert.equal(process.env.ESS_PROFILE_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(new URL(process.env.DATABASE_URL ?? "").hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, "/app_db");
assert.equal(process.env.NODE_ENV, "development");

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/scan") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let length = 0;
  request.on("data", (chunk) => {
    length += chunk.length;
    if (length > 524288) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (response.writableEnded) return;
    const name = request.headers["x-upload-filename"];
    if (name === "scanner-unavailable.png") {
      response.writeHead(503).end();
      return;
    }
    const bytes = Buffer.concat(chunks);
    const mime = request.headers["content-type"];
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const supported = (png && mime === "image/png") || (jpeg && mime === "image/jpeg");
    const clean = Boolean(supported && bytes.length > 0 && name !== "scanner-detected.png");
    response.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ clean, engine: "ESS-961-FICTIONAL-QA" }));
  });
});
server.listen(3876, "127.0.0.1", () => {
  console.log("ESS synthetic scanner ready on localhost only.");
});
