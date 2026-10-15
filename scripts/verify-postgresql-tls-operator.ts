/**
 * Read-only protected PostgreSQL TLS verification for issue #1011.
 *
 * The authorized operator supplies DATABASE_URL through a protected secret
 * manager. Never print credential strings, peer hosts, certificate contents,
 * CA paths, raw errors, query parameters, or stack traces.
 * No DB writes, schema changes, payout or deployment actions.
 */
import { readFile } from "node:fs/promises";
import { connect as connectTcp } from "node:net";
import { checkServerIdentity, connect as connectTls } from "node:tls";
import type { TLSSocket } from "node:tls";
import { pinVerifiedPgTls } from "../src/lib/pg-tls-policy";

const TIMEOUT_MS = 8_000;
const NEGATIVE_HOST = "tls-hostname-mismatch.invalid";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BAD_CA_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_UNTRUSTED",
]);

export type ProbeConfig = {
  canonicalUrl: string;
  host: string;
  port: number;
  caFile: string | null;
};

function rejectConfig(reason: string): never {
  throw new Error("PostgreSQL TLS operator probe rejected: " + reason + "; secret values redacted.");
}

/** The return value contains the protected connection string: never log it. */
export function validateProbeConfig(secretUrl: string | undefined): ProbeConfig {
  if (!secretUrl) rejectConfig("DATABASE_URL missing");
  const canonicalUrl = pinVerifiedPgTls(secretUrl, true);
  const url = new URL(canonicalUrl);
  if (LOOPBACK_HOSTS.has(url.hostname)) rejectConfig("loopback is not protected-provider evidence");
  // The operator gate is stricter than the runtime compatibility shim: the
  // protected secret itself must already be explicit, not a legacy alias.
  const original = new URL(secretUrl);
  const modes = original.searchParams.getAll("sslmode");
  if (modes.length !== 1 || modes[0] !== "verify-full") {
    rejectConfig("protected secret must explicitly set sslmode=verify-full");
  }
  if (url.searchParams.has("sslcert") || url.searchParams.has("sslkey")) {
    rejectConfig("client certificate URL options require separate operator acceptance");
  }
  const caParams = url.searchParams.getAll("sslrootcert");
  if (caParams.length > 1 || caParams.includes("system") || (caParams.length === 1 && !caParams[0])) {
    rejectConfig("ambiguous or unsupported CA configuration");
  }
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) rejectConfig("invalid port");
  return { canonicalUrl, host: url.hostname, port, caFile: caParams[0] || null };
}

type TlsMode = "trusted" | "wrong-host" | "untrusted-ca";

export async function requestPostgresTls(host: string, port: number, ca: Buffer | undefined, mode: TlsMode): Promise<void> {
  const initial = await new Promise<import("node:net").Socket>((resolve, reject) => {
    const socket = connectTcp({ host, port });
    let settled = false;
    function fail(): void {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("PostgreSQL TLS negotiation failed"));
    }
    socket.setTimeout(TIMEOUT_MS, fail);
    socket.once("error", fail);
    socket.once("connect", () => {
      const request = Buffer.alloc(8);
      request.writeUInt32BE(8, 0);
      request.writeUInt32BE(80877103, 4); // PostgreSQL SSLRequest; no credentials
      socket.write(request);
    });
    socket.once("data", (data: Buffer) => {
      if (data[0] !== 0x53) return fail(); // PostgreSQL replies "S" for TLS
      settled = true;
      socket.removeListener("error", fail);
      socket.setTimeout(0);
      if (data.length > 1) socket.unshift(data.subarray(1));
      resolve(socket);
    });
  });

  let tlsSocket: TLSSocket | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
      tlsSocket = connectTls({
        socket: initial,
        servername: host,
        rejectUnauthorized: true,
        ...(mode === "untrusted-ca" ? { ca: [] } : ca ? { ca } : {}),
        checkServerIdentity: (servername, certificate) =>
          checkServerIdentity(mode === "wrong-host" ? NEGATIVE_HOST : servername, certificate),
      });
      tlsSocket.setTimeout(TIMEOUT_MS, () => finish(new Error("TLS handshake timed out")));
      tlsSocket.once("error", finish);
      tlsSocket.once("secureConnect", () => {
        if (!tlsSocket?.authorized) finish(new Error("TLS peer not authorized"));
        else finish();
      });
    });
    if (mode !== "trusted") throw new Error("insecure negative TLS connection unexpectedly accepted");
  } catch (error) {
    if (mode === "wrong-host" && (error as NodeJS.ErrnoException).code === "ERR_TLS_CERT_ALTNAME_INVALID") return;
    if (mode === "untrusted-ca" && BAD_CA_CODES.has((error as NodeJS.ErrnoException).code ?? "")) return;
    throw new Error(mode === "trusted" ? "strict TLS handshake failed" : "negative TLS certificate test was inconclusive");
  } finally {
    tlsSocket?.destroy();
    initial.destroy();
  }
}

async function readOnlyDriverQuery(url: string): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url, connectionTimeoutMillis: TIMEOUT_MS, query_timeout: TIMEOUT_MS });
  try {
    await client.connect();
    // A pooler may terminate frontend TLS. pg_stat_ssl observes the pooler's
    // backend rather than the operator's connection; the raw handshake above
    // separately validates the frontend certificate and its hostname.
    const result = await client.query("SELECT 1::integer AS acceptance_probe_ok");
    if (result.rows.length !== 1 || result.rows[0]?.acceptance_probe_ok !== 1) {
      throw new Error("read-only database response invalid");
    }
  } catch {
    throw new Error("read-only strict pg Client query failed");
  } finally {
    try { await client.end(); } catch { /* no secret-bearing errors */ }
  }
}

export async function runOperatorProbe(secretUrl: string | undefined): Promise<void> {
  const config = validateProbeConfig(secretUrl);
  console.log("PASS protected URL has explicit verify-full and an unambiguous hostname");
  let ca: Buffer | undefined;
  if (config.caFile) {
    try { ca = await readFile(config.caFile); } catch { rejectConfig("provider CA file unavailable"); }
  }
  await requestPostgresTls(config.host, config.port, ca, "trusted");
  console.log("PASS provider certificate chain and hostname verified over PostgreSQL TLS");
  await requestPostgresTls(config.host, config.port, ca, "wrong-host");
  console.log("PASS incorrect hostname was rejected by TLS");
  await requestPostgresTls(config.host, config.port, ca, "untrusted-ca");
  console.log("PASS untrusted certificate chain was rejected by TLS");
  await readOnlyDriverQuery(config.canonicalUrl);
  console.log("PASS strict node-postgres client completed a read-only TLS health query");
  console.log("PASS PostgreSQL TLS operator acceptance (record approval privately)");
}

