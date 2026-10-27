# Leave preview tenant proof (provisional)

The dedicated `POST /api/leave/preview` proof uses two independently authenticated fictional employer owners and a populated third employer with higher IDs. Each attacker receives an identity-bound own preview, is denied the victim organization, and is denied when a real victim worker ID is forged into the attacker's organization. The victim also receives its own positive preview. The proof compares employee, leave request, leave balance, audit and payroll state for all three employers before and after the requests; the preview is read-only.

The local disposable PostgreSQL/HTTP run and a deliberately no-op own-data assertion mutation were executed. The mutation was rejected because it accepted another employer's data. The GitHub Actions job is pending on the new PR head; this is not production, payroll, employee-role or whole-family acceptance.

This read-only POST is not a table write: it does not persist a change. No existing manifest credit is generated and the method remains GAP until reviewed proof and an appropriate credit workflow are integrated. Leave submission and conversion are not exercised. No deployment, production flag, provider, real employee or real payroll is involved.
