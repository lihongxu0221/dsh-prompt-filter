# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-11-25

### Changed

- Renamed the npm package scope from `@deepseek-ai/dsh-prompt-filter` to the author-owned scope `@lihongxu0221/dsh-prompt-filter` across `package.json`, `cordis.patch.yml`, `client.js` (module registration id, `plugins.row.config` key `@lihongxu0221/dsh-prompt-filter#dsh-prompt-filter`, and `plugins.bundle.config` key `@lihongxu0221/dsh-prompt-filter`), tests, and documentation. The Cordis row id (`dsh-prompt-filter`), host plugin `name`, and settings namespace remain unchanged.

### Fixed

- The shipped bundle module name in `cordis.patch.yml` now matches `package.json` (`@lihongxu0221/dsh-prompt-filter`), while the Cordis row id stays `dsh-prompt-filter`. Activation previously imported the bare name `dsh-prompt-filter` (`ERR_MODULE_NOT_FOUND` against a scoped install). A same-commit bare alias made the import resolve, then icon metadata rejected `icon.svg` because the nearest `package.json` name did not match that specifier. Enabling reapplies this patch, so a profile `name` edited by hand no longer gets rewritten to the bare specifier. The `./icon` export remains the icon entry; no manifest `icon` field is added.

### Compatibility

- Revalidated against DeepSeek Harness `841f76d3c51966375ebed9b25512ebce4ac02079` (`0.2.3-alpha.3`), 1150 commits ahead of the previous baseline `4b399c39a6d1479cd84ca591b4d7c88e24d38a96` (`0.2.3-alpha.2`); no plugin code change was required for this sync.
- `llm/stream` (`packages/llm/llm/src/index.ts:78`), `GenerateOptions` (`messages`, `tools`, `toolHistory`, `sessionId`, `signal`), the `StreamChunk` variants (`tool-call-delta`, `block-end`, `finish`), and `projectToolUpdates`/`toolDeclarations` are unchanged between the two baselines: `packages/llm/llm/src/types.ts` and `content.ts` have no diff at all. The request body assembled in `packages/core/agent-loop/src/agent.ts` is also identical, so the plugin keeps receiving the system prompt as a `role: 'system'` message rather than a `system` field.
- The one new failure code, `INVALID_TOOL_ARGUMENTS` (`packages/llm/llm/src/error.ts`, added to `DEFAULT_RETRYABLE_CODES` in `retry-policy.ts`), reaches `matchesNoRetry` as one more `code` value to match against; `llm-retry` itself is untouched, so the retry decision order is unchanged. The `agent/request-error` payload still carries `{ turn, step, provider, failure, retryPolicy, signal }` with `agent` fused in by the dispatcher, so the listener's `payload?.agent?.session` lookup still resolves.
- `SessionHeader.origin` widened from `'subagent'` to `'subagent' | 'side'`; `isSubagentHeader` already rejects every origin other than `'subagent'`, so side sessions stay outside filtering without a change.
- Client side: `sidebar.panellist`, `main`, `settings.section`, `settings.section.icon`, `plugins.row.config` and `plugins.bundle.config`, plus the `configForms`, `commandUi` and `locale` services, keep their names and registration signatures. `@deepseek-ai/dsh-client-ui-slots`, `-ui-primitives` and `-ui-dockkit` moved their sources under `src/client/` and became `immediately: true` client bundles instead of shell-seeded platform modules; the module loader still resolves them by package id, and the existing `try`/`catch` fallback in `client.js` covers a profile where ui-primitives is missing. The new `settings.general.group` subtree and the `PluginTabProps.page` helpers are additive and unused here.
- `settings.configure(presentation, owner)` and the `cordis.patch.yml` `PatchOptions` shape are unchanged; `vendor/loader` and `vendor/cordis` only bumped their package versions, so `prepend`/`waterfall` and `loader/volatile-update` behave as before. `@deepseek-ai/schemastery` moved to `3.20.0-alpha.2`, still inside the declared `>=3.18.4 <4` peer range.
- Default `nameMap` targets were re-checked against the new tree: every tool and skill name the plugin renames still exists under that name, including `plugin_manager` (`packages/boot/plugin-manager/src/tools.ts:88`) and the `skill` tool (`packages/skill/tool-skill/src/index.ts:94`). The upstream office-tool rename to `document_*` does not touch the defaults.

