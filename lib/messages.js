/**
 * Message filtering.
 *
 * Outbound-only text rewrite (`stripLines` / `replace`) applies to:
 *   - system-role text (the composed prompt, including runtime/memory sections)
 *   - developer-role text (memory/reminder blocks)
 *   - runtime-context reminder messages
 *   - the model-facing `<available_skills>` catalog text (`scope.skillCatalog`)
 *
 * Renames (outbound + inbound restore) apply to:
 *   - assistant `tool-call` names
 *   - developer `tool-addition` / `tool-removal` block `toolName`
 *   - whole-token tool/skill names inside the text blocks above
 *
 * Genuine user and tool message content is never rewritten.
 */

import { applyTextRules } from './text.js'

function reminderSourceOf(message) {
  return message?.source !== null && typeof message?.source === 'object' ? message.source : undefined
}

export function filterMessages(messages, rule, nameMap) {
  const result = {
    messages,
    changed: false,
    systemMessages: 0,
    reminderMessages: 0,
    catalogMessages: 0,
    charsBefore: 0,
    charsAfter: 0,
    renamedCalls: 0,
    hits: { strip: 0, replace: 0, identity: 0 },
  }
  if (!Array.isArray(messages) || messages.length === 0) return result

  const renameText = rule.scope.toolNames && rule.names !== undefined ? rule.names.renameText : (text) => text
  const toolRenames = rule.scope.toolNames && nameMap instanceof Map && nameMap.size > 0
  const skillRenames = rule.scope.toolNames && rule.names !== undefined && rule.names.size > 0

  const out = messages.map((message) => {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return message
    const source = reminderSourceOf(message)
    const isSystem = message.role === 'system' && rule.scope.system
    const isDeveloper = message.role === 'developer' && rule.scope.memoryReminders
    const isReminder = message.role === 'user' && source?.kind === 'runtime-context' && rule.scope.memoryReminders
    const isCatalog = message.role === 'user' && source?.kind === 'skill-catalog' && rule.scope.skillCatalog
    const textScope = isSystem || isDeveloper || isReminder || isCatalog
    if (!textScope && !toolRenames && !skillRenames) return message

    if (isSystem) result.systemMessages += 1
    if (isReminder) result.reminderMessages += 1
    if (isCatalog) result.catalogMessages += 1
    let messageChanged = false

    const content = message.content.map((block) => {
      if (block === null || typeof block !== 'object') return block

      if (textScope && block.type === 'text' && typeof block.text === 'string') {
        const filtered = applyTextRules(block.text, rule, {
          identity: isSystem,
          scopePaths: rule.scope.paths,
        })
        const renamed = renameText(filtered.text)
        if (renamed === block.text) return block
        result.charsBefore += block.text.length
        result.charsAfter += renamed.length
        result.hits.strip += filtered.hits.strip
        result.hits.replace += filtered.hits.replace
        if (filtered.hits.identity) result.hits.identity += 1
        messageChanged = true
        return { ...block, text: renamed }
      }

      if (toolRenames && message.role === 'assistant' && block.type === 'tool-call') {
        const nextName = nameMap.get(block.name)
        if (nextName === undefined || nextName === block.name) return block
        result.renamedCalls += 1
        messageChanged = true
        return { ...block, name: nextName }
      }

      if ((block.type === 'tool-addition' || block.type === 'tool-removal') && skillRenames) {
        const nextName = rule.names.tools.get(block.toolName)
        if (nextName === undefined || nextName === block.toolName) return block
        messageChanged = true
        return { ...block, toolName: nextName }
      }

      return block
    })

    if (!messageChanged) return message
    result.changed = true
    return { ...message, content }
  })

  if (result.changed) result.messages = out
  return result
}
