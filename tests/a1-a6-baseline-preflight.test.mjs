import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = mkdtempSync(path.join(tmpdir(), 'a1a6-preflight-'));
const script = fileURLToPath(new URL('../scripts/qa/a1-a6-baseline-preflight.sh', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

try {
  git('init', '-q', '--initial-branch=main');
  git('config', 'user.email', 'synthetic@example.invalid');
  git('config', 'user.name', 'Synthetic QA');
  mkdirSync(path.join(repo, 'src', 'db'), { recursive: true });
  const schema = path.join(repo, 'src', 'db', 'schema.ts');
  writeFileSync(schema, 'export const organizations = pgTable("organizations", {});\n');
  git('add', '.');
  git('commit', '-q', '-m', 'pre-feature baseline');
  const oldBase = git('rev-parse', 'HEAD');
  git('switch', '-q', '-c', 'legacy-integration');
  git('commit', '-q', '--allow-empty', '-m', 'legacy integration');
  const legacyHead = git('rev-parse', 'HEAD');
  git('switch', '-q', 'main');
  writeFileSync(schema, 'export const employeeHrCases = pgTable("employee_hr_cases", {});\n' +
    'export const applicantPrivacyEvidence = pgTable("applicant_privacy_evidence", {});\n');
  git('add', '.');
  git('commit', '-q', '-m', 'merged A2 and A3');
  const newBase = git('rev-parse', 'HEAD');

  // Keep separate historical snapshots: the preflight must read the requested
  // base COMMIT, not the current working tree or a generated PR merge checkout.
  writeFileSync(schema,
    'export const employeeHrCases = pgTable(\n  "employee_hr_cases",\n  {}\n);\n' +
    "export const applicantPrivacyEvidence = pgTable(\n  'applicant_privacy_evidence',\n  {}\n);\n"
  );
  git('add', '.');
  git('commit', '-q', '-m', 'real schema with multiline merged tables');
  const multilineBase = git('rev-parse', 'HEAD');
  writeFileSync(schema, '');
  git('add', '.');
  git('commit', '-q', '-m', 'malformed empty pinned schema');
  const emptyBase = git('rev-parse', 'HEAD');

  const check = (base, head, extraEnv = {}) => spawnSync('bash', [script], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, CI: 'true', A1_A6_DISPOSABLE_MIGRATION_MODE: 'isolated-ci-only',
      A1_A6_BASE_SHA: base, A1_A6_HEAD_SHA: head, ...extraEnv },
  });

  test('accepts a pinned ancestral pre-feature baseline without live database access', () => {
    const r = check(oldBase, legacyHead);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /synthetic only, not release-certified/);
  });
  test('rejects old feature head behind current main before schema bootstrap', () => {
    const r = check(newBase, legacyHead);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not contain main base/);
  });
  test('rejects modern main with already merged A2 and A3 tables', () => {
    const r = check(newBase, newBase);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already defines HR-case and\/or applicant-privacy/);
  });
  test('rejects multiline Drizzle declarations with both quote styles', () => {
    const r = check(multilineBase, multilineBase);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /already defines HR-case and\/or applicant-privacy/);
  });
  test('rejects an empty schema rather than approving a degenerate baseline', () => {
    const r = check(emptyBase, emptyBase);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /Pinned base Drizzle schema is empty/);
  });
  test('rejects invalid refs rather than silently testing checkout merge SHA', () => {
    const r = check('main', legacyHead);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /invalid exact base SHA/);
  });
  test('requires isolated CI mode, not developer or production environment', () => {
    const r = check(oldBase, legacyHead, { CI: 'false' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CI=true is required/);
  });
} finally {
  // node:test callbacks run after registration. Remove the repo when tests end.
  process.on('exit', () => rmSync(repo, { recursive: true, force: true }));
}