## [0.3.7] - 2026-11-24

### Fixed

- The browser bundle now registers under the scoped package name `@deepseek-ai/dsh-prompt-filter`, which the host's client-module table uses as the entry id (`packages/client/modules/src/index.ts`: `graphRow(packageName, ...)`; `client/system.ts` `arrive()` requires `factories.has(id)`). Registering the narrow `dsh-prompt-filter` made the whole client entry fail to load with `client-modules: ... loaded without registering "dsh-prompt-filter"`, so the settings section, the plugin-page config cards, the sidebar entry and `/prompt-filter` all disappeared while host-side filtering kept working.
- Plugin-page slot keys now follow the shipped identity: `plugins.row.config` uses `@deepseek-ai/dsh-prompt-filter#dsh-prompt-filter` and `plugins.bundle.config` uses `@deepseek-ai/dsh-prompt-filter`. The Cordis row id and settings namespace remain `dsh-prompt-filter`.

## [0.3.6] - 2026-11-24

### Compatibility

- Package metadata now uses the requested scoped identity `@deepseek-ai/dsh-prompt-filter`; the Cordis bundle id remains `dsh-prompt-filter` so existing profile rows and settings namespaces continue to resolve.
- Revalidated against DeepSeek Harness `4b399c39a6d1479cd84ca591b4d7c88e24d38a96` (`0.2.3-alpha.2`): `llm/stream`, `GenerateOptions` (`messages`, `tools`, `toolHistory`), `projectToolUpdates`/`toolDeclarations`, StreamChunk variants, `agent/request-error`/retry, loader volatile updates, `settings.configure`, and the existing client slot contracts remain compatible.
- The `agent/request-error` listener now validates the upstream `provider` payload against the cached outgoing request before applying `noRetryOn`, while still accepting older payloads that omit `provider`.
- Confirmed that the upstream image-budget and prompt-assembly changes do not alter the request fields or stream contracts used by this plugin. Unknown message content blocks remain preserved during filtering.
- The client now honors `ConfigFormSnapshot.writable`: read-only forms show a notice and disable editing/saving instead of attempting a rejected mutation.
- The nested `llm/stream` redispatch and object-identity limitation for `isAgentLoopRequest` remain documented; upstream provides no writable request-assembly hook.

## [0.3.5] - 2026-11-19

### Compatibility

- Verified compatibility with DeepSeek Harness `2e39e70496aa02986ca6a820c5d497e816b69d7e` (0.2.2-rc.5): the `llm/stream`, `GenerateOptions` (`messages`, `tools`, `toolHistory`), `projectToolUpdates`/`toolDeclarations`, `agent/request-error`/retry, `settings.configure`, volatile-update, and existing settings/sidebar slot contracts remain compatible.
- Retested the existing `sidebar.panellist` registration against the additive `sidebar.panel.trailing`/`sidebar.panellist.trailing` slots; no plugin code change is required because the plugin does not consume the new optional slot.
- No compatibility changes were required beyond the release metadata bump.

## [0.3.4] - 2026-11-17

### Fixed

- `toolNameResolver` now refuses a fallback rename whose target is already a
  declared tool name. History-only declarations have no collision check of
  their own, so a plain `ops_bash → run_bash` map could previously shadow a
  real tool named `run_bash`; declared tools keep priority.

## [0.3.3] - 2026-11-17

### Added

- Rule defaults are hydrated when a profile's saved config predates a field:
  `nameMap`, `skillToolName` and `scope.skillCatalog` are filled in only when
  absent, so upgrading the bundle reaches profiles that already saved a full
  rule snapshot. Explicit values are never overwritten — including
  `nameMap: {}`, which still means "rename nothing".

