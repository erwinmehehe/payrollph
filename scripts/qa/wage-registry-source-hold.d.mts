/**
 * Type surface for the source-only QA module. Runtime assertions and source
 * pins are implemented in wage-registry-source-hold.mjs, not in these types.
 * A typed import keeps the production TypeScript build strict.
 */
export declare const WAGE_PROOF_SOURCE: string;
export declare const WATCH_PROOF_SOURCE: string;
export declare const PRIOR_WAGE_BLOB_SHA: string;
export declare const NEW_WAGE_BLOB_SHA: string;
export declare const PRIOR_WATCH_BLOB_SHA: string;
export declare const NEW_WATCH_BLOB_SHA: string;
export declare const WAGE_SOURCE_HELD_METHODS: readonly string[];
export declare function verifyWageRegistrySourceHold(
  manifest: unknown,
  path: string,
  verb: string,
  read?: (...args: any[]) => string | Buffer
): boolean;
export declare function verifyAllWageRegistrySourceHolds(
  manifest: unknown,
  read?: (...args: any[]) => string | Buffer
): string[];
export declare function reviewedWageRegistrySourceWithdrawals(
  before: unknown,
  after: unknown,
  read?: (...args: any[]) => string | Buffer
): Set<string>;
export declare function historicWageRegistryProofView<T>(
  manifest: T,
  read?: (...args: any[]) => string | Buffer
): T;
