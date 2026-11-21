import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Client } from 'pg';
import { requireFictionalJourney, reconcileFirstPayroll } from './first-payroll-full-contract.mjs';

const { database } = requireFictionalJourney();
assert.equal(process.env.CI, 'true');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(database.port, '5432');
assert.equal(process.env.XENDIT_BILLING_ENABLED, 'false');
assert.notEqual(process.env.XENDIT_PAYOUTS_LIVE_APPROVED, 'true');

const container = process.env.FIRST_PAYROLL_RESTORE_CONTAINER ?? '';
assert.match(container, /^[a-f0-9]{64}$/);
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const psql = (name, query) => docker('exec', container, 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', name, '-c', query);
const identityQuery = "SELECT system_identifier::text || ':' || current_setting('server_version_num') FROM pg_control_system()";
assert.equal(docker('inspect', '--format', '{{.Config.Image}}', container), 'postgres:16');
const identity = psql('app_db', identityQuery);
assert.match(identity, /^\d+:16\d{4}$/);

const browser = JSON.parse(readFileSync('outputs/first-payroll-browser-journey.json', 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(browser.sourceCommit, sourceCommit);
assert.equal(browser.result, 'PASS');
assert.equal(browser.providerCalls, 0);
assert.ok(Number.isSafeInteger(browser.runId) && browser.runId > 0);

const source = new Client({ connectionString: database.href });
await source.connect();
try {
  const { rows } = await source.query(`SELECT (${identityQuery}) AS identity,
    EXISTS (
      SELECT 1 FROM payroll_runs r JOIN payroll_entries p ON p.payroll_run_id = r.id
      JOIN employees e ON e.id = p.employee_id AND e.organization_id = r.organization_id
      WHERE r.id = $1 AND r.status = 'Released' AND e.employee_no ~ '^BROWSER-[a-f0-9]{8}$'
    ) AS fixture`, [browser.runId]);
  assert.deepEqual(rows[0], { identity, fixture: true });
} finally {
  await source.end();
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fingerprint = (value) => sha256(JSON.stringify(value));

async function snapshot() {
  const name = process.argv[3] ?? '';
  assert.match(name, /^(app_db|dr_payroll_restore_[a-f0-9]{32})$/);
  database.pathname = '/' + name;
  process.env.DATABASE_URL = database.href;
  process.env.PGOPTIONS = '-c default_transaction_read_only=on';
  const { db, pool } = await import('../../src/db/index.ts');
  const { auditEvents, employees, payrollEntries, payrollRuns, payslips } = await import('../../src/db/schema.ts');
  const { verifyAuditChain } = await import('../../src/lib/audit-chain.ts');
  const { releasedEmployerPhilHealth } = await import('../../src/lib/payroll-journal-evidence.ts');
  const { buildReleasedPayrollJournal, payrollJournalToCsv } = await import('../../src/lib/payroll-journal-export.ts');
  try {
    const connection = await pool.query(`SELECT (${identityQuery}) AS identity, current_database() AS name,
      current_setting('transaction_read_only') AS read_only`);
    assert.deepEqual(connection.rows[0], { identity, name, read_only: 'on' });

    const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, browser.runId));
    assert.ok(run, 'browser payroll run must exist');
    assert.equal(run.status, 'Released');
    assert.equal(run.grossPay, '15000.00');
    assert.equal(run.netPay, '13271.30');
    assert.equal(run.grossPay, browser.gross);
    assert.equal(run.netPay, browser.net);
    const entries = await db.select({ entry: payrollEntries, employee: employees }).from(payrollEntries)
      .innerJoin(employees, eq(employees.id, payrollEntries.employeeId))
      .where(eq(payrollEntries.payrollRunId, run.id)).orderBy(asc(payrollEntries.id));
    assert.equal(entries.length, 1);
    reconcileFirstPayroll(run, entries.map(row => row.entry));
    const [{ entry, employee }] = entries;
    assert.match(employee.employeeNo, /^BROWSER-[a-f0-9]{8}$/);
    assert.equal(employee.organizationId, run.organizationId);

    const slips = await db.select().from(payslips).where(eq(payslips.payrollEntryId, entry.id));
    assert.equal(slips.length, 1);
    const [slip] = slips;
    assert.equal(slip.organizationId, run.organizationId);
    assert.equal(slip.employeeId, entry.employeeId);
    const pdf = Buffer.from(slip.content);
    assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
    assert.ok(pdf.includes('13271.30'), 'the restored stored PDF must contain the exact net pay');

    const [journalEvidence] = await db.select({ employerPhilHealth: releasedEmployerPhilHealth })
      .from(payrollRuns).where(eq(payrollRuns.id, run.id));
    const lines = buildReleasedPayrollJournal([{ ...run, ...journalEvidence }]);
    assert.deepEqual(lines.map(line => [line.accountCode, line.debitCentavos, line.creditCentavos]), [
      ['6000', 1500000, 0],
      ['2100', 0, 172870],
      ['2200', 0, 1327130],
      ['philhealth_employer_expense', 37500, 0],
      ['philhealth_employer_payable', 0, 37500],
    ]);

    const audit = await verifyAuditChain(run.organizationId);
    assert.ok(audit.verified && audit.chainedEvents > 0 && audit.pendingSealEvents === 0, 'payroll audit chain must verify');
    const auditRows = await db.select({ id: auditEvents.id, action: auditEvents.action, hash: auditEvents.rowHash })
      .from(auditEvents).where(and(eq(auditEvents.organizationId, run.organizationId),
        sql`${auditEvents.metadata}->>'runId' = ${String(run.id)}`)).orderBy(asc(auditEvents.id));
    for (const action of ['Payroll released', 'Payslip downloaded']) {
      assert.ok(auditRows.some(row => row.action === action), 'missing run audit event: ' + action);
    }

    return {
      payroll: { runId: run.id, gross: run.grossPay, net: run.netPay, entries: entries.length,
        digest: fingerprint({ run, entry }) },
      payslips: { count: slips.length, pdfSha256: sha256(pdf), recordSha256: fingerprint(slip) },
      journal: { lineCount: lines.length, debitCentavos: 1537500, creditCentavos: 1537500,
        csvSha256: sha256(payrollJournalToCsv(lines)) },
      audit: { chainedEvents: audit.chainedEvents, pendingSealEvents: audit.pendingSealEvents,
        headHash: audit.headHash, runEvents: auditRows.length, runEventSha256: fingerprint(auditRows) },
    };
  } finally {
    await pool.end();
  }
}

if (process.argv[2] === 'snapshot') {
  console.log(JSON.stringify(await snapshot()));
} else {
  const snapshotDatabase = (name) => JSON.parse(execFileSync(process.execPath, [
    '--import', 'tsx', fileURLToPath(import.meta.url), 'snapshot', name,
  ], { encoding: 'utf8' }));
  const restoredName = 'dr_payroll_restore_' + randomUUID().replaceAll('-', '');
  const archive = docker('exec', container, 'mktemp', '/tmp/first-payroll-backup.XXXXXXXX');
  assert.match(archive, /^\/tmp\/first-payroll-backup\.[a-zA-Z0-9]{8}$/);
  try {
    // The workflow disables workers. Drain the fixture's pending audit chain
    // with the real database sealer before taking the baseline snapshot.
    psql('app_db', 'SELECT seal_audit_events(500)');
    const before = snapshotDatabase('app_db');
    docker('exec', container, 'pg_dump', '-U', 'postgres', '-d', 'app_db', '--format=custom',
      '--no-owner', '--no-privileges', '--file', archive);
    const archiveSha256 = docker('exec', container, 'sha256sum', archive).split(/\s+/)[0];
    assert.match(archiveSha256, /^[a-f0-9]{64}$/);
    docker('exec', container, 'createdb', '-U', 'postgres', '--template=template0', restoredName);
    assert.equal(psql(restoredName, "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"), '0');
    const started = performance.now();
    docker('exec', container, 'pg_restore', '-U', 'postgres', '-d', restoredName,
      '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', archive);
    const restoreMilliseconds = Math.round(performance.now() - started);
    const after = snapshotDatabase(restoredName);
    // Compare digests and control totals only. Do not print database rows or PDFs.
    for (const record of Object.keys(before)) {
      assert.equal(fingerprint(after[record]), fingerprint(before[record]), record + ' differs after restore');
    }
    assert.equal(fingerprint(snapshotDatabase('app_db')), fingerprint(before), 'source changed after the backup');
    writeFileSync('outputs/first-payroll-restore.json', JSON.stringify({
      result: 'PASS', sourceCommit, postgresMajor: 16, archiveSha256, restoreMilliseconds,
      verification: after, providerCalls: 0, liveFilings: 0,
    }, null, 2) + '\n');
    console.log('PASS PG16 restore: Released payroll, stored PDF, balanced journal, sealed audit chain');
  } finally {
    docker('exec', container, 'rm', '-f', '--', archive);
  }
}
