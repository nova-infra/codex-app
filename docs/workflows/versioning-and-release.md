# Versioning and Release Workflow

This repository uses **Changesets** for open-source-standard version maintenance.

## Goals

- Keep package versioning reviewable and explicit
- Generate version PRs automatically from checked-in changesets
- Let operators verify the deployed service version from the running service itself
- Keep public workflow docs machine-agnostic and free of host-specific deployment details

## What is versioned

The public packages in this workspace are versioned through their `package.json` files:

- `@codex-app/server`
- `@codex-app/core`
- `@codex-app/channel-telegram`
- `@codex-app/channel-wechat`

## Contributor workflow

When a change should affect release notes or package versions, add a changeset:

```bash
bun run changeset
```

Then choose the package(s) and bump type:

- `patch` — bug fix, small improvement, safe behavior change
- `minor` — backward-compatible feature
- `major` — breaking change

This creates a markdown file under `.changeset/`.

## Main branch workflow

On every push to `main`, GitHub Actions runs:

- `.github/workflows/release.yml`

That workflow:

1. installs dependencies with Bun
2. reads pending changesets
3. creates or updates a **release/version PR**
4. updates package versions and changelog entries in that PR

## Release PR workflow

When the automated version PR appears:

1. review the version bumps and generated changelog updates
2. merge the PR when ready
3. deploy the updated service
4. confirm the running service version through the service endpoints

## Service-side version verification

The running service exposes build metadata at:

- `GET /health`
- `GET /version`

Example:

```json
{
  "status": "ok",
  "codex": true,
  "version": "0.1.0",
  "gitSha": "fdb4a87",
  "gitDirty": false
}
```

Fields:

- `version` — package version from `@codex-app/server`
- `gitSha` — deployed git commit SHA when available
- `gitDirty` — whether the running service was built from uncommitted local changes

## Recommended rules

- Keep repo docs and CI generic; do not commit machine-specific deployment paths or secrets
- Use changesets for user-visible changes, fixes, and release-worthy internal changes
- Prefer `gitDirty: false` in production deployments
- Verify `/health` or `/version` after every deployment

## Non-goals

This public workflow does **not** document private host paths, private secrets, or machine-specific deployment commands.
Those belong in private ops documentation or local agent memory, not in the open-source repository.
