export const MERGED_PROOF_SPECS: readonly {
  route: string; method: string; file: string; own: number; foreign: number;
  forged: number; unchanged: number; ordering: number; ownStatus: number;
}[];
export function verifyMergedProofCredits(manifest: unknown, read?: (file: string) => string): number;
