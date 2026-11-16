/**
 * Compile one configured rule into its runtime form.
 *
 * Invalid rules throw so the plugin can fail open (log and register no
 * listeners) rather than half-filtering requests.
 */

import { DEFAULT_SCOPE } from './config.js'
import { compileMatchers } from './match.js'
import { compileReplaceEntries, compileStripEntries } from './text.js'

const SCOPE_KEYS = ['system', 'toolDescriptions', 'toolNames', 'memoryReminders', 'paths']

export function compileRule(raw, index) {
  const problems = []
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : `rule-${index}`

  const matchers = compileMatchers(raw.modelMatch, `${id}.modelMatch`, problems)
  const strip = compileStripEntries(raw.stripLines, `${id}.stripLines`, problems)
  const replace = compileReplaceEntries(raw.replace, `${id}.replace`, problems)

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
    identityOverride: raw.identityOverride ?? '',
    noRetryOn: (raw.noRetryOn ?? []).filter((entry) => entry.trim() !== ''),
    scope,
    dryRun: raw.dryRun === true,
  }
}