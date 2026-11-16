/**
 * Build the filtered request clone.
 *
 * The incoming `GenerateOptions` for a loop request is deep-frozen, so the
 * filter never mutates it; it returns a shallow clone with replaced
 * `messages`/`tools`/`system` entries and leaves every other field alone.
 */

import { filterMessages } from './messages.js'
import { filterTools } from './tools.js'
import { applyTextRules } from './text.js'

function addHits(target, hits) {
  target.strip += hits.strip
  target.replace += hits.replace
  if (hits.identity) target.identity += hits.identity
}

function systemTextFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  const parts = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object' || message.role !== 'system') continue
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
  }
  return parts.join('\n\n')
}

function reminderTextsFromMessages(messages) {
  if (!Array.isArray(messages)) return []
  const parts = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    if (message.role !== 'user') continue
    if (message.source === null || typeof message.source !== 'object' || message.source.kind !== 'runtime-context') continue
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      }
    }
  }
  return parts
}

function toolSchemasOf(tools) {
  if (!Array.isArray(tools)) return []
  return tools.map((tool) => ({
    name: typeof tool?.name === 'string' ? tool.name : '',
    description: typeof tool?.description === 'string' ? tool.description : '',
  }))
}

/**
 * @param options - GenerateOptions from `llm/stream` (never mutated).
 * @param rule - compiled rule.
 * @param config - normalized plugin config (for the global dry-run switch).
 */
export function buildFilteredRequest(options, rule, config = {}) {
  const report = {
    at: new Date().toISOString(),
    provider: options.provider,
    model: options.model,
    sessionId: options.sessionId === undefined || options.sessionId === null ? null : String(options.sessionId),
    ruleId: rule.id,
    dryRun: config.dryRun === true || rule.dryRun === true,
    changed: false,
    system: { messages: 0, charsBefore: 0, charsAfter: 0 },
    reminders: { messages: 0, count: 0 },
    tools: { count: 0, descriptionsChanged: 0, namesChanged: 0 },
    hits: { strip: 0, replace: 0, identity: 0 },
    systemInstruction: '',
    reminderTexts: [],
    toolSchemas: [],
  }

  const request = { ...options }
  let changed = false
  let nameMap = new Map()

  if (rule.scope.toolDescriptions || rule.scope.toolNames) {
    const tools = filterTools(options.tools, rule)
    nameMap = tools.nameMap
    report.tools.count = tools.count
    report.tools.descriptionsChanged = tools.descriptionsChanged
    report.tools.namesChanged = tools.namesChanged
    addHits(report.hits, tools.hits)
    if (tools.changed) {
      request.tools = tools.tools
      changed = true
    }

    if (rule.scope.toolNames && tools.namesChanged > 0) {
      report.toolNameMap = Object.fromEntries(tools.nameMap)
    }
  }

  if (Array.isArray(options.messages) && options.messages.length > 0) {
    const messages = filterMessages(options.messages, rule, nameMap)
    report.system.messages = messages.systemMessages
    report.reminders.messages = messages.reminderMessages
    report.system.charsBefore += messages.charsBefore
    report.system.charsAfter += messages.charsAfter
    addHits(report.hits, messages.hits)
    if (messages.changed) {
      request.messages = messages.messages
      changed = true
    }
  }

  if (rule.scope.system && typeof options.system === 'string' && options.system !== '') {
    const filtered = applyTextRules(options.system, rule)
    if (filtered.text !== options.system) {
      request.system = filtered.text
      report.system.charsBefore += options.system.length
      report.system.charsAfter += filtered.text.length
      addHits(report.hits, filtered.hits)
      changed = true
    }
  }

  report.changed = changed
  const messages = request.messages ?? options.messages
  report.systemInstruction = systemTextFromMessages(messages)
  report.reminderTexts = reminderTextsFromMessages(messages)
  report.reminders.count = report.reminderTexts.length
  if (typeof request.system === 'string' && request.system !== '') {
    report.systemInstruction = report.systemInstruction === ''
      ? request.system
      : `${report.systemInstruction}\n\n${request.system}`
  }
  report.toolSchemas = toolSchemasOf(request.tools ?? options.tools)

  return { request, report, changed, dryRun: report.dryRun }
}

export function formatReport(report) {
  return [
    `rule=${report.ruleId}`,
    `model=${report.provider}/${report.model}`,
    `system=${report.system.charsBefore}->${report.system.charsAfter} chars`,
    `reminders=${report.reminders?.count ?? 0}`,
    `tools=${report.tools.count}`,
    `strip=${report.hits.strip}`,
    `replace=${report.hits.replace}`,
    `identity=${report.hits.identity > 0 ? 'yes' : 'no'}`,
  ].join(' ')
}