import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_RULES } from '../lib/config.js'
import { filterMessages } from '../lib/messages.js'
import { compileRule } from '../lib/rule.js'
import {
  ASSISTANT_TOOL_CALL,
  DEVELOPER_MEMORY,
  RUNTIME_REMINDER,
  SYSTEM_MESSAGE,
  USER_MESSAGE,
  forbiddenHits,
} from './fixture.js'

const rule = compileRule(FALLBACK_RULES[0], 0)

function messagesWithSystem() {
  return [SYSTEM_MESSAGE, USER_MESSAGE, ASSISTANT_TOOL_CALL, DEVELOPER_MEMORY]
}

test('system text is filtered while user and assistant content stay untouched', () => {
  const result = filterMessages(messagesWithSystem(), rule, new Map())
  assert.equal(result.changed, true)
  assert.equal(result.systemMessages, 1)
  assert.deepEqual(forbiddenHits(result.messages[0].content[0].text), [])
  assert.equal(result.messages[1], USER_MESSAGE)
  assert.equal(result.messages[2], ASSISTANT_TOOL_CALL)
})

test('developer memory blocks are scrubbed under memoryReminders', () => {
  const result = filterMessages(messagesWithSystem(), rule, new Map())
  const memory = result.messages[3].content[0].text
  assert.ok(!/dsh/i.test(memory))
  assert.ok(memory.includes('Memory:'))
})

test('runtime-context reminder messages are scrubbed under memoryReminders', () => {
  const result = filterMessages([RUNTIME_REMINDER], rule, new Map())
  assert.equal(result.changed, true)
  assert.equal(result.reminderMessages, 1)
  const text = result.messages[0].content[0].text
  assert.deepEqual(forbiddenHits(text), [])
  assert.ok(text.startsWith('<system-reminder>'))
})

test('runtime-context reminders stay untouched when memoryReminders is off', () => {
  const offRule = compileRule({
    ...FALLBACK_RULES[0],
    scope: { ...FALLBACK_RULES[0].scope, memoryReminders: false },
  }, 0)
  const result = filterMessages([RUNTIME_REMINDER], offRule, new Map())
  assert.equal(result.changed, false)
  assert.equal(result.messages[0], RUNTIME_REMINDER)
})

test('tool names are only rewritten when a rename map exists', () => {
  const nameMap = new Map([['ops_bash', 'shell_exec']])
  const renamedRule = compileRule({ ...FALLBACK_RULES[0], scope: { ...FALLBACK_RULES[0].scope, toolNames: true } }, 0)
  const result = filterMessages([ASSISTANT_TOOL_CALL], renamedRule, nameMap)
  assert.equal(result.messages[0].content[0].name, 'shell_exec')
  assert.equal(result.messages[0].content[0].arguments, '{"command":"pwd"}')

  const untouched = filterMessages([ASSISTANT_TOOL_CALL], rule, new Map())
  assert.equal(untouched.messages[0], ASSISTANT_TOOL_CALL)
  assert.equal(untouched.changed, false)
})

test('messages without content do not crash the filter', () => {
  const result = filterMessages([{ role: 'system', id: 'x' }], rule, new Map())
  assert.equal(result.changed, false)
})