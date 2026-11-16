/**
 * Text filtering: line/paragraph removal, literal or regex replacement, and
 * the neutral identity sentence.
 *
 * Path awareness: when `scope.paths` is false, quoted path strings are left
 * untouched by replacements, so a user can keep the real cwd/profile visible
 * even though the brand sweep would otherwise rewrite it.
 */

import { toRegExp } from './pattern.js'

const QUOTED_PATH = /"[^"\n]*[\\/][^"\n]*"/g

export function compileStripEntries(entries, where, problems) {
  if (entries === undefined || entries === null) return []
  if (!Array.isArray(entries)) {
    problems.push(`${where} must be an array`)
    return []
  }
  const out = []
  entries.forEach((entry, index) => {
    let spec = entry
    let mode = 'line'
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      spec = entry
      mode = entry.mode === 'paragraph' ? 'paragraph' : 'line'
    }
    try {
      out.push({ regex: toRegExp(spec), mode })
    } catch (error) {
      problems.push(`${where}[${index}]: ${error.message}`)
    }
  })
  return out
}

export function compileReplaceEntries(entries, where, problems) {
  if (entries === undefined || entries === null) return []
  if (!Array.isArray(entries)) {
    problems.push(`${where} must be an array`)
    return []
  }
  const out = []
  entries.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where}[${index}] must be a { from, to } mapping`)
      return
    }
    const spec = entry.regex === true ? { pattern: entry.from, regex: true } : entry.from
    if (typeof entry.to !== 'string') {
      problems.push(`${where}[${index}].to must be a string`)
      return
    }
    try {
      out.push({ regex: toRegExp(spec, { global: true }), to: entry.to })
    } catch (error) {
      problems.push(`${where}[${index}]: ${error.message}`)
    }
  })
  return out
}

/** Remove whole lines, or whole blank-line-delimited paragraphs, matching a regex. */
function removeLines(text, entry) {
  const lines = text.split('\n')
  if (entry.mode === 'paragraph') {
    const drop = new Set()
    for (let index = 0; index < lines.length; index += 1) {
      if (!entry.regex.test(lines[index])) continue
      let start = index
      while (start > 0 && lines[start - 1].trim() !== '') start -= 1
      let end = index
      while (end + 1 < lines.length && lines[end + 1].trim() !== '') end += 1
      for (let cursor = start; cursor <= end; cursor += 1) drop.add(cursor)
    }
    return lines.filter((_, index) => !drop.has(index)).join('\n')
  }
  return lines.filter((line) => !entry.regex.test(line)).join('\n')
}

function mapOutsidePaths(text, scopePaths, transform) {
  if (scopePaths) return transform(text)
  let out = ''
  let last = 0
  for (const match of text.matchAll(QUOTED_PATH)) {
    out += transform(text.slice(last, match.index)) + match[0]
    last = match.index + match[0].length
  }
  return out + transform(text.slice(last))
}

/**
 * Apply one compiled rule to a block of text.
 *
 * `identity: false` is used for tool descriptions and names, where prepending
 * a persona sentence would corrupt the text.
 */
export function applyTextRules(text, rule, options = {}) {
  if (typeof text !== 'string') {
    return { text: '', hits: { strip: 0, replace: 0, identity: false } }
  }
  const identity = options.identity !== false
  const scopePaths = options.scopePaths !== undefined
    ? options.scopePaths !== false
    : rule.scope?.paths !== false
  let current = text
  let strip = 0
  for (const entry of rule.strip) {
    const next = removeLines(current, entry)
    if (next !== current) {
      strip += 1
      current = next
    }
  }

  let replace = 0
  for (const entry of rule.replace) {
    const next = mapOutsidePaths(current, scopePaths, (segment) => segment.replace(entry.regex, entry.to))
    if (next !== current) {
      replace += 1
      current = next
    }
  }

  let identityApplied = false
  if (
    identity
    && typeof rule.identityOverride === 'string'
    && rule.identityOverride !== ''
    && (strip > 0 || replace > 0)
    && !current.toLowerCase().includes(rule.identityOverride.toLowerCase())
  ) {
    const trimmed = current.trim()
    current = trimmed === '' ? rule.identityOverride : `${rule.identityOverride}\n\n${trimmed}`
    identityApplied = true
  }

  current = current.replace(/\n{3,}/g, '\n\n')
  return { text: current, hits: { strip, replace, identity: identityApplied } }
}
