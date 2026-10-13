# S-6: public intake proof rollout

Default off: `PUBLIC_INTAKE_PROOF_ENABLED` on the server and `NEXT_PUBLIC_PUBLIC_INTAKE_PROOF_ENABLED` in the client build. Both must be exact `true` for an approved rollout. Set a dedicated random `PUBLIC_INTAKE_PROOF_SECRET` (at least 32 characters), not a bank, PII, session or TOTP secret. Missing secret denies challenge creation; it never bypasses verification. No secret is sent to the browser.

Demo/trial/contact, outsourcing quote and self-serve signup forms solve an email-bound signed SHA-256 challenge before submission. Existing busy and error states remain available; no image recognition or third-party tracking is required. Work yields to the browser between batches and times out after 30 seconds with a retry message. Screen-reader, slow-device and reduced-power acceptance remain required before enabling.

Proofs expire at the next five-minute replay-counter boundary. Token consumption uses the atomic PostgreSQL rate-limit counter with limit one. In-memory fallback cannot authorize a proof. If the counter store is unavailable, intake fails closed with a retriable 503; signed work is not itself evidence that a request is unique.

Existing demo/quote IP, hashed email and domain limits remain in force. Signup adds a domain limit when the proof gate is enabled. Challenge issuance has IP/email limits. Review free-email-provider quotas with operations before activation. The challenge is an anti-automation cost, not a claim to establish human identity, and does not replace consent, normalization, authentication or server authorization.

Rotate the challenge secret only with a coordinated frontend/server rollout; outstanding challenges become invalid and users can retry. Keep the proof required on the server until the approved rollback of both flags. No lead data backfill is involved.

Executed policy tests cover signed work, different email/key, expiry, malformed values, concurrent claim/replay decisions, in-memory denial and flag-off no-claim behavior. Real PostgreSQL cross-worker replay, browser timing and full HTTP form acceptance are separate acceptance requirements.
