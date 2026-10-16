# PayrollPH #988 - disposable local PostgreSQL 16 QA lab

This is an opt-in **fictional-only** Postgres 16 and localhost application launcher for issue #988. It works around Vercel/Neon project-provisioning permission errors **without cloning live payroll data**. It does **not** create remote staging, complete independent human UAT, connect physical phones, certify official filings, or approve a pilot. External pilot remains **NO-GO**.

## Before starting

Use a QA-owned Windows/macOS/Linux machine with Git, Node 22, Docker Engine/Desktop and enough local capacity to build the Next.js project. Docker must be running; port 5432 must be free. Dependencies and Docker images may need network access.

**Use a separate, clean Git checkout of the exact reviewed commit.** The checkout must have no .env, .env.local, .env.development or .env.development.local files. Do not inherit DATABASE_URL, POSTGRES_URL or POSTGRES_PRISMA_URL from your shell. Never run against the existing Vercel project, a Neon copy-on-write branch containing production rows, a shared database, or an authentic payroll record.

The launcher generates new random credentials and encryption keys, uses only a disposable postgres:16 container bound to **127.0.0.1:5432**, and passes an allowlisted environment to the app with payouts, external providers, biometric/photo/geofence capture, and scheduler/worker flags disabled. It refuses to operate in GitHub Actions or when the checkout SHA changes.

## On the QA workstation, from the repository root

    npm ci
    node --test tests/uat853-local-lab.test.mjs
    node scripts/qa/uat853-local-lab.mjs start
    node scripts/qa/uat853-local-lab.mjs migrate
    node scripts/qa/uat853-local-lab.mjs status
    node scripts/qa/uat853-local-lab.mjs serve

The **start** command creates a named ephemeral PG16 container, confirms its Docker owner label, localhost port, PostgreSQL 16, UTF8 encoding and zero existing public tables. The **migrate** command calls the repository's localhost-only reviewed db:push guard on that database, checks empty organization/audit tables, applies isolated SQL migration 0109 and verifies the append-only audit trigger. A failure blocks further operation. No production migration is run.

The **serve** command launches the development app bound to localhost at http://127.0.0.1:3000. Visit **http://127.0.0.1:3000/setup** on that workstation and use **fictional information** to create the first owner. Create the second fictional employer and separate HR, manager, employee, Payroll Officer, Checker and Owner test accounts through supported product workflows. If those workflows cannot complete or privileges are incorrect, record BLOCKED/NEEDS_FIX instead of directly modifying users/payroll tables, broadening permissions or claiming a PASS.

A session's random database password, setup token and other encryption keys stay in the ignored qa-artifacts/uat853-local-lab directory with restricted local file permissions. Never copy these to GitHub, logs, screenshots or chat. The command never prints secrets. The data is ephemeral; stopping the database discards all fictional test records.

## Independent real-device testing is a separate gate

The normal `serve` command is **not reachable from a physical phone**. An optional `serve-private` mode supports an independently approved **Tailscale Serve** tailnet-only HTTPS endpoint, while keeping the Next.js server and PostgreSQL bound to localhost. This mode requires an enrolled tailnet device and explicit operator-controlled access; it does not create a Vercel deployment or publish a URL on the public internet. Confirm actual phone access, origin/CSRF handling, identity separation, deployed SHA, and the retained private QA evidence vault before recording observations. Do not make PostgreSQL public, expose the Next.js development server to the Internet, or bypass Vercel access controls to force a mobile PASS.

Follow the full #853 independent witness runbook at docs/qa/independent-journey-853.md. It requires **9 real journey stages and 10 cross-cutting observations**, separate operators and witnesses, one actual clock-to-pay period, A-B-A employer switching, immutable payroll RECORDS not funds, and four separately hashed draft agency files. This launcher does not perform those actions. The offline receipt recorder starts all 19 rows at NOT_RUN and must never invent signoffs.

## Optional protected physical-phone route — Tailscale Serve (NO Funnel)

