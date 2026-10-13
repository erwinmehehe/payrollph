import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import https from "node:https";
import http from "node:http";

/**
 * Synthetic-only TLS termination for production-mode browser acceptance.
 * HTTPS:3000/3001/3002 -> HTTP:3100/3101/3102 on loopback only.
 * No credentials, request headers, URLs, or response bodies are logged.
 */
assert.equal(process.env.CI, "true");
assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
const key = process.env.MULTI_ENTITY_QA_TLS_KEY;
const certificate = process.env.MULTI_ENTITY_QA_TLS_CERT;
assert.ok(key && certificate, "Ephemeral TLS file paths required for synthetic QA");

const tlsOptions = { key: readFileSync(key), cert: readFileSync(certificate) };
const ports = [[3000, 3100], [3001, 3101], [3002, 3102]];
for (const [publicPort, upstreamPort] of ports) {
  const publicHost = "127.0.0.1:" + publicPort;
  https.createServer(tlsOptions, (request, response) => {
    if (request.headers.host !== publicHost) {
      response.writeHead(421);
      response.end();
      return;
    }
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: publicHost,
        "x-forwarded-proto": "https",
        "x-forwarded-host": publicHost,
      },
    }, incoming => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  }).listen(publicPort, "127.0.0.1");
}
