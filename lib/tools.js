/**
 * Tool-schema filtering.
 *
 * Two independent things happen here:
 *   - `nameMap.tools` renames the tool itself (outbound rename; DSH restores it
 *     on the inbound stream before executing).
 *   - `stripLines` / `replace` rewrite `description` strings only: enum values,
 *     defaults, consts, and other schema data are left alone so tool arguments
 *     keep their real vocabulary.
 *
 * The same rewrite must also reach `GenerateOptions.toolHistory`, because on a
 * route that declares `toolUpdate` the adapter sends the declarations rebuilt
 * from the history (`packages/llm/llm/src/content.ts` `projectToolUpdates` /
 * `toolDeclarations`) instead of `options.tools`. `filterToolHistory` covers
 * that path; `toolNameResolver` is the single resolver every outbound tool-name
 * rewrite shares, so the history declarations, the developer `tool-addition`
 * blocks, and the assistant `tool-call` names always agree.
 */

import { applyTextRules } from './text.js'

const SAFE_TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/

function emptyStats() {
  return { changed: false, namesChanged: 0, descriptionsChanged: 0, hits: { strip: 0, replace: 0 } }
}

function emptyResult(tools) {
  return {
    tools,
    changed: false,
    count: Array.isArray(tools) ? tools.length : 0,
    descriptionsChanged: 0,
    namesChanged: 0,
    nameMap: new Map(),
    declared: new Set(),
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
      const renamed = rule.scope.toolNames ? rule.names.renameText(filtered.text) : filtered.text
      if (renamed !== entry) {
        stats.changed = true
        stats.strip += filtered.hits.strip
        stats.replace += filtered.hits.replace
      }
      out[key] = renamed
      continue
    }
    out[key] = rewriteSchema(entry, rule, stats)
  }
  return out
}

/**
 * Rewrite one tool schema in place-free fashion.
 *
 * `resolveName` decides the outbound name; it is the only place a tool name
 * changes, so every caller that must agree on names goes through it.
 */
function rewriteTool(tool, rule, resolveName, stats) {
  if (tool === null || typeof tool !== 'object') return tool
  let next = tool

  if (typeof tool.description === 'string') {
    if (rule.scope.toolDescriptions) {
      const filtered = applyTextRules(tool.description, rule, { identity: false, scopePaths: rule.scope.paths })
      const renamed = rule.scope.toolNames ? rule.names.renameText(filtered.text) : filtered.text
      if (renamed !== tool.description) {
        next = { ...next, description: renamed }
        stats.descriptionsChanged += 1
        stats.hits.strip += filtered.hits.strip
        stats.hits.replace += filtered.hits.replace
      }
    } else if (rule.scope.toolNames) {
      const renamed = rule.names.renameText(tool.description)
      if (renamed !== tool.description) {
        next = { ...next, description: renamed }
        stats.descriptionsChanged += 1
      }
    }
  }

  if (rule.scope.toolNames && typeof tool.name === 'string') {
    const candidate = resolveName(tool.name)
    if (candidate !== tool.name && SAFE_TOOL_NAME.test(candidate)) {
      next = { ...next, name: candidate }
      stats.namesChanged += 1
    }
  }

  if (rule.scope.toolDescriptions && next.parameters !== null && typeof next.parameters === 'object') {
    const inner = { changed: false, strip: 0, replace: 0 }
    const parameters = rewriteSchema(next.parameters, rule, inner)
    if (inner.changed) {
      next = { ...next, parameters }
      stats.hits.strip += inner.strip
      stats.hits.replace += inner.replace
    }
  }

  if (next !== tool) stats.changed = true
  return next
}

/**
 * Build the one tool-name resolver every outbound rewrite shares.
 *
 * `projectToolUpdates` drops a developer `tool-addition` block whose
 * `toolName` is missing from the declarations it rebuilds from `toolHistory`,
 * so a mismatch between the two rename decisions silently deactivates deferred
 * tools. `nameMap` is authoritative for names already declared in
 * `options.tools` (it carries the collision check); names that exist only in
 * the history fall back to the static map.
 *
 * @param rule - compiled rule.
 * @param nameMap - `filterTools(...).nameMap`, the collision-checked decisions.
 * @param declared - names present in `options.tools`, i.e. names `nameMap` has
 *   already ruled on (a missing entry means "do not rename").
 */
