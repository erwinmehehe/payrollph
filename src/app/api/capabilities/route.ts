import { buildCapabilityReport } from "@/lib/capabilities";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await buildCapabilityReport());
}
