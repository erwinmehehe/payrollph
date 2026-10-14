# PayrollPH #853 - private HTTPS phone testing using a QA workstation

This is a **fictional-only, user-operated development QA** path around Vercel Hobby Sandbox session and snapshot-storage limits. It requires an approved workstation that remains online during UAT and an existing, administrator-managed Tailscale tailnet. Source/unit checks do NOT verify an actual physical phone, human reviewer, employer consent, bank provider or government filing.

The private access chain must be:

    Approved physical phone on restricted Tailscale tailnet
      -> Tailscale Serve HTTPS 443 (NOT public Funnel)
      -> Basic-auth gateway on 127.0.0.1:3001
      -> PayrollPH on 127.0.0.1:3000 (second, individual role login)
      -> disposable PostgreSQL 16 on 127.0.0.1:5432

No other service may listen on a public network interface. A public Funnel, public reverse proxy, exposed Docker PostgreSQL port, or production Neon/Vercel database is prohibited.

## Prerequisites

- A QA-owned clean checkout of the EXACT reviewed SHA (Node 22+, Git, npm, Docker Desktop/Engine, Tailscale installed). Use an approved device, not a production workstation containing dotenv files or inherited DB secrets.
- The tailnet administrator must enable MagicDNS/HTTPS certificates and **restrict access explicitly** to approved operator/witness identities and device groups. Tailscale's default tailnet ACL is commonly allow-all, so mere tailnet membership does NOT establish least privilege. Verify the specific port 443 policy and prohibit Funnel.
- Physical owner, manager, HR, employee, Payroll Officer, Checker and separate witness must use their **own** identities. Evidence vault and real observer/device details must be handled privately.
- Exactly two fictional employers with role-scoped test accounts and overlapping local worker numbers are required. The existing local lab initializes an EMPTY database; it does not seed or certify the complete two-employer fixture. Use a reviewed fictional-only seed or supported product workflows. A missing fixture is BLOCKED, not PASS.
- Live payouts, bank connections, worker/scheduler automation, official submissions, real notifications and any real-employer payroll data must remain OFF/ABSENT.
- Run in separate terminals. Do not run as GitHub-hosted CI or as an unattended live payroll service.

## Terminal 1: prepare and run local app

From the clean pinned PayrollPH checkout with NO inherited DATABASE_URL, POSTGRES_URL or POSTGRES_PRISMA_URL:

    npm ci
    node --test tests/uat853-local-lab.test.mjs tests/uat853-tailnet-phone.test.mjs
    node scripts/qa/uat853-local-lab.mjs start
    node scripts/qa/uat853-local-lab.mjs migrate
    node scripts/qa/uat853-local-lab.mjs status
    node scripts/qa/uat853-local-lab.mjs serve

The reviewed local lab provisions ONLY a named disposable postgres:16 Docker instance bound to 127.0.0.1:5432. The app runs at http://127.0.0.1:3000. Leave Terminal 1 running. Record the real SHA actually served. A matching source SHA is necessary but not sufficient for pilot acceptance.

## Terminal 2: gated localhost proxy

Before starting, log in to Tailscale on this workstation, and verify the QA custodian approved the exact tailnet access policy. With the local app and Docker container running:

    node scripts/qa/uat853-tailnet-phone.mjs preflight
    node scripts/qa/uat853-tailnet-phone.mjs init
    node scripts/qa/uat853-tailnet-phone.mjs gateway

The first two commands fail closed on unsafe DB targets, a changed or dirty source checkout, not-ready schema, live money/provider flags, a disconnected tailnet or any public Funnel configuration. The init command writes fresh high-entropy gateway credentials to the Git-ignored file qa-artifacts/uat853-tailnet-phone/credentials.json with restrictive POSIX permissions. It refuses to overwrite existing credentials. On Windows, the custodian must additionally restrict NTFS folder ACLs.

Do NOT paste credentials, browser cookies or session tokens into chat, GitHub, CI, screenshots or shared documents. They must be retrieved and distributed only using the approved private QA channel.

The gateway runs in the foreground on 127.0.0.1:3001. It enforces a second Basic-auth layer, rejects unknown Host and mutation Origin, strips inbound forwarded/authorization headers, adds Secure to browser session cookies, blocks known private paths and never exposes PostgreSQL. It deliberately denies WebSocket upgrades. An app login is still required after the gateway prompt.

## Terminal 3: private Tailscale HTTPS

Only after the tailnet administrator verifies restrictive identity and device access:

    tailscale serve --bg http://127.0.0.1:3001
    tailscale serve status --json
    tailscale funnel status --json

Check the Serve configuration maps HTTPS 443 ONLY to the local gateway, the user/device policy restricts port 443 to the named testers, and **no AllowFunnel value is true**. A Serve configuration is private to the tailnet; a Funnel configuration is public to the Internet and must NOT be used. If port 443 is already used for an unrelated service, resolve that conflict without overwriting it.

References:
- https://tailscale.com/docs/reference/tailscale-cli/serve
- https://tailscale.com/docs/features/tailscale-serve
- https://tailscale.com/docs/reference/examples/acls
- https://tailscale.com/docs/how-to/set-up-https-certificates

The HTTPS tailnet hostname is only useful while the workstation, local app, gateway and Tailscale remain running. This approach does not create an always-on cloud instance by itself and does not use Vercel Sandbox storage.

## Real phone handoff and acceptance

On **two separate physical phones**, each joined to the approved tailnet, navigate to the Tailscale Serve HTTPS address. Supply the private Basic-auth credentials, then the person's distinct fictional PayrollPH login. Test actual UI login and forms, employer A -> B -> A switching for BOTH Owner and Payroll Officer, role denial, employee self-service, the same worker throughout Hire -> Onboard -> Schedule -> Clock -> Approve -> Payroll -> Check -> Records -> Draft Files, stale correction/cutoff denial and four draft file-byte hashes.

Record browser/build/device, expected versus observed, named real operator and independent reviewer, actual timestamps, and private evidence references using the EXISTING docs/qa/independent-journey-853.md, issue #853 packet and WFM #691 matrix. Do not mark synthetic HTTP requests as phone PASS. Hardware WFM-14 is NOT_RUN_EXTERNAL until physically executed. The separate real-employer #579 reconciliation requires consent and an independent checker and must never be run in the fictional fixture.

## Stop and clean up safely

- Inspect the existing Tailscale Serve status before removing the QA mapping. For a dedicated QA-only root Serve on HTTPS 443, use the exact route removal command shown by the local Tailscale CLI, e.g. tailscale serve --https=443 --set-path=/ off. Never reset another unrelated Service.
- Stop the foreground gateway and app with Ctrl+C, verify there are no public ports/forwarding rules, then archive private evidence.
- Only after the fictional evidence has been preserved, discard the named disposable lab with:

    node scripts/qa/uat853-local-lab.mjs stop --discard-fictional-session

- Revoke or remove the QA-specific credentials under the approved local retention policy; the launcher never uploads them or produces a human UAT signature.

## Evidence and boundary

The guard/proxy unit tests prove local protocol behavior only. The actual Tailscale tailnet, host ACL, genuine phone browser, participants, fixture, deploy source, evidence vault and signed acceptance require an authorized workstation administrator and real independent humans. Until then **#853 = 0/19 HUMAN NOT_RUN, #691 = 0/14 HUMAN NOT_RUN, #579 = NOT_RUN, and external pilot = NO-GO**. Do not enable production pay/provider/filing flags or conduct a production migration for this task.
