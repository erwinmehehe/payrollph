export declare const ORACLE_BASE: string;
export declare const ORACLE_HELD_METHODS: readonly string[];
export declare function verifyOracleSourceHolds(manifest: unknown, before?: unknown, read?: (path: string, encoding: string) => string): Set<string>;
export declare function isVerifiedOracleHold(manifest: unknown, path: string, verb: string): boolean;
export declare function isVerifiedOracleRenewal(manifest: unknown, path: string, verb: string): boolean;
export declare function isVerifiedOracleSupersession(manifest: unknown, path: string, verb: string): boolean;
export declare function verifiedOracleRenewalKeys(manifest: unknown): Set<string>;
export declare function withdrawRunOracleCredits(options?: { write?: boolean }): {
  write: boolean; sourceBase: string; held: number; covered: number; gap: number; newCredits: number; execution: string;
};
