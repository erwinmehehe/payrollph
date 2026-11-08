# Three-method recovery: fictional local PostgreSQL 16

Evidence label: **SOLO_VERIFIED_DEV_RECOVERY**. No independent or production acceptance.

The current-main baseline has 436 COVERED / 51 GAP / 11 PUBLIC methods. This
proposal adds exactly three distinct methods, for **439 COVERED / 48 GAP / 11 PUBLIC**:

| Method | Executed boundary |
|---|---|
| GET auth/totp/setup | Two signed-in accounts return only their own disabled status despite real victim selectors; enabled victim response fails the own-status discriminator. This self-account route ignores selectors; a fabricated 403 is not claimed. |
| POST auth/totp/setup | Both accounts begin, rotate and verify enrollment. Wrong victim password is denied, secrets remain encrypted, backup codes are hashed, only the proving session becomes MFA verified, and victim SQL remains unchanged. |
| POST workforce-planning/scenarios | Seven persisted creates, twelve denied requests, seven actual wrong-employer discriminators, two reached audit-veto rollbacks, immutable versions, and revoked membership denied. |

The fresh production-build HTTP/PG16 run used committed source
`5583a43f1a58584b56673cfbc53d90cea07c1e4d`. The sealed receipt at
`scripts/qa/tenant-merged-recovery-receipt.json` pins 83 transitive runtime,
proof, schema and configuration inputs. Metadata-only credit changes do not
alter those executed inputs. Both original hosted-CI entry gates remain;
the explicit local path additionally verifies PostgreSQL 16's actual data
directory belongs to this worktree's disposable `outputs/recovery-pg16` cluster.
No GitHub Actions identity is fabricated. No routes or shared proof lines change.

The launcher refuses dotenv files, external credentials, unrelated databases,
and enabled money/provider/history/CSP/worker flags. Fixture keys remain in
untracked outputs. One build is reused, with a fresh empty database per family.

```powershell
node scripts/qa/tenant-recovery-local.mjs db
node scripts/qa/tenant-recovery-local.mjs build
# Separate terminal; loopback server only:
node scripts/qa/tenant-recovery-local.mjs start
node scripts/qa/tenant-recovery-local.mjs totp
# Stop only that server; reset the owned disposable DB and restart for scenarios.
node scripts/qa/tenant-recovery-local.mjs scenarios
node scripts/qa/tenant-merged-recovery-credit.mjs --check
```

PostgreSQL must already be running from the worktree-owned disposable cluster.
The credit command refuses duplicate credits and requires the exact executed
run label; do not re-run it against already COVERED methods. New source drift
requires another real execution and reviewed receipt, never silent repinning.

Multi-entity transfers, enterprise administration, billing subscriptions, email
requests, HCM SLA, marketing and database-target readiness are outside this PR.
Their open work and evidence are not borrowed or double-counted. Production,
provider, real money, real employer and deployment operations are not authorized.
