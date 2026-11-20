type RouteWithProofs = {
  methods: Array<{ testedBy?: { kind?: string } | null }>;
};

export function hasSeparationPromotions(file: RouteWithProofs | undefined): boolean;
export function verifySeparationRenewal(manifest: unknown): number;
