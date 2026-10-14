/**
 * Keep the production node-postgres connection on certificate AND hostname
 * verification across the pg-connection-string v2 -> v3 semantic change.
 *
 * The v2 aliases "prefer", "require" and "verify-ca" currently behave like
 * "verify-full", but will no longer do so in the next major parser release.
 * This function changes only the in-memory connection string; operators must
 * still verify provider certificates and update protected environment secrets.
 *
 * Never attach the incoming connection string (or URL-derived host, user or
 * query parameters) to an error or log: it contains database credentials.
 */
const LEGACY_STRICT_ALIASES = new Set(["prefer", "require", "verify-ca"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function configError(reason: string): Error {
  return new Error(`Production PostgreSQL TLS configuration rejected: ${reason}. DATABASE_URL value redacted.`);
}

export function pinVerifiedPgTls(connectionString: string, production: boolean): string {
  if (!production) return connectionString;

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw configError("invalid connection URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw configError("unsupported connection URL scheme");
  }

  // Production remote TLS cannot verify a peer hostname when none is specified.
  // Reject hostless URLs rather than relying on driver/environment fallbacks.
  if (!parsed.hostname) throw configError("missing database hostname");

  // Local ephemeral PG is intentionally plaintext in isolated CI. Do not
  // make that test fixture depend on an external certificate authority.
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return connectionString;

  // Do not accept a second option that could override the verified sslmode.
  if (parsed.searchParams.has("ssl")) {
    throw configError("ambiguous ssl option; use only sslmode=verify-full");
  }
  const modes = parsed.searchParams.getAll("sslmode");
  if (modes.length !== 1) {
    throw configError("exactly one explicit sslmode=verify-full is required");
  }
  const mode = modes[0].toLowerCase();
  if (mode === "verify-full" && modes[0] === "verify-full") return connectionString;
  if (mode !== "verify-full" && !LEGACY_STRICT_ALIASES.has(mode)) {
    throw configError("insecure or unrecognized sslmode");
  }

  // Canonicalize all historically strict aliases BEFORE passing them to pg;
  // future pg versions must never reinterpret an existing application URL
  // with weaker libpq semantics. This does not relax certificate validation.
  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}
