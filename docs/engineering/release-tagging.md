# Release tagging

PayrollPH uses date-based Git tags as lightweight, historical checkpoints until formal application versioning is adopted.

## When to tag

- Tag **after a meaningful batch of changes has been merged into `main`**, such as a coherent feature milestone or stabilization batch.
- Do **not** tag every pull request, small fix, or individual commit.
- Tag the specific `main` commit representing the checkpoint, not an unmerged branch.

## Tag format

- Use `vYYYY.MM.DD`, with the date in **UTC** (for example, `v2026.10.25`).
- If a second meaningful checkpoint is tagged on the same UTC date, use `vYYYY.MM.DD.2`, then `.3`, and so on.
- Tags are permanent reference points. Never move or reuse an existing tag. Use a new tag for a later checkpoint.

## Creating a tag

From a local checkout with access to push tags:

```sh
git fetch origin main --tags
git tag -l
git rev-parse origin/main
git tag -a vYYYY.MM.DD <main-commit-sha> -m "Checkpoint YYYY-MM-DD"
git push origin vYYYY.MM.DD
```

Replace `vYYYY.MM.DD` with an unused tag name using the UTC date (and a suffix when needed), and replace `<main-commit-sha>` with the verified `origin/main` commit. Confirm that the selected commit is the intended checkpoint before pushing.

## What a tag does **not** mean

A tag identifies a code reference for comparison, audit, or troubleshooting. It **does not** mean the application was deployed to production, passed release acceptance, or is release-ready. Deployment and release decisions require separate verification and approval.

**Current release decision: NO-GO.** Creating a tag does not change that decision.
