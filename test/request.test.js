import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_RULES } from '../lib/config.js'
import { buildFilteredRequest, formatReport } from '../lib/request.js'
import { compileRule } from '../lib/rule.js'
import {
  ASSISTANT_TOOL_CALL,
  DEVELOPER_MEMORY,
  RUNTIME_REMINDER,
  SYSTEM_MESSAGE,
  TOOLS,
  USER_MESSAGE,
  forbiddenHits,
} from './fixture.js'

const rule = compileRule(FALLBACK_RULES[0], 0)

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

function optionsOf(overrides = {}) {
  return deepFreeze(structuredClone({
    provider: 'magpie',
    model: 'group/gemini-3.8-flash',
    messages: [SYSTEM_MESSAGE, USER_MESSAGE, ASSISTANT_TOOL_CALL, DEVELOPER_MEMORY, RUNTIME_REMINDER],
    tools: TOOLS,
    sessionId: 'session-1',
    ...overrides,
  }))
}

test('the frozen request is never mutated and a filtered clone is returned', () => {
  const options = optionsOf()
  const before = JSON.stringify(options)
  const result = buildFilteredRequest(options, rule, {})
  assert.equal(JSON.stringify(options), before)
  assert.equal(result.changed, true)
  assert.notEqual(result.request, options)
  assert.ok(result.request.messages)
  assert.ok(result.request.tools)
})

test('report captures what will be sent and contains no identity tokens', () => {
  const { report } = buildFilteredRequest(optionsOf(), rule, {})
  assert.equal(report.ruleId, 'default-gemini-claude')
  assert.equal(report.provider, 'magpie')
  assert.equal(report.sessionId, 'session-1')
  assert.deepEqual(forbiddenHits(report.systemInstruction), [])
  assert.ok(report.systemInstruction.includes('You are a helpful coding assistant.'))
  assert.ok(report.systemInstruction.includes('Current working directory:'))
  assert.equal(report.reminders.count, 1)
  assert.equal(report.reminders.messages, 1)
  assert.deepEqual(forbiddenHits(report.reminderTexts[0]), [])
  assert.equal(report.toolSchemas.length, TOOLS.length)
  for (const tool of report.toolSchemas) assert.deepEqual(forbiddenHits(tool.description), [])
  assert.ok(report.hits.strip > 0)
  assert.ok(report.hits.replace > 0)
})

test('a top-level system string is filtered for one-shot callers', () => {
  const options = deepFreeze(structuredClone({
    provider: 'magpie',
    model: 'group/claude-sonnet-5.5',
    messages: [],
    system: 'You are an AI agent powered by DeepSeek Harness.',
  }))
  const result = buildFilteredRequest(options, rule, {})
  assert.equal(result.changed, true)
  assert.deepEqual(forbiddenHits(result.request.system), [])
  assert.ok(result.request.system.startsWith('You are a helpful coding assistant.'))
})

test('a request with nothing to strip is left byte-identical', () => {
  const plain = compileRule({ modelMatch: ['gemini'], stripLines: [], replace: [] }, 0)
  const options = optionsOf({ messages: [{ role: 'user', id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }], tools: [] })
  const result = buildFilteredRequest(options, plain, {})
  assert.equal(result.changed, false)
  assert.equal(result.request.messages, options.messages)
})

test('tool name renames propagate to assistant tool-call blocks', () => {
  const renaming = compileRule({
    modelMatch: ['gemini'],
    stripLines: [],
    replace: [],
    nameMap: { tools: { ops_bash: 'shell_exec' } },
  }, 0)
  const result = buildFilteredRequest(optionsOf(), renaming, {})
  assert.equal(result.changed, true)
  assert.ok(result.request.tools.some((tool) => tool.name === 'shell_exec'))
  assert.equal(result.request.messages[2].content[0].name, 'shell_exec')
  assert.deepEqual(result.report.toolNameMap, { ops_bash: 'shell_exec' })
})

test('dry-run is reported from config or the matching rule', () => {
  assert.equal(buildFilteredRequest(optionsOf(), rule, { dryRun: true }).dryRun, true)
  const dryRule = compileRule({ ...FALLBACK_RULES[0], dryRun: true }, 0)
  assert.equal(buildFilteredRequest(optionsOf(), dryRule, {}).dryRun, true)
  assert.equal(buildFilteredRequest(optionsOf(), rule, {}).dryRun, false)
})

test('formatReport names the rule, model, and change sizes', () => {
  const { report } = buildFilteredRequest(optionsOf(), rule, {})
  const line = formatReport(report)
  assert.ok(line.includes('rule=default-gemini-claude'))
  assert.ok(line.includes('group/gemini-3.8-flash'))
  assert.ok(line.includes('system='))
})