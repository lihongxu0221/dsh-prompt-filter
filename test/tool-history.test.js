/**
 * `toolHistory` filtering.
 *
 * On a route that declares `toolUpdate`, upstream `projectToolUpdates`
 * (`packages/llm/llm/src/content.ts`) ignores `options.tools` and rebuilds the
 * declaration map from `options.toolHistory`, then drops every developer
 * `tool-addition` block whose `toolName` that map does not contain. These tests
 * pin both halves: the history must lose the brand text, and its names must
 * stay identical to the renamed message blocks or deferred tools go dark.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_RULES } from '../lib/config.js'
import { buildFilteredRequest } from '../lib/request.js'
import { compileRule } from '../lib/rule.js'
import { filterToolHistory, filterTools, toolNameResolver } from '../lib/tools.js'
import { forbiddenHits } from './fixture.js'

const rule = compileRule(FALLBACK_RULES[0], 0)

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

function historyOf() {
  return deepFreeze({
    tools: [
      {
        name: 'ops_bash',
        description: "Run a command in this session's DSH session cwd.",
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Command under the DSH file policy.' } },
          required: ['command'],
        },
        deferLoading: true,
      },
      { name: 'acp_status', description: 'Context status from billion-context.', parameters: {} },
      { name: 'plugin_manager', description: 'List plugins in the current profile.', parameters: {} },
    ],
    updates: [
      {
        messageId: 'm10',
        additions: [
          {
            name: 'ops_bash',
            description: "Run a command in this session's DSH session cwd.",
            parameters: { type: 'object', properties: {} },
            deferLoading: true,
          },
        ],
      },
    ],
  })
}

function optionsOf(history) {
  return deepFreeze(structuredClone({
    provider: 'magpie',
    model: 'group/gemini-3.8-flash',
    sessionId: 'session-1',
    messages: [
      {
        role: 'developer',
        id: 'm10',
        content: [
          { type: 'tool-addition', toolName: 'ops_bash' },
          { type: 'text', text: 'Deferred tools become available on demand.' },
        ],
      },
    ],
    tools: [
      { name: 'ops_bash', description: 'DSH bash.', parameters: {} },
      { name: 'acp_status', description: 'ACP status.', parameters: {} },
      { name: 'plugin_manager', description: 'DSH plugins.', parameters: {} },
    ],
    ...history === undefined ? {} : { toolHistory: history },
  }))
}

test('toolHistory keeps its shape but loses brand text and renames tools', () => {
  const history = historyOf()
  const before = JSON.stringify(history)
  const result = filterToolHistory(history, rule, toolNameResolver(rule, new Map(), new Set()))

  assert.equal(JSON.stringify(history), before, 'the frozen history must not be mutated')
  assert.equal(result.changed, true)
  assert.equal(result.tools, 3)
  assert.equal(result.additions, 1)

  for (const tool of result.history.tools) {
    assert.deepEqual(forbiddenHits(tool.description), [], `${tool.name}: ${tool.description}`)
  }
  for (const update of result.history.updates) {
    for (const tool of update.additions) {
      assert.deepEqual(forbiddenHits(tool.description), [], `${tool.name}: ${tool.description}`)
    }
  }
  assert.deepEqual(result.history.tools.map((tool) => tool.name), ['run_bash', 'context_status', 'plugin_registry'])
  assert.equal(result.history.updates[0].additions[0].name, 'run_bash')
  assert.equal(result.history.updates[0].additions[0].deferLoading, true, 'schema fields are preserved')
  assert.equal(result.history.updates[0].messageId, 'm10')
})

test('a deferred addition keeps the same name as the message block it activates', () => {
  const options = optionsOf(historyOf())
  const { request } = buildFilteredRequest(options, rule, {})

  const addition = request.toolHistory.updates[0].additions[0]
  const block = request.messages[0].content.find((entry) => entry.type === 'tool-addition')
  assert.equal(addition.name, 'run_bash')
  assert.equal(block.toolName, 'run_bash')
  assert.equal(block.toolName, addition.name, 'projectToolUpdates matches these by name')
  assert.ok(
    request.toolHistory.tools.some((tool) => tool.name === block.toolName),
    'the rebuilt declaration map must contain the activated name',
  )
})

test('the report counts history work and the tool name map covers it', () => {
  const { report } = buildFilteredRequest(optionsOf(historyOf()), rule, {})
  assert.equal(report.toolHistory.tools, 3)
  assert.equal(report.toolHistory.additions, 1)
  assert.ok(report.toolHistory.namesChanged >= 3)
  assert.equal(report.toolNameMap.ops_bash, 'run_bash')
  assert.equal(report.toolNameMap.plugin_manager, 'plugin_registry')
})

test('history-only names fall back to the static map', () => {
  const history = deepFreeze({
    tools: [{ name: 'session_event_read', description: 'Read one event.', parameters: {} }],
    updates: [],
  })
  const declared = new Set()
  const resolve = toolNameResolver(rule, new Map(), declared)
  const result = filterToolHistory(history, rule, resolve)
  assert.equal(result.history.tools[0].name, 'event_read')
})

test('a collision blocks the rename in the history too', () => {
  const collisionRule = compileRule({
    modelMatch: ['gemini'],
    stripLines: [],
    replace: [],
    nameMap: { tools: { ops_bash: 'run_bash' } },
  }, 0)
  const tools = [
    { name: 'ops_bash', description: 'a', parameters: {} },
    { name: 'run_bash', description: 'already taken', parameters: {} },
  ]
  const filtered = filterTools(tools, collisionRule)
  assert.equal(filtered.nameMap.size, 0)

  const resolve = toolNameResolver(collisionRule, filtered.nameMap, filtered.declared)
  const history = deepFreeze({
    tools: [{ name: 'ops_bash', description: 'a', parameters: {} }],
    updates: [{ messageId: 'm1', additions: [{ name: 'ops_bash', description: 'a', parameters: {} }] }],
  })
  const result = filterToolHistory(history, collisionRule, resolve)
  assert.equal(result.changed, false, 'nothing to rewrite once the collision is honored')
  assert.equal(result.history, history)
})

test('a request without toolHistory is untouched', () => {
  const options = optionsOf()
  const result = buildFilteredRequest(options, rule, {})
  assert.equal(result.request.toolHistory, undefined)
  assert.deepEqual(result.report.toolHistory, {
    tools: 0,
    additions: 0,
    descriptionsChanged: 0,
    namesChanged: 0,
  })
})

test('an empty history is reported as unchanged', () => {
  const history = deepFreeze({ tools: [], updates: [] })
  const result = filterToolHistory(history, rule, toolNameResolver(rule, new Map(), new Set()))
  assert.equal(result.changed, false)
  assert.equal(result.history, history)
})
