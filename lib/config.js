/**
 * Config defaults and normalization.
 *
 * The bundle's `cordis.patch.yml` carries the authoritative default rule set
 * so it is visible and editable in the profile. `FALLBACK_RULES` mirrors it
 * for the case where the plugin row is inserted with an empty config; keep the
 * two in sync when changing defaults.
 *
 * Two rewrite families are deliberately separate:
 *   - `stripLines` / `replace` / `identityOverride`: outbound only, never restored
 *   - `nameMap`: outbound rename with a mandatory inbound restore
 */

export const DEFAULT_SCOPE = Object.freeze({
  system: true,
  toolDescriptions: true,
  toolNames: true,
  memoryReminders: true,
  paths: true,
  skillCatalog: true,
})

export const DEFAULT_REPLACE = Object.freeze([
  { from: 'window.__DSH_BOOT__', to: 'the app boot payload' },
  { from: '__DSH_BOOT__', to: 'the app boot payload' },
  { from: 'Current DSH file policy:', to: 'Current file policy:' },
  { from: 'enforced by the DSH file sandbox', to: 'enforced by the file sandbox' },
  { from: 'The DSH file sandbox does not restrict', to: 'The file sandbox does not restrict' },
  { from: 'DSH session cwd', to: 'session cwd' },
  { from: 'DSH plugin', to: 'plugin' },
  { from: 'DSH sandbox', to: 'sandbox' },
  { from: 'ACP marker integrity', to: 'context marker integrity' },
  { from: 'ACP TAGS', to: 'CONTEXT TAGS' },
  { from: 'dsh web', to: 'the app' },
  { from: 'powered by dsh', to: 'powered by the assistant' },
  { from: 'DeepSeek Harness', to: 'the agent' },
  { from: 'Harness', to: 'agent' },
  { from: 'ACP', to: 'cross-session' },
  { from: 'billion-context', to: 'context-compaction' },
  { from: 'github.com/ranxianglei/billion-context', to: 'the context-compaction project' },
  { from: 'deepseek-tools', to: 'search-tools' },
  { from: 'deepseek-official', to: 'search-official' },
  { from: '(?<![A-Za-z0-9])DSH(?![A-Za-z0-9])', to: 'APP', regex: true },
  { from: '(?<![A-Za-z0-9])dsh(?![A-Za-z0-9])', to: 'app', regex: true },
])

/**
 * Default outbound rename map (restored on the way back).
 * Delete one line to stop renaming that tool/skill in both directions.
 */
export const DEFAULT_NAME_MAP = Object.freeze({
  tools: {
    ops_bash: 'run_bash',
    ops_grep: 'search_text',
    ops_glob: 'find_files',
    ops_inspect_local_file: 'inspect_file',
    ops_discover_tools: 'discover_tools',
    acp_cache: 'cache_reconcile',
    acp_status: 'context_status',
    acp_read_original_image: 'read_original_image',
    plugin_manager: 'plugin_registry',
    session_event_read: 'event_read',
    session_event_search: 'event_search',
    session_event_trace: 'event_trace',
  },
  skills: {
    'dsh-badge': 'assistant-badge',
    'dsh-doc': 'product-doc',
    'official-plugins': 'plugin-catalog',
    'diagnose-windows-sandbox-acl': 'sandbox-acl-diagnostics',
  },
})

export const FALLBACK_RULES = Object.freeze([
  {
    id: 'default-gemini-claude',
    modelMatch: ['gemini', 'claude'],
    identityOverride: 'You are a helpful coding assistant.',
    stripLines: [
      { pattern: '^\\s*You are an AI agent,? powered by .+\\.\\s*$', regex: true },
      { pattern: 'The runtime context names the DeepSeek Harness implementation checkout.', mode: 'paragraph' },
      { pattern: 'You are interacting with the user through the DeepSeek Harness Web GUI', mode: 'paragraph' },
      { pattern: 'You are interacting with the user through the Web GUI', mode: 'paragraph' },
      { pattern: 'Current DeepSeek Harness implementation checkout:' },
      { pattern: 'Current DeepSeek Harness Web GUI URL:' },
      { pattern: 'Current agent implementation checkout:' },
      { pattern: 'The session workspace' },
      { pattern: 'also includes these source folders:' },
      { pattern: 'github.com/ranxianglei/billion-context', mode: 'paragraph' },
      { pattern: '^\\s*You are a coding agent powered by the .+ model\\.\\s*$', regex: true },
    ],
    replace: DEFAULT_REPLACE,
    nameMap: DEFAULT_NAME_MAP,
    noRetryOn: ['Resource has been exhausted', 'RATE_LIMIT'],
  },
])

/**
 * Additive defaults for rule fields introduced after a profile saved its
 * config. A profile patch stores a snapshot of the rule it was saved with, so
 * fields added in later releases would otherwise never reach that profile.
 *
 * Only fields that are absent are filled in; an explicitly configured value
 * (including `nameMap: {}` to disable renaming) always wins.
 */
export const RULE_ADDITIVE_DEFAULTS = Object.freeze({
  nameMap: DEFAULT_NAME_MAP,
  skillToolName: 'skill',
})

export function hydrateRule(raw) {
  const rule = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
  for (const key of Object.keys(RULE_ADDITIVE_DEFAULTS)) {
    if (!(key in rule)) rule[key] = RULE_ADDITIVE_DEFAULTS[key]
  }
  return rule
}

/**
 * Normalize the raw plugin config without compiling patterns.
 *
 * `problems` is non-empty when the config cannot be honored; the caller then
 * leaves the plugin inactive (fail-open) instead of breaking DSH's requests.
 */
export function normalizeConfig(raw) {
  const problems = []
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    problems.push('config must be a mapping')
  }
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  const enabled = source.enabled !== false
  const dryRun = source.dryRun === true
  const debug = source.debug === true
  const applyToSubagents = source.applyToSubagents !== false

  let traceDir = ''
  if (source.traceDir !== undefined) {
    if (typeof source.traceDir !== 'string') problems.push('traceDir must be a string')
    else traceDir = source.traceDir
  }

  let rawRules = source.rules
  if (rawRules === undefined || rawRules === null || (Array.isArray(rawRules) && rawRules.length === 0)) {
    rawRules = FALLBACK_RULES
  }
  if (!Array.isArray(rawRules)) {
    problems.push('rules must be an array')
    rawRules = []
  }

  const rules = rawRules.map((rule) => (
    rule !== null && typeof rule === 'object' && !Array.isArray(rule) ? hydrateRule(rule) : hydrateRule({})
  ))

  return { enabled, dryRun, debug, applyToSubagents, traceDir, rules, problems }
}
