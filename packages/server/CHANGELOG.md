# @codex-app/server

## 0.2.0

### Minor Changes

- aa0f228: Refactor the runtime around a stable session-control kernel, event pipeline, capability and preset registries, and add a composable `codex-app` CLI for doctoring, assembly, config inspection, and runtime startup.

### Patch Changes

- fdb4a87: Expose runtime version metadata through `/health` and `/version`, including git SHA and dirty state, and add automated Changesets-based version management for the repository.
- Updated dependencies [7ff50b1]
- Updated dependencies [aa0f228]
  - @codex-app/channel-telegram@0.2.0
  - @codex-app/core@0.2.0
  - @codex-app/channel-wechat@0.2.0
