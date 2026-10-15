/**
 * Explicit entry point for protected TLS acceptance.
 * Not imported by unit tests or normal app paths.
 */
import { runOperatorProbe } from "./verify-postgresql-tls-operator";

if (process.env.PG_TLS_OPERATOR_ACK !== "authorized-readonly-tls-acceptance") {
  console.error("FAIL protected operator authorization flag missing; no connection attempted");
  process.exitCode = 1;
} else {
  void runOperatorProbe(process.env.DATABASE_URL).catch(() => {
    // Never print exception details: they could include connection metadata.
    console.error("FAIL protected PostgreSQL TLS acceptance; see private operator runbook");
    process.exitCode = 1;
  });
}
