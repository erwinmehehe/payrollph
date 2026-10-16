#!/usr/bin/env node
/**
 * #1019 — fail-closed local-only Drizzle push.
 *
 * drizzle-kit@0.31.11 can print PostgreSQL error 2BP01 yet exit with 0.
 * Always check both channels and require an affirmative, unambiguous result.
 * The existing isolated-target guard is retained; never use this for Neon,
 * production, historical migration adoption, bank data, or actual payroll.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolatedDbPushTarget } from "./lib/isolated-db-push-target.mjs";
import { ensurePinnedKitOrdinalityPatch } from "./lib/drizzle-kit-03111-ordinality-hotfix.mjs";
import "dotenv/config";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "node_modules", "drizzle-kit", "bin.cjs");
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_DURATION_MS = 10 * 60 * 1000;
const ANSI = /\u001b\[[0-9;]*m/g;

export function classifyStrictDbPush(exitCode, stdout, stderr) {
  const output = (String(stdout ?? "") + "\n" + String(stderr ?? "")).replace(ANSI, "");
  if (exitCode !== 0) throw new Error("STRICT_DB_PUSH_NONZERO_EXIT");
  // Drizzle may exit zero after a database error (including SQLSTATE 2BP01).
  if (/(?:^|\n)\s*(?:error|fatal|exception)\s*[:[(]|\bSQLSTATE\b|\b2BP01\b|\bfailed to execute\b|\bfailed to apply\b|\binteractive prompts require a TTY\b/i.test(output)) {
    throw new Error("STRICT_DB_PUSH_REPORTED_ERROR");
  }
  const applied = /\bchanges applied\b/i.test(output);
  const unchanged = /\bno changes detected\b/i.test(output);
  // An alleged no-op with DDL in the output is NOT proof of idempotency.
  if (applied === unchanged ||
      (unchanged && /\b(?:ALTER\s+TABLE|DROP\s+CONSTRAINT|DROP\s+INDEX|CREATE\s+TABLE|CREATE\s+INDEX|TRUNCATE)\b/i.test(output))) {
    throw new Error("STRICT_DB_PUSH_UNPROVEN_RESULT");
  }
  return unchanged ? "no-op" : "applied";
}

export async function runStrictDbPush(env = process.env) {
  // The guard throws before checking the binary or opening any DB connection.
  assertIsolatedDbPushTarget(env.DATABASE_URL, env);
  if (!existsSync(BIN)) throw new Error("STRICT_DB_PUSH_PINNED_KIT_MISSING");
  // Do not bypass the vendor CLI. Correct the two known 0.31.11 introspection
  // queries in the local installed copy, then run the original strict push.
  // The pinned version/layout check fails closed; RC-only CI remains separate.
  ensurePinnedKitOrdinalityPatch(BIN, env);
  // Only the dedicated disposable CI diagnosis may opt into vendor verbosity.
  // The ordinary first/second npm run db:push invocations remain identical.
  const verbose = env.CI === "true" && env.GITHUB_ACTIONS === "true" &&
    env.ISSUE_1019_REHEARSAL === "disposable-ci-only" &&
    env.ISSUE_1019_VERBOSE === "true";
  const child = spawn(process.execPath, [BIN, "push", ...(verbose ? ["--verbose"] : [])], {
    cwd: ROOT,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", oversized = false, launchError = false;
  child.on("error", () => { launchError = true; });
  for (const [stream, label] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
    stream.on("data", data => {
      const value = data.toString("utf8");
      if (label === "stdout") stdout += value;
      else stderr += value;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        oversized = true;
        child.kill();
      }
    });
  }
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; child.kill(); }, MAX_DURATION_MS);
  let code;
  try {
    code = await new Promise(resolveClose => child.once("close", resolveClose));
  } finally {
    clearTimeout(deadline);
  }
  if (launchError || oversized || timedOut) throw new Error("STRICT_DB_PUSH_RUNNER_FAILED");
  if (verbose) {
    // Deliberately never print vendor output or SQL. This is a third, bounded
    // disposable-only diagnostic invocation, not evidence for the second no-op.
    const output = (stdout + "\n" + stderr).replace(ANSI, "");
    const patterns = {
      drop_index: /\bDROP\s+INDEX\b/gi,
      create_index: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/gi,
      alter_table: /\bALTER\s+TABLE\b/gi,
      add_constraint: /\bADD\s+CONSTRAINT\b/gi,
      drop_constraint: /\bDROP\s+CONSTRAINT\b/gi,
      set_default: /\bSET\s+DEFAULT\b/gi,
      drop_default: /\bDROP\s+DEFAULT\b/gi,
      create_table: /\bCREATE\s+TABLE\b/gi,
      interactive_prompt: /\b(?:yes|no|select|continue|prompt)\b/gi,
    };
    const operations = Object.fromEntries(Object.entries(patterns)
      .map(([key,pattern])=>[key,[...output.matchAll(pattern)].length]));
    const knownNames = [
      "labor_gl_mappings_scope_unique",
      "staffing_requirement_role_unique",
      "hcm_skill_expectation_defaults_scope_unique",
      "wfm_staffing_policy_scope_version_unique",
      "documents_org_employee_id_hr_cases_unique",
      "employee_hr_cases_coe_document_tenant_fk",
    ].filter(name=>output.includes(name));
    process.stderr.write("ISSUE_1019_DISPOSABLE_VENDOR_PLAN="+JSON.stringify({
      exitCode:code,outputBytes:Buffer.byteLength(output),operations,knownNames,
    })+"\n");
  }
  // Diagnostic classification for *disposable* issue-1019 CI only. Never emit
  // vendor output: SQL statements and connection details may contain secrets.
  if (code !== 0 && env.CI === "true" && env.GITHUB_ACTIONS === "true" &&
      env.ISSUE_1019_REHEARSAL === "disposable-ci-only") {
    const output = (stdout + "\n" + stderr).replace(ANSI, "");
    const signals = [
      ["dependency-constraint", /\b2BP01\b|dependent objects still exist/i],
      ["duplicate-object", /\b42P07\b|already exists/i],
      ["undefined-object", /\b42P01\b|does not exist/i],
      ["syntax", /\b42601\b|syntax error/i],
      ["permission", /\b42501\b|permission denied/i],
      ["interactive", /interactive|prompt|TTY|do you want|proceed|abort|cancel/i],
      ["node-exception", /TypeError|ReferenceError|SyntaxError|ERR_[A-Z_]+|at [^\n]+:\d+:\d+/i],
      ["drizzle-disclaimer", /warning|drizzle|introspect|pulling schema|changes detected/i],
      ["ddl-candidate", /DROP|ALTER|CREATE|constraint|index/i],
      ["terminal-ui", /press enter|select an option|confirm action|do you want to continue/i],
    ].filter(([, pattern]) => pattern.test(output)).map(([name]) => name);
    // Only report allowlisted UI/control signals; no SQL, identifiers or values.
    const probes = {
      prompt_question: /\?|select|choose|yes|no|confirm/i.test(output),
      ansi_control: /\u001b\[/.test(stdout),
      cursor_control: /\u001b\[(?:\?25|[0-9]+[ABCDJK])/i.test(stdout),
      warning: /warning|caution|attention/i.test(output),
      drift: /changes detected|schema changes|alter table|drop constraint/i.test(output),
      terminal_required: /tty|interactive|stdin|terminal/i.test(output),
      error_phrase: /error|exception|failed|abort/i.test(output),
      no_changes: /no changes detected/i.test(output),
      changes_applied: /changes applied/i.test(output),
    };
    process.stderr.write("ISSUE_1019_CLI_PROBES=" + Object.entries(probes)
      .filter(([, active]) => active).map(([key]) => key).join(",") +
      "; lines=" + output.split("\n").length +
      "; control_bytes=" + (stdout.match(/[\u0000-\u001f]/g) || []).length + "\n");
    process.stderr.write("ISSUE_1019_VENDOR_EXIT=" + String(code) +
      "; categories=" + (signals.join(",") || "unclassified") +
      "; line_lengths=" + output.split("\n").map(line => line.length).filter(Boolean).slice(0,35).join(",") +
      "; stdout_bytes=" + Buffer.byteLength(stdout) +
      "; stderr_bytes=" + Buffer.byteLength(stderr) + "\n");
  }
  const status = classifyStrictDbPush(code, stdout, stderr);
  // Never echo stdout/stderr: PostgreSQL errors sometimes contain SQL text.
  process.stdout.write(status === "no-op"
    ? "[✓] No changes detected\n"
    : "[✓] Changes applied\n");
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runStrictDbPush().catch(error => {
    const code = error instanceof Error &&
      /^(?:STRICT_DB_PUSH_[A-Z_]+|DB_PUSH_[A-Z_]+)$/.test(error.message)
      ? error.message : "STRICT_DB_PUSH_EXECUTION_FAILED";
    process.stderr.write(code + "\n");
    process.exitCode = 1;
  });
}
