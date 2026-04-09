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

Repository secret requirement:

- `RELEASE_PR_TOKEN` — a token with repository **Contents: Read and write** and **Pull requests: Read and write**

## Concurrent change workflow

This is the important rule when several feature or fix PRs are merged close together:

- each merge to `main` can add, remove, or modify pending changesets
- the release workflow does not create one immutable release PR per feature PR
- instead, it keeps a single current **release/version PR** in sync with the latest state of `main`

In practice:

1. PR A merges to `main`
2. GitHub Actions creates or updates the release PR with A's changesets
3. PR B and PR C merge before the release PR is merged
4. GitHub Actions re-runs and updates the same release PR so it now includes A + B + C
5. operators review the aggregated version bumps and changelog output
6. the release PR is merged once for the whole current batch
7. deployment happens from that merged release commit, not from the earlier feature PR heads

Operational implication:

- do not deploy from a feature PR branch if you expect normal version history
- do not assume the first generated release PR is final when more changes are still landing
- deploy only after the current release PR has been merged, and deploy that exact merge commit

## Deployment checklist

For a production release, keep the deployment flow linear even if development was concurrent:

1. fetch latest `origin/main`
2. ensure the deployment worktree is clean
3. check out the merged release commit from `main`
4. install dependencies from the committed lockfile
5. build the production artifact from that clean commit
6. restart the service with the new artifact
7. verify `GET /health` or `GET /version`

Recommended verification after deploy:

- `gitSha` matches the merged release commit you intended to deploy
- `gitDirty` is `false`
- the reported package `version` matches the release PR output

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