export function toolNameResolver(rule, nameMap, declared) {
  if (!rule.scope.toolNames || rule.names === undefined || rule.names.size === 0) return (name) => name
  const mapped = nameMap instanceof Map ? nameMap : new Map()
  const known = declared instanceof Set ? declared : new Set()
  return (name) => {
    if (typeof name !== 'string') return name
    const planned = mapped.get(name)
    if (planned !== undefined) return planned
    if (known.has(name)) return name
    const target = rule.names.tools.get(name)
    // History-only names have no collision check of their own; refuse a target
    // that a declared tool already occupies instead of shadowing it.
    if (target === undefined || known.has(target) || !SAFE_TOOL_NAME.test(target)) return name
    return target
  }
}

export function filterTools(tools, rule) {
  const result = emptyResult(tools)
  if (!Array.isArray(tools) || tools.length === 0) return result

  const taken = new Set()
  for (const tool of tools) {
    if (tool !== null && typeof tool === 'object' && typeof tool.name === 'string') taken.add(tool.name)
  }
  result.declared = taken
  // Reserve every outbound name that an unrenamed tool already occupies.
  const planned = new Map()
  if (rule.scope.toolNames) {
    for (const tool of tools) {
      if (tool === null || typeof tool !== 'object' || typeof tool.name !== 'string') continue
      const target = rule.names.tools.get(tool.name)
      if (target === undefined || target === tool.name) continue
      if (taken.has(target)) continue
      planned.set(tool.name, target)
    }
  }

  const resolveName = (name) => planned.get(name) ?? name
  const stats = emptyStats()
  const out = tools.map((tool) => {
    const next = rewriteTool(tool, rule, resolveName, stats)
    if (next !== tool && typeof tool?.name === 'string' && typeof next?.name === 'string' && next.name !== tool.name) {
      result.nameMap.set(tool.name, next.name)
    }
    return next
  })

  result.changed = stats.changed
  result.descriptionsChanged = stats.descriptionsChanged
  result.namesChanged = stats.namesChanged
  result.hits.strip = stats.hits.strip
  result.hits.replace = stats.hits.replace
  if (result.changed) result.tools = out
  return result
}

/**
 * Filter the historical tool declarations attached to a loop request.
 *
 * `toolHistory` is deep-frozen by `ToolHistoryProjection`, so this never
 * mutates it: every changed schema and every changed update is a fresh object.
 *
 * @param history - `GenerateOptions.toolHistory` (may be absent).
 * @param rule - compiled rule.
 * @param resolve - the resolver from {@link toolNameResolver}; must be the same
 *   instance used for the message blocks, or additions stop matching.
 */
export function filterToolHistory(history, rule, resolve) {
  const result = {
    history,
    changed: false,
    tools: 0,
    additions: 0,
    namesChanged: 0,
    descriptionsChanged: 0,
    nameMap: new Map(),
    hits: { strip: 0, replace: 0, identity: 0 },
  }
  if (history === null || typeof history !== 'object') return result
  if (!Array.isArray(history.tools) && !Array.isArray(history.updates)) return result

  const rename = typeof resolve === 'function' ? resolve : (name) => name
  const stats = emptyStats()
  const rewrite = (tool) => {
    const next = rewriteTool(tool, rule, rename, stats)
    if (next !== tool && typeof tool?.name === 'string' && typeof next?.name === 'string' && next.name !== tool.name) {
      result.nameMap.set(tool.name, next.name)
    }
    return next
  }

  const tools = Array.isArray(history.tools) ? history.tools.map(rewrite) : history.tools
  if (Array.isArray(history.tools)) result.tools = history.tools.length

  let updates = history.updates
  if (Array.isArray(history.updates)) {
    updates = history.updates.map((update) => {
      if (update === null || typeof update !== 'object' || !Array.isArray(update.additions)) return update
      result.additions += update.additions.length
      const additions = update.additions.map(rewrite)
      const same = additions.every((tool, index) => tool === update.additions[index])
      return same ? update : { ...update, additions }
    })
  }

  result.namesChanged = stats.namesChanged
  result.descriptionsChanged = stats.descriptionsChanged
  result.hits.strip = stats.hits.strip
  result.hits.replace = stats.hits.replace
  result.changed = stats.changed
  if (result.changed) result.history = { ...history, tools, updates }
  return result
}
