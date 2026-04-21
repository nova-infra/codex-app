# @codex-app/channel-telegram

## 0.2.0

### Minor Changes

- aa0f228: Refactor the runtime around a stable session-control kernel, event pipeline, capability and preset registries, and add a composable `codex-app` CLI for doctoring, assembly, config inspection, and runtime startup.

### Patch Changes

- 7ff50b1: Reduce duplicate Telegram replies by reusing the streaming preview as the final message when possible, ignore reasoning summary deltas that caused extra progress-card churn, and surface Telegram edit failures instead of silently swallowing them.
- Updated dependencies [aa0f228]
  - @codex-app/core@0.2.0
