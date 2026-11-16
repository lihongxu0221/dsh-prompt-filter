/**
 * Tool-schema filtering.
 *
 * Only `description` strings are rewritten inside `parameters`; enum values,
 * defaults, consts, and other schema data are left alone so tool arguments
 * keep their real vocabulary.
 */

import { applyTextRules } from './text.js'

const SAFE_TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/

function emptyResult(tools) {
  return {
    tools,
    changed: false,
    count: Array.isArray(tools) ? tools.length : 0,
    descriptionsChanged: 0,
    namesChanged: 0,
    nameMap: new Map(),
    hits: { strip: 0, replace: 0, identity: 0 },
  }
}

function addHits(result, hits) {
  result.hits.strip += hits.strip
  result.hits.replace += hits.replace
}

function rewriteSchema(value, rule, stats) {
  if (Array.isArray(value)) return value.map((entry) => rewriteSchema(entry, rule, stats))
  if (value === null || typeof value !== 'object') return value
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'description' && typeof entry === 'string') {
      const filtered = applyTextRules(entry, rule, { identity: false, scopePaths: rule.scope.paths })
      if (filtered.text !== entry) {
        stats.changed = true
        stats.strip += filtered.hits.strip
        stats.replace += filtered.hits.replace
      }
      out[key] = filtered.text
      continue
    }
    out[key] = rewriteSchema(entry, rule, stats)
  }
  return out
}

export function filterTools(tools, rule) {
  const result = emptyResult(tools)
  if (!Array.isArray(tools) || tools.length === 0) return result

  const taken = new Set()
  for (const tool of tools) {
    if (tool !== null && typeof tool === 'object' && typeof tool.name === 'string') taken.add(tool.name)
  }

  const out = tools.map((tool) => {
    if (tool === null || typeof tool !== 'object') return tool
    let next = tool

    if (rule.scope.toolDescriptions && typeof tool.description === 'string') {
      const filtered = applyTextRules(tool.description, rule, { identity: false, scopePaths: rule.scope.paths })
      if (filtered.text !== tool.description) {
        next = { ...next, description: filtered.text }
        result.descriptionsChanged += 1
        addHits(result, filtered.hits)
      }
    }

    if (rule.scope.toolNames && typeof tool.name === 'string') {
      const filtered = applyTextRules(tool.name, rule, { identity: false, scopePaths: true })
      const candidate = filtered.text.trim()
      if (candidate !== tool.name && SAFE_TOOL_NAME.test(candidate) && !taken.has(candidate)) {
        next = { ...next, name: candidate }
        taken.delete(tool.name)
        taken.add(candidate)
        result.nameMap.set(tool.name, candidate)
        result.namesChanged += 1
        addHits(result, filtered.hits)
      }
    }

    if (rule.scope.toolDescriptions && next.parameters !== null && typeof next.parameters === 'object') {
      const stats = { changed: false, strip: 0, replace: 0 }
      const parameters = rewriteSchema(next.parameters, rule, stats)
      if (stats.changed) {
        next = { ...next, parameters }
        result.hits.strip += stats.strip
        result.hits.replace += stats.replace
      }
    }

    if (next !== tool) result.changed = true
    return next
  })

  if (result.changed) result.tools = out
  return result
}
