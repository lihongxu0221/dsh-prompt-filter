/**
 * Message filtering.
 *
 * Only system-role text (the composed prompt, including runtime context and
 * memory sections), developer-role text (memory/reminder blocks), and
 * runtime-context reminder messages (the durable `<system-reminder>` snapshot
 * the loop appends as a user-role message) are rewritten. Genuine user,
 * assistant, and tool message content is never touched, except assistant
 * `tool-call` names when `scope.toolNames` is enabled and a tool was actually
 * renamed.
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
    charsBefore: 0,
    charsAfter: 0,
    hits: { strip: 0, replace: 0, identity: 0 },
  }
  if (!Array.isArray(messages) || messages.length === 0) return result

  const renamed = rule.scope.toolNames && nameMap instanceof Map && nameMap.size > 0

  const out = messages.map((message) => {
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return message
    const source = reminderSourceOf(message)
    const isSystem = message.role === 'system' && rule.scope.system
    const isDeveloper = message.role === 'developer' && rule.scope.memoryReminders
    const isReminder = message.role === 'user' && source?.kind === 'runtime-context' && rule.scope.memoryReminders
    if (!isSystem && !isDeveloper && !isReminder && !renamed) return message

    if (isSystem) result.systemMessages += 1
    if (isReminder) result.reminderMessages += 1
    let messageChanged = false

    const content = message.content.map((block) => {
      if (block === null || typeof block !== 'object') return block

      if ((isSystem || isDeveloper || isReminder) && block.type === 'text' && typeof block.text === 'string') {
        const filtered = applyTextRules(block.text, rule, {
          identity: isSystem,
          scopePaths: rule.scope.paths,
        })
        if (filtered.text === block.text) return block
        result.charsBefore += block.text.length
        result.charsAfter += filtered.text.length
        result.hits.strip += filtered.hits.strip
        result.hits.replace += filtered.hits.replace
        if (filtered.hits.identity) result.hits.identity += 1
        messageChanged = true
        return { ...block, text: filtered.text }
      }

      if (renamed && message.role === 'assistant' && block.type === 'tool-call') {
        const nextName = nameMap.get(block.name)
        if (nextName === undefined || nextName === block.name) return block
        messageChanged = true
        return { ...block, name: nextName }
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