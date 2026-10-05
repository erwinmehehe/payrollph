export type DeveloperDoc = {
  slug: string;
  title: string;
  description: string;
  intro: string;
  sections: Array<{
    title: string;
    body: string;
    bullets?: string[];
    code?: string;
  }>;
  related: Array<{ label: string; href: string; description: string }>;
};

export const developerDocs: DeveloperDoc[] = [
  {
    slug: "authentication",
    title: "API Authentication & Scopes",
    description: "How Linaw API keys are created, stored, scoped, revoked and used to authenticate public API requests.",
    intro: "Linaw API keys are organization-scoped credentials created by company-wide administrators. The full key is shown once, while only a SHA-256 hash is stored after creation.",
    sections: [
      {
        title: "Create keys from an authenticated administrator session",
        body: "Developer credential changes require an authorized company-wide administrator and a sensitive-action MFA check. API key creation is not exposed as an unauthenticated public endpoint.",
        bullets: ["Company-wide administrator access", "Sensitive-action MFA", "Same-origin mutation enforcement", "Rate-limited credential changes"],
      },
      {
        title: "Use the minimum scopes required",
        body: "The current public API recognizes three explicit scopes. Requests without the required scope return 403 rather than silently broadening access.",
        bullets: ["employees:read", "employees:write", "payroll:read"],
      },
      {
        title: "Keep API keys out of client-side code",
        body: "Treat an API key like a server credential. Do not embed it in browser JavaScript, public repositories or mobile application bundles.",
        code: `Authorization: Bearer <your-api-key>`,
      },
      {
        title: "Revoke keys instead of recycling them",
        body: "Linaw stores revokedAt on API credentials and exposes key metadata without returning the full secret after creation.",
      },
    ],
    related: [
      { label: "Employee API", href: "/developers/employees", description: "Read and create employee records with scoped API keys." },
      { label: "Payroll Runs API", href: "/developers/payroll-runs", description: "Read payroll run summaries with payroll:read." },
      { label: "Webhooks", href: "/developers/webhooks", description: "Receive signed payroll and employee events." },
    ],
  },
  {
    slug: "employees",
    title: "Employees API",
    description: "Read paginated employee records and create employees through the Linaw public API.",
    intro: "The employee API is organization-scoped through the API key. Reads require employees:read, while writes require employees:write.",
    sections: [
      {
        title: "List employees",
        body: "GET /api/v1/employees returns a paginated list scoped to the API key's organization. Limit is bounded to 200 and the response includes total, offset and hasMore.",
        code: `GET /api/v1/employees?limit=50&offset=0
Authorization: Bearer <your-api-key>`,
      },
      {
        title: "Create an employee",
        body: "POST /api/v1/employees validates required names, title, start date and pay-profile fields before creating the employee and associated pay profile.",
        code: `POST /api/v1/employees
Authorization: Bearer <your-api-key>
Idempotency-Key: hire-2026-001
Content-Type: application/json

{
  "firstName": "Maria",
  "lastName": "Santos",
  "title": "Payroll Analyst",
  "payBasis": "monthly",
  "rateAmount": 45000,
  "standardWorkDaysPerMonth": 22,
  "standardHoursPerDay": 8,
  "startDate": "2026-10-15"
}`,
      },
      {
        title: "Use idempotency for retried creates",
        body: "If an Idempotency-Key is supplied, Linaw stores and can replay the previous response for the same organization, key and endpoint instead of creating a duplicate employee.",
      },
      {
        title: "Expect explicit validation errors",
        body: "Invalid employee data returns a 422 response with a list of problems instead of partially creating a record.",
      },
    ],
    related: [
      { label: "Authentication", href: "/developers/authentication", description: "Review API key scopes and credential handling." },
      { label: "Webhooks", href: "/developers/webhooks", description: "Employee creation can emit employee.onboarded events." },
      { label: "HRIS", href: "/hris", description: "See the product workflow behind employee records." },
    ],
  },
  {
    slug: "payroll-runs",
    title: "Payroll Runs API",
    description: "Read payroll run summaries through the Linaw public API with payroll:read scope.",
    intro: "The payroll-runs endpoint is currently read-only. It exposes payroll run status and summary values for the organization associated with the API key.",
    sections: [
      {
        title: "List payroll runs",
        body: "GET /api/v1/payroll-runs returns runs in descending order with bounded pagination.",
        code: `GET /api/v1/payroll-runs?limit=25&offset=0
Authorization: Bearer <your-api-key>`,
      },
      {
        title: "Response fields are operational summaries",
        body: "Current responses include period, scope, status, pay date, employee count, gross pay, net pay, exceptions, rule version and chunk-processing progress.",
      },
      {
        title: "The API does not release payroll",
        body: "The public payroll-runs route is read-only. Payroll processing, approval and release remain protected product workflows rather than API-key actions.",
      },
      {
        title: "Rate limits apply before data access",
        body: "The endpoint applies distributed API rate limiting and returns 429 when the request allowance is exceeded.",
      },
    ],
    related: [
      { label: "Authentication", href: "/developers/authentication", description: "Use the payroll:read scope." },
      { label: "Webhooks", href: "/developers/webhooks", description: "Receive payroll.processed and payroll.released events." },
      { label: "Payroll software", href: "/", description: "See the controlled payroll workflow behind these summaries." },
    ],
  },
  {
    slug: "webhooks",
    title: "Webhooks & Signature Verification",
    description: "Receive signed Linaw payroll, employee, leave and approval events with retry-aware delivery behavior.",
    intro: "Linaw webhooks use per-endpoint secrets and an HMAC-SHA256 signature. Delivery attempts are logged and failed deliveries can be retried using a bounded backoff schedule.",
    sections: [
      {
        title: "Supported events",
        body: "Webhook subscriptions can currently select from the implemented event list.",
        bullets: ["payroll.released", "payroll.processed", "employee.onboarded", "employee.offboarded", "leave.approved", "approval.decided"],
      },
      {
        title: "Verify the Linaw-Signature header",
        body: "The signature is generated from timestamp.payload using the endpoint secret. Receivers should verify the HMAC and enforce a timestamp tolerance before accepting the event.",
        code: `Linaw-Signature: t=<unix-timestamp>,v1=<hmac-sha256>
Linaw-Event: payroll.released
Linaw-Attempt: 1`,
      },
      {
        title: "Expect a stable event envelope",
        body: "Each delivery includes an event id, event name, createdAt timestamp, organizationId and data payload.",
        code: `{
  "id": "evt_...",
  "event": "payroll.released",
  "createdAt": "2026-10-05T03:00:00.000Z",
  "organizationId": 42,
  "data": { }
}`,
      },
      {
        title: "Return a successful HTTP response promptly",
        body: "Non-success responses and transport failures are recorded. Linaw can retry failed deliveries until the delivery reaches its maximum-attempt state.",
      },
    ],
    related: [
      { label: "Authentication", href: "/developers/authentication", description: "Webhook administration uses the same protected developer area." },
      { label: "Employee API", href: "/developers/employees", description: "Connect employee workflows with webhook events." },
      { label: "Security", href: "/security", description: "Review request and credential security controls." },
    ],
  },
];

export function developerDoc(slug: string) {
  return developerDocs.find((doc) => doc.slug === slug);
}
