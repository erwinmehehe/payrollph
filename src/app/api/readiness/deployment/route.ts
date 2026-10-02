export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      deploymentEnvironment: process.env.VERCEL_ENV ?? null,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
