/**
 * A-5 authenticated-browser acceptance only: disposable localhost scanner
 * CONTRACT EMULATOR. This is NOT anti-malware protection or provider approval.
 * Refuse to run against anything except CI's isolated PostgreSQL and loopback.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";

assert.equal(process.env.CI, "true");
assert.equal(process.env.VAULT_BROWSER_ACCEPTANCE_MODE, "synthetic-postgres-only");
assert.equal(new URL(process.env.DATABASE_URL ?? "").hostname, "127.0.0.1");
assert.equal(new URL(process.env.DATABASE_URL ?? "").pathname, "/app_db");
assert.equal(process.env.NODE_ENV, "development");
assert.equal(process.env.MALWARE_SCAN_URL, "http://127.0.0.1:3877/scan");
assert.equal(process.env.DOCUMENT_OBJECT_STORAGE_ENDPOINT, "http://127.0.0.1:9000/");

const server = createServer((req, response) => {
  if (req.url !== "/scan" || req.method !== "POST") {
    response.writeHead(404).end();
    return;
  }
  const chunks = [];
  let size = 0;
  req.on("data", chunk => {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) {
      response.writeHead(413).end();
      req.destroy();
    } else chunks.push(chunk);
  });
  req.on("end", () => {
    if (response.writableEnded) return;
    const bytes = Buffer.concat(chunks);
    const mime = req.headers["content-type"];
    const name = req.headers["x-upload-filename"];
    const match =
      (mime === "application/pdf" && bytes.subarray(0, 4).equals(Buffer.from("%PDF"))) ||
      (mime === "image/png" && bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71]))) ||
      (mime === "image/jpeg" && bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])));
    if (name === "synthetic-scanner-outage.pdf") {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json",
      "Cache-Control": "no-store" }).end(JSON.stringify({
      clean: Boolean(bytes.length && match && name !== "synthetic-infected.pdf"),
      engine: "CI-FICTIONAL-CONTRACT-ONLY",
    }));
  });
});

server.listen(3877, "127.0.0.1", () => console.log(
  "Synthetic A-5 scanner contract fixture on loopback; NOT a production malware scanner.",
));
