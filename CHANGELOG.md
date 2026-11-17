# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
