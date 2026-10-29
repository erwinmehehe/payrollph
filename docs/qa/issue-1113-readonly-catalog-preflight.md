# Issue #1113 read-only catalog closure preflight

The original worksite decision and separation schema repair is already merged (#1177), with fictional PG16 authenticated localhost regression (#1476). This preflight **does not** certify a deployment, complete an independent migration review or close #1113.

Run **only** against an operator-confirmed isolated fictional QA database. Use ephemeral credentials without copying or logging URLs:

```sh
ISSUE1113_FICTIONAL_QA=I_CONFIRM_FICTIONAL_ISOLATED_DB \
  DATABASE_URL='(operator-provided isolated QA URL)' \
  node scripts/qa/issue-1113-catalog-readonly.mjs
```

The script opens a PostgreSQL `REPEATABLE READ, READ ONLY` transaction with a 7-second statement timeout, inspects only catalog metadata, rolls back, and prints no employee records or secrets. **Never run it against production.** The process reports an error if the required 10/38 columns, worksite decision schema, separation identity check or migration journal are absent.

The default Neon branch on 2026-10-29 had the 10/38 columns but **did not expose `public.payrollph_schema_migrations`** to a narrow catalog query. This is a historical receipt/reconciliation gap; it is **not permission to replay migration 0130/0131**. The guarded scripts refuse already-present columns.

Remaining independent acceptance: protected deployed SHA and actual app DB identity, signed-in hosted Owner/HR nonempty results on fictional staging, foreign tenant and revoked-role negative cases, then DBA and release-owner signoff. Leave #1113 open until those are witnessed.
