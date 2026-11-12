export const ORACLE_BASE: string;
export const ORACLE_HELD_METHODS: readonly string[];
export function verifyOracleSourceHolds(manifest: unknown, before?: unknown, read?: (path: string, encoding: string) => string): Set<string>;
export function withdrawRunOracleCredits(options?: { write?: boolean }): {
  write: boolean; sourceBase: string; held: number; covered: number; gap: number; newCredits: number; execution: string;
};