This is an **alternative to the blocked Vercel project/Sandbox provisioning path** for independent fictional QA, not a production service. It works only on a QA-owned workstation with the existing disposable PostgreSQL 16 session, Node 22 and Docker. Tailscale must already be installed, enrolled in an approved tailnet, and configured for MagicDNS + HTTPS certificates. The QA facilitator must restrict tailnet ACLs/grants to named test accounts and verify each actual phone is enrolled. Review [Tailscale Serve guidance](https://tailscale.com/docs/features/tailscale-serve); **do not use Tailscale Funnel** or public tunneling.

1. From a new clean checkout at the **exact approved source SHA**, run the normal `npm ci`, `start`, `migrate`, and `status` commands above. **Do not** start `serve`.
2. Confirm in the Tailscale admin console that the QA laptop and test phones are authorized and HTTPS is enabled. Only a fictitious, controlled test environment is allowed.
3. In **Terminal A** on the QA machine, run the following **foreground** command and leave it open for the duration of the test:

   ```sh
   tailscale serve --https=443 http://127.0.0.1:3000
   ```

   Never add `--bg`, use `tailscale funnel`, or run a command that publishes the local service on a public network. This proxy is only to the **localhost app port 3000**. It must not expose PostgreSQL port 5432. If the device already has a Serve/Funnel configuration or an unapproved port mapping, **STOP** and use a dedicated QA machine; do not reset another person's routes.
4. In **Terminal B**, while Terminal A is running, execute:

   ```sh
   node --test tests/uat853-private-tailnet.test.mjs
   node scripts/qa/uat853-local-lab.mjs serve-private
   ```

   This fails closed unless Tailscale reports `Running` with an exact `*.ts.net` device hostname and its HTTPS 443 Serve status maps **only /** to `http://127.0.0.1:3000` with **no enabled Funnel**. The launcher keeps the database fixed on localhost and supplies the exact private origin to the app at runtime. It never reads parent/Neon/Vercel credentials, does not change the saved local-only `app.env`, and does not create or reset a Tailscale route.
5. From a **real physical phone**, enrolled in the same authorized tailnet, use the tailnet HTTPS hostname reported by the QA device's Tailscale Serve terminal. Independently test access, authorization and mobile usability. Confirm unauthenticated and wrong-employer reads are denied; verify running source SHA, correct fictional database, app origin/CSRF flow, status flags and private evidence storage. **Do not** call these tests PASS just because the URL opens.

**Stop:** close Terminal B, then Terminal A so the **foreground Serve** route is removed. Only after private fictional evidence is archived should you run the existing `stop --discard-fictional-session` command to discard that session's disposable DB. Do not delete other Tailscale configurations or the user's unrelated resources.

**Limitations:** Tailscale requires independent installation, tailnet approval and physical devices; this agent cannot grant tester access, attest a true phone session, or certify an actual operator's work. Capture observations in the existing private #852/#853 ledger; 27 cases remain NOT_RUN until personally witnessed. This is not a public production deployment.

## Status, cleanup and safety

To recheck the local container in another terminal:

    node scripts/qa/uat853-local-lab.mjs status

When operators are finished and fictional evidence is safely archived privately, stop the app and explicitly discard the test database with:

    node scripts/qa/uat853-local-lab.mjs stop --discard-fictional-session

The stop command verifies the recorded container name, image, SHA-bound label and loopback port, then stops **only that named container**; the Docker --rm behavior discards the ephemeral DB and the command deletes only its private local-lab credentials. It does not delete separate independent witness manifests or modify Neon/Vercel.

**Evidence limits:** The local unit tests cover fail-closed database targets and credentials; they do not prove Docker can start on a separate workstation. The #987 merged nine-stage synthetic workflow is already green, but does not substitute for real HR, manager, employee, payroll, checker and owner tests. Keep #853, #691, #579 and #112/#744 external gates separate and NO-GO until real independent evidence is recorded.
