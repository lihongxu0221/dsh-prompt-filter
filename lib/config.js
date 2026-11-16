/**
 * Config defaults and normalization.
 *
 * The bundle's `cordis.patch.yml` carries the authoritative default rule set
 * so it is visible and editable in the profile. `FALLBACK_RULES` mirrors it
 * for the case where the plugin row is inserted with an empty config; keep the
 * two in sync when changing defaults.
 */

export const DEFAULT_SCOPE = Object.freeze({
  system: true,
  toolDescriptions: true,
  toolNames: false,
  memoryReminders: true,
  paths: true,
})

export const DEFAULT_REPLACE = Object.freeze([
  { from: 'window.__DSH_BOOT__', to: 'the app boot payload' },
  { from: 'Current DSH file policy:', to: 'Current file policy:' },
  { from: 'enforced by the DSH file sandbox', to: 'enforced by the file sandbox' },
  { from: 'The DSH file sandbox does not restrict', to: 'The file sandbox does not restrict' },
  { from: 'DSH session cwd', to: 'session cwd' },
  { from: 'dsh web', to: 'the app' },
  { from: 'DeepSeek Harness', to: 'the agent' },
  { from: 'Harness', to: 'agent' },
  { from: 'ACP', to: 'cross-session' },
  { from: 'billion-context', to: 'context-compaction' },
  { from: 'deepseek-tools', to: 'search-tools' },
  { from: 'deepseek-official', to: 'search-official' },
  { from: '(?<![A-Za-z0-9])DSH(?![A-Za-z0-9])', to: 'APP', regex: true },
  { from: '(?<![A-Za-z0-9])dsh(?![A-Za-z0-9])', to: 'app', regex: true },
])

export const FALLBACK_RULES = Object.freeze([
  {
    id: 'default-gemini-claude',
    modelMatch: ['gemini', 'claude'],
    identityOverride: 'You are a helpful coding assistant.',
    stripLines: [
      { pattern: 'You are an AI agent powered by DeepSeek Harness.' },
      { pattern: 'The runtime context names the DeepSeek Harness implementation checkout.', mode: 'paragraph' },
      { pattern: 'You are interacting with the user through the DeepSeek Harness Web GUI', mode: 'paragraph' },
      { pattern: 'Current DeepSeek Harness implementation checkout:' },
      { pattern: 'Current DeepSeek Harness Web GUI URL:' },
      { pattern: 'The session workspace' },
      { pattern: 'also includes these source folders:' },
      { pattern: 'github.com/ranxianglei/billion-context', mode: 'paragraph' },
      { pattern: '^\\s*You are a coding agent powered by the .+ model\\.\\s*$', regex: true },
    ],
    replace: DEFAULT_REPLACE,
    noRetryOn: ['Resource has been exhausted', 'RATE_LIMIT'],
  },
])

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
    rule !== null && typeof rule === 'object' && !Array.isArray(rule) ? rule : {}
  ))

  return { enabled, dryRun, debug, applyToSubagents, traceDir, rules, problems }
}
