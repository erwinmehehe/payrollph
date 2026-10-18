# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This is an inventory of source-verified functionality; it is not a declaration that a release has been made.

## [Unreleased]

### Added

- Payroll-run processing and resumable work-queue logic (source: `src/lib/payroll-engine.ts`; `src/app/api/payroll-runs/[id]/process/route.ts`).
- Effective-dated Philippine statutory rule-pack lookup and regional wage-order screening data (source: `src/lib/ph-statutory-rule-packs.ts`; `src/lib/wage-orders.ts`). Wage screening is advisory and does not establish an employer-specific legal rate.
- API-key-protected employee and payroll-run API endpoints (source: `src/app/api/v1/employees/route.ts`; `src/app/api/v1/payroll-runs/route.ts`).
- Operational readiness checks for application dependencies (source: `src/lib/operational-readiness.ts`).

### Security

- Audit-chain verification compares persisted per-organization chain heads with event hashes and sequence data, with regression coverage (source: `src/lib/audit-chain.ts`; `tests/audit-chain.test.ts`). This source feature does not imply that production database controls have been deployed or verified.
