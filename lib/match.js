/** Model matching for rule sets. */

import { toRegExp } from './pattern.js'

/**
 * Compile `modelMatch` entries.
 *
 * Every entry is tested against the provider, the model, and
 * `provider/model`, case-insensitively. Strings are substring matches
 * (so "gemini" matches "group/gemini-3.8-flash"); `/.../flags` entries are
 * regular expressions.
 */
export function compileMatchers(patterns, where, problems) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    problems.push(`${where} must be a non-empty array`)
    return []
  }
  const matchers = []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      problems.push(`${where}: every entry must be a non-empty string`)
      continue
    }
    const raw = /^\/([\s\S]*)\/([a-z]*)$/.exec(pattern)
    if (raw !== null) {
      try {
        matchers.push({ kind: 'regex', regex: toRegExp(pattern) })
      } catch (error) {
        problems.push(`${where}: ${error.message}`)
      }
    } else {
      matchers.push({ kind: 'contains', needle: pattern.trim().toLowerCase() })
    }
  }
  return matchers
}

/** Whether the provider/model pair matches any compiled matcher. */
export function matchModel(matchers, info = {}) {
  const { provider, model } = info
  const candidates = []
  if (typeof provider === 'string' && provider !== '') candidates.push(provider.toLowerCase())
  if (typeof model === 'string' && model !== '') candidates.push(model.toLowerCase())
  if (candidates.length === 2) candidates.push(`${candidates[0]}/${candidates[1]}`)

  for (const matcher of matchers) {
    if (matcher.kind === 'contains') {
      if (candidates.some((candidate) => candidate.includes(matcher.needle))) return true
    } else if (candidates.some((candidate) => matcher.regex.test(candidate))) {
      return true
    }
  }
  return false
}
