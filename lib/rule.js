/**
 * Compile one configured rule into its runtime form.
 *
 * Invalid rules throw so the plugin can fail open (log and register no
 * listeners) rather than half-filtering requests.
 */

import { DEFAULT_SCOPE } from './config.js'
import { compileMatchers } from './match.js'
import { compileNameMap } from './names.js'
import { compileReplaceEntries, compileStripEntries } from './text.js'

const SCOPE_KEYS = ['system', 'toolDescriptions', 'toolNames', 'memoryReminders', 'paths', 'skillCatalog']

export function compileRule(raw, index) {
  const problems = []
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `rule-${index}`

  const matchers = compileMatchers(raw.modelMatch, `${id}.modelMatch`, problems)
  const strip = compileStripEntries(raw.stripLines, `${id}.stripLines`, problems)
  const replace = compileReplaceEntries(raw.replace, `${id}.replace`, problems)
  const names = compileNameMap(raw.nameMap, `${id}.nameMap`, problems)

  // A name that must be restored belongs in nameMap, never in replace: a
  // replace entry would silently rewrite tool calls with no way back.
  if (Array.isArray(raw.replace)) {
    for (const entry of raw.replace) {
      const from = entry !== null && typeof entry === 'object' ? entry.from : entry
      if (typeof from !== 'string') continue
      if (names.tools.has(from) || names.skills.has(from)) {
        problems.push(`${id}.replace: "${from}" is an identifier; move it to nameMap so the response can be restored`)
      }
    }
  }

  const rawScope = raw.scope !== null && typeof raw.scope === 'object' && !Array.isArray(raw.scope) ? raw.scope : {}
  const scope = { ...DEFAULT_SCOPE, ...rawScope }
  for (const key of SCOPE_KEYS) {
    if (typeof scope[key] !== 'boolean') {
      problems.push(`${id}.scope.${key} must be a boolean`)
      scope[key] = DEFAULT_SCOPE[key]
    }
  }

  if (raw.identityOverride !== undefined && typeof raw.identityOverride !== 'string') {
    problems.push(`${id}.identityOverride must be a string`)
  }
  if (raw.skillToolName !== undefined && typeof raw.skillToolName !== 'string') {
    problems.push(`${id}.skillToolName must be a string`)
  }
  if (
    raw.noRetryOn !== undefined
    && (!Array.isArray(raw.noRetryOn) || raw.noRetryOn.some((entry) => typeof entry !== 'string'))
  ) {
    problems.push(`${id}.noRetryOn must be an array of strings`)
  }

  if (problems.length > 0) throw new Error(problems.join('; '))

  return {
    id,
    matchers,
    strip,
    replace,
    names,
    skillToolName: raw.skillToolName ?? 'skill',
    identityOverride: raw.identityOverride ?? '',
    noRetryOn: (raw.noRetryOn ?? []).filter((entry) => entry.trim() !== ''),
    scope,
    dryRun: raw.dryRun === true,
  }
}