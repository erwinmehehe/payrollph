/** Local HTTPS byte-store/scanner CONTRACT fixture, not real S3 or antivirus acceptance. */
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { requireReceiptProof } from "./receipt-http-proof-contract.mjs";
requireReceiptProof();
const objects = new Map();
const calls = { gets: 0, puts: 0, deletes: 0, scans: 0 };
let hold = false, corrupt = false, waiting = 0;
const releases = [];
const server = createServer({ key: readFileSync(process.env.RECEIPT_TLS_KEY), cert: readFileSync(process.env.NODE_EXTRA_CA_CERTS) }, async (req, res) => {
  try {
    const url = new URL(req.url, "https://127.0.0.1:9443");
    if (url.pathname === "/control") {
      if (req.headers.authorization !== "Bearer fictional-receipt-scanner") { res.writeHead(403).end(); return; }
      if (req.method === "POST") {
        const input = JSON.parse(await body(req));
        hold = input.hold === true; corrupt = input.corrupt === true;
        if (!hold) for (const release of releases.splice(0)) release();
      }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ waiting, objects: objects.size, ...calls })); return;
    }
    if (url.pathname === "/scan") {
      if (req.headers.authorization !== "Bearer fictional-receipt-scanner") { res.writeHead(403).end(); return; }
      calls.scans++; await body(req); res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ clean: true, engine: "Fictional contract only" })); return;
    }
    if (!url.pathname.startsWith("/fictional-receipts/private-documents/") ||
      !/^[0-9a-f]{64}$/.test(url.searchParams.get("X-Amz-Signature") ?? "") ||
      !url.searchParams.get("X-Amz-Credential")?.startsWith("fictional-receipt-key/")) {
      res.writeHead(403).end(); return;
    }
    if (req.method === "PUT") {
      calls.puts++;
      if (req.headers["if-none-match"] !== "*" || objects.has(url.pathname)) { res.writeHead(412).end(); return; }
      objects.set(url.pathname, await body(req)); res.writeHead(200).end(); return;
    }
    if (req.method === "GET") {
      calls.gets++;
      const bytes = objects.get(url.pathname);
      if (!bytes) { res.writeHead(404).end(); return; }
      if (hold) {
        waiting++;
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 10000);
          releases.push(() => { clearTimeout(timer); resolve(); });
        });
        waiting--;
      }
      res.end(corrupt ? Buffer.from("fictional-corrupt-readback") : bytes); return;
    }
    if (req.method === "DELETE") { calls.deletes++; objects.delete(url.pathname); res.writeHead(204).end(); return; }
    res.writeHead(405).end();
  } catch { res.writeHead(500).end("fictional fixture failure"); }
});
async function body(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length; if (length > 5242880) throw Error("fixture size exceeded"); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
server.listen(9443, "127.0.0.1", () => console.log("fictional HTTPS receipt fixture listening on localhost"));
