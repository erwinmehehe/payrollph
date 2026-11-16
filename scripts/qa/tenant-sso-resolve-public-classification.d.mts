/** Type contract for the owner-approved SSO resolve public label verifier. It grants no coverage credit. */
export function verifySsoResolveClassification(manifest: unknown, read?: (path: string, ...args: unknown[]) => unknown): number;
export function ssoResolveClassificationDelta(before: unknown, manifest: unknown, read?: (path: string, ...args: unknown[]) => unknown): number;
export function classifySsoResolve(options?: { write?: boolean }): {
  write: boolean;
  relabelled: number;
  newCoveredCredits: number;
  before: unknown;
  after: unknown;
};
export const SSO_RESOLVE_EVIDENCE: string;
export function historicalSsoResolveView<T>(manifest: T, read?: (path: string, ...args: unknown[]) => unknown): T;
