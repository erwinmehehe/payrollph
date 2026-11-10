import { samlDisabledBoundaryResponse } from "@/lib/saml-disabled-boundary";

export const dynamic = "force-dynamic";

// SAML assertion verification is disabled. Never resolve caller-supplied provider IDs.
export async function POST(
  _request: Request,
  _context: { params: Promise<{ providerId: string }> },
) {
  return samlDisabledBoundaryResponse();
}