## [0.3.2] - 2026-11-17

### Fixed

- `GenerateOptions.toolHistory` is now filtered like `options.tools`. On a route
  that declares `toolUpdate`, upstream `projectToolUpdates`
  (`packages/llm/llm/src/content.ts`) ignores `options.tools` and rebuilds the
  tool declarations from `toolHistory`; the unfiltered history leaked the
  original tool names and descriptions (the exact 429 trigger this plugin
  exists to remove).
- Deferred tools no longer go dark: the plugin renamed `tool-addition` blocks
  to `run_bash`/… while the declaration map still held `ops_bash`, so upstream
  dropped every addition as undeclared and the tool could never be activated.
  A single resolver (`toolNameResolver`) now drives `options.tools`,
  `toolHistory`, and the message blocks, so the names always agree.

### Changed

- `settings.configure({ auto: false })` is registered on the injected child
  fiber (`sctx.fiber`) instead of the parent fiber, matching the upstream
  convention.
- `formatReport` prints `history=<tools>/<additions>` and counts history
  renames in `renamed=`.

### Documented

- Losing the `markAgentLoopRequest` identity (the filtered request is a clone,
  and upstream keys `isAgentLoopRequest` on object identity) means
  `session-title` no longer auto-titles conversations on filtered models.
  Upstream exposes no writable request-assembly hook, so this is recorded as a
  known limitation rather than worked around.

## [0.3.1] - 2026-11-17

### Fixed

- The release workflow no longer fails when `NPM_TOKEN` is absent or `npm publish`
  is rejected; the GitHub Release still runs and publishes the tarball.

## [0.3.0] - 2026-11-17

### Added

- `nameMap` configuration: outbound renaming of tool names and skill ids with
  inbound restoration on the model response stream (`llm/stream` wrapper), so
  DSH still executes calls under their original names.
- `scope.skillCatalog` and automatic neutralisation of the skill catalogue
  (`source.kind === 'skill-catalog'`) plus `skill` tool ids.
- Inbound restoration for `tool-call-delta`, authoritative `block-end` blocks,
  and split `skill` arguments (buffered per call index).
- `replace` entries that name a tool/skill identifier are rejected with a hint
  to move them into `nameMap` (prevents irreversible renaming).
- dsh-market metadata: `dsh.bundle.patch`, `MIT` licence, topic instructions,
  awesome-dsh-plugin entry draft under `data/plugins/`.
- GitHub Actions release workflow: tag/version check, tests, tarball, SHA-256,
  non-draft GitHub Release; optional `npm publish` when `NPM_TOKEN` is set.

### Changed

- Default rules now cover the full identity surface (`you are an AI agent…`,
  persona line, Web GUI paragraph, checkout lines, `__DSH_BOOT__`,
  `dsh web`, `deepseek-tools`/`deepseek-official`, `billion-context`,
  `ACP TAGS`, `ACP marker integrity`, `powered by dsh`, `DSH plugin`,
  `DSH sandbox`).
- `scope.toolNames` defaults to `true` and now renames through `nameMap` only;
  `replace` no longer touches tool or skill names.

## [0.2.1] - 2026-11-17

### Fixed

- Sidebar entry never appeared because `sidebar.panellist` was registered
  before the slot was declared. `installSidebar()` now registers only inside
  the `slots.inject` callback and de-duplicates with applied state.

## [0.2.0] - 2026-11-16

### Added

- In-app configuration: sidebar panel, `/prompt-filter` command, plugin row and
  bundle configuration cards, settings section; `sidebarEntry` toggle that is
  persisted in the profile Cordis patch.
- `Config` schema with every field marked `.volatile()`; rules rebuild on
  `loader/volatile-update` without restarting the plugin.

## [0.1.0] - 2026-11-15

### Added

- Initial bundle: system prompt / tool description filtering for gemini and
  claude models, dry-run and trace modes, identical-retry protection.
