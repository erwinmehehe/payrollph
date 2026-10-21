# DOLE reporting UI rollout

`NEXT_PUBLIC_DOLE_ATTRIBUTION_STATE_UI_ENABLED` defaults off in the central registry.
Only exact `true` opts into the verified report reads, fresh mutation confirmation,
retry and source-attribution explanation. Next.js inlines this public flag at build
time, so activation and rollback require a rebuild/deployment.

The off path is an exact copy of main's panel at
`06dbf527dd3c8f0c29f0ae1f4dbc68833037a76c`, kept in the adjacent legacy component.
SSR tests execute both components and compare exact markup for disabled values.
Playwright compares actual browser DOM against that main commit, with desktop and
390px loading, valid and blocked reads. The enabled notice must also retain readable
text width; lack of horizontal overflow alone cannot catch narrow text columns.

The server's multi-entity source-attribution block is unconditional in both UI flag
states. Do not gate or revert its 503 containment: historical legal-employer data
attribution still needs a separate reviewed implementation. Existing authorization,
MFA and maker-checker controls remain active. No filing or payment is authorized.

Rollback: remove the UI variable or set it to `false`, then rebuild/redeploy.
No schema/data rollback is required. Keep the legacy component until a separate
reviewed change retires this rollout. Production activation is not included here.
