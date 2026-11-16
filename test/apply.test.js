import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'
import { SYSTEM_MESSAGE, USER_MESSAGE } from './fixture.js'

function makeCtx() {
  const listeners = new Map()
  const calls = []
  const ctx = {
    on(name, listener, options) {
      listeners.set(name, { listener, options })
      return () => {}
    },
    llm: {
      stream(options) {
        calls.push(options)
        return (async function* chunks() {
          yield { type: 'text-delta', text: 'ok' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    },
    get() {
      return undefined
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, listeners, calls }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

const TEST_TRACE_DIR = mkdtempSync(join(tmpdir(), 'dsh-prompt-filter-apply-'))
test.after(() => rmSync(TEST_TRACE_DIR, { recursive: true, force: true }))

function configOf(overrides = {}) {
  return {
    enabled: true,
    debug: false,
    traceDir: TEST_TRACE_DIR,
    rules: [{
      id: 'test-rule',
      modelMatch: ['gemini'],
      noRetryOn: ['Resource has been exhausted', 'RATE_LIMIT'],
      replace: [],
      stripLines: ['You are an AI agent powered by DeepSeek Harness.'],
      ...overrides,
    }],
  }
}

function optionsOf() {
  return deepFreeze({
    provider: 'magpie',
    model: 'group/gemini-3.8-flash',
    messages: [SYSTEM_MESSAGE, USER_MESSAGE],
    tools: [],
    sessionId: 'session-1',
  })
}

test('the llm/stream listener filters, re-dispatches once, and does not loop', async () => {
  const { ctx, listeners, calls } = makeCtx()
  apply(ctx, configOf())
  const registration = listeners.get('llm/stream')
  assert.equal(registration.options.prepend, true)

  const options = optionsOf()
  let nextCalls = 0
  const nextStream = () => {
    nextCalls += 1
    return (async function* builtIn() {
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
  const stream = registration.listener(options, nextStream)

  assert.equal(calls.length, 1)
  assert.notEqual(calls[0], options)
  assert.ok(!JSON.stringify(calls[0].messages).includes('You are an AI agent powered by DeepSeek Harness.'))

  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.kind, 'stop')

  // Re-entry with the filtered request must delegate instead of filtering again.
  const again = registration.listener(calls[0], nextStream)
  for await (const _chunk of again) { /* drain */ }
  assert.equal(nextCalls, 1)
  assert.equal(calls.length, 1)
})

test('a non-matching model is passed straight through', () => {
  const { ctx, listeners, calls } = makeCtx()
  apply(ctx, configOf())
  const options = deepFreeze({ provider: 'magpie', model: 'auto/deepseek-v4.1-flash', messages: [], sessionId: 's' })
  let nextCalls = 0
  listeners.get('llm/stream').listener(options, () => { nextCalls += 1 })
  assert.equal(nextCalls, 1)
  assert.equal(calls.length, 0)
})

test('disabled config registers no listeners at all', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, { ...configOf(), enabled: false })
  assert.equal(listeners.size, 0)
})

test('dry-run yields a finish error and sends nothing', async () => {
  const { ctx, listeners, calls } = makeCtx()
  apply(ctx, configOf({ dryRun: true }))
  const stream = listeners.get('llm/stream').listener(optionsOf(), () => { throw new Error('must not dispatch') })
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  assert.equal(calls.length, 0)
  assert.equal(chunks[0].reason.kind, 'error')
  assert.equal(chunks[0].reason.failure.code, 'PROMPT_FILTER_DRY_RUN')
})

test('the noRetryOn veto stops identical retries for the matching model', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, configOf())
  // The model is remembered from the outgoing request.
  listeners.get('llm/stream').listener(optionsOf(), () => {})
  const veto = listeners.get('agent/request-error')
  assert.equal(veto.options.prepend, true)

  const payload = {
    agent: { session: { id: 'session-1', header: { isSeeded: true } } },
    failure: { code: 'RATE_LIMIT', status: 429, message: 'Resource has been exhausted (e.g. check quota).' },
  }
  let nextCalls = 0
  const action = veto.listener(payload, () => { nextCalls += 1; return undefined })
  assert.equal(action, undefined)
  assert.equal(nextCalls, 0)

  const unrelated = { ...payload, failure: { code: 'SERVER', message: 'bad gateway' } }
  veto.listener(unrelated, () => { nextCalls += 1 })
  assert.equal(nextCalls, 1)
})

test('applyToSubagents false lets a subagent retry normally', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, { ...configOf(), applyToSubagents: false })
  listeners.get('llm/stream').listener(optionsOf(), () => {})
  const veto = listeners.get('agent/request-error')
  let nextCalls = 0
  veto.listener({
    agent: { session: { id: 'session-1', header: { origin: 'subagent', parentSession: 'p' } } },
    failure: { code: 'RATE_LIMIT', message: 'Resource has been exhausted' },
  }, () => { nextCalls += 1 })
  assert.equal(nextCalls, 1)
})