/** Type declarations for the review-only table candidate source inventory. */
export declare const NEW_FOUR: readonly string[];
export declare const EXISTING_NINETEEN: readonly string[];
export declare const CANDIDATE_GROUPS: readonly Readonly<{
  id: string;
  kind: "new" | "existing" | "superseded";
  tables: readonly string[];
  files: readonly string[];
}>[];
