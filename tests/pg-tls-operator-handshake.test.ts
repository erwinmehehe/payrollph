import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import test from "node:test";
import { requestPostgresTls } from "../scripts/verify-postgresql-tls-operator";

test("PostgreSQL TLS handshake validates peer and rejects bad hostname and trust chain", async (t) => {
  try { execFileSync("openssl", ["version"], { stdio: "ignore", env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV } }); }
  catch { t.skip("OpenSSL CLI unavailable for disposable certificate generation"); return; }

  const dir = mkdtempSync(join(tmpdir(), "pg-tls-disposable-"));
  const certFile = join(dir, "test-cert.pem");
  const keyFile = join(dir, "test-key.pem");
  let server: ReturnType<typeof createServer> | undefined;
  const clients = new Set<TLSSocket>();
  try {
    // Disposable synthetic identity only; no committed private key or CA.
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
      "-keyout", keyFile, "-out", certFile], { stdio: "ignore", env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV } });
    const ca = readFileSync(certFile);
    const secureContext = createSecureContext({ key: readFileSync(keyFile), cert: ca });
    server = createServer((socket) => {
      socket.once("data", (data: Buffer) => {
        if (data.length !== 8 || data.readUInt32BE(4) !== 80877103) { socket.destroy(); return; }
        socket.write(Buffer.from("S"));
        const tlsSocket = new TLSSocket(socket, { isServer: true, secureContext });
        clients.add(tlsSocket);
        tlsSocket.on("error", () => {}); // negative certificate tests
        tlsSocket.on("close", () => clients.delete(tlsSocket));
      });
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server!.listen(0, "localhost", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await requestPostgresTls("localhost", address.port, ca, "trusted");
    await requestPostgresTls("localhost", address.port, ca, "wrong-host");
    await requestPostgresTls("localhost", address.port, ca, "untrusted-ca");
  } finally {
    for (const socket of clients) socket.destroy();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
