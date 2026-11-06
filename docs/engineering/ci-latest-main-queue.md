# Latest-main core CI queue policy

Core `ci.yml` now supersedes older runs for the same main ref, matching the
maintainer's request to clear obsolete work. PR groups remain separate by event
and PR number. Different PRs cannot cancel each other or main. This changes the
previous preserve-every-main-commit policy for core CI only; other workflows
retain their existing protection. A superseded commit is **not certified** and
must not be promoted or used as accepted evidence without its own completed run.

No test shard, audit job, validation step or final fail-closed dependency check
is removed. Current-head PR checks and the latest main run remain required.

SAML metadata and TOTP setup proof workflows no longer rebuild merely because
a draft becomes ready. They continue to execute on open, reopen and every source
update. Review and WIP gates retain readiness triggers. Both proof families are
currently uncredited; no receipt or coverage ledger is rewritten by this change.

This does not implement cross-workflow build sharing. Such sharing must key on
exact source, lockfile, Node version, build-time flags and profile, preserve
independent disposable databases, and must not recycle a different profile's
build. It requires a separately reviewed implementation.

Rollback: revert the workflow/concurrency changes. This affects runner scheduling
only, with no production data, money, providers, permissions or deployment change.
