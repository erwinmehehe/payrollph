export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      type: "oauthbearertoken",
      name: "Bearer token",
      description: "Use the one-time SCIM bearer token created by a Linaw workspace administrator.",
      specUri: "https://www.rfc-editor.org/rfc/rfc6750",
      primary: true,
    }],
    meta: { resourceType: "ServiceProviderConfig", location: "/api/scim/v2/ServiceProviderConfig" },
  }, { headers: { "Content-Type": "application/scim+json" } });
}
