import type assert from 'node:assert/strict';

type Manifest = Parameters<typeof import('./tenant-counts.mjs').assertLiveTenantCounts>[1];

/** Validate the complete live withdrawal and exact fetched-base ledger delta. */
export function assertWageLedgerDelta(assertions: typeof assert, manifest: Manifest): boolean;
