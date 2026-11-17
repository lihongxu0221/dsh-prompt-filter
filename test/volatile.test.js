import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../index.js'
import { plain } from '../lib/volatile.js'
import { SYSTEM_MESSAGE, USER_MESSAGE } from './fixture.js'

const VOLATILE = Symbol.for('cosmokit.volatile.write')

/** A minimal stand-in for cosmokit's `Volatile<T>` reference. */
function ref(get) {
  return {
    [VOLATILE]: () => {},
    get,
    toString: () => '[volatile]',
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.prototype.hasOwnProperty.call(value, VOLATILE)) {
    for (const entry of Object.values(value)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

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

function optionsOf() {
  return deepFreeze({
    provider: 'magpie',
    model: 'group/gemini-3.8-flash',
    messages: [SYSTEM_MESSAGE, USER_MESSAGE],
    sessionId: 'session-1',
  })
}

test('plain() unwraps volatile references recursively and leaves cycles alone', () => {
  const inner = ref(() => ['a', ref(() => 'b')])
  const wrapper = { sidebarEntry: ref(() => true), rules: ref(() => inner), list: [ref(() => 1), 2] }
  const unwrapped = plain(wrapper)
  assert.deepEqual(unwrapped, { sidebarEntry: true, rules: ['a', 'b'], list: [1, 2] })

  const cyclic = { name: 'x' }
  cyclic.self = cyclic
  const safe = plain(cyclic)
  assert.equal(safe.name, 'x')
  assert.equal(safe.self.name, 'x')
})

test('a volatile config is committed live through loader/volatile-update', () => {
  const { ctx, listeners, calls } = makeCtx()
  let rules = [{ id: 'rule-a', modelMatch: ['gemini'], stripLines: ['You are an AI agent powered by DeepSeek Harness.'] }]
  const sidebarEntry = ref(() => true)
  apply(ctx, {
    sidebarEntry,
    enabled: ref(() => true),
    debug: ref(() => false),
    traceDir: ref(() => ''),
    rules: ref(() => rules),
  })
  const stream = listeners.get('llm/stream')

  stream.listener(optionsOf(), () => {})
  assert.equal(calls.length, 1)
  assert.ok(!JSON.stringify(calls[0].messages).includes('powered by DeepSeek Harness'))

  // A GUI save replaces the value behind the same reference and emits the
  // volatile-update event; no second apply() happens.
  rules = [{ id: 'rule-b', modelMatch: ['gemini'], stripLines: ['The session workspace'] }]
  listeners.get('loader/volatile-update').listener([['rules']])

  stream.listener(optionsOf(), () => {})
  assert.equal(calls.length, 2)
  assert.ok(!JSON.stringify(calls[1].messages).includes('The session workspace'))
  assert.ok(JSON.stringify(calls[1].messages).includes('powered by DeepSeek Harness'))
})

test('an invalid volatile commit keeps the last valid rules', () => {
  const { ctx, listeners, calls } = makeCtx()
  let rules = [{ id: 'rule-a', modelMatch: ['gemini'], stripLines: ['You are an AI agent powered by DeepSeek Harness.'] }]
  apply(ctx, { enabled: ref(() => true), rules: ref(() => rules) })
  const stream = listeners.get('llm/stream')

  stream.listener(optionsOf(), () => {})
  assert.equal(calls.length, 1)

  rules = [{ id: 'broken', modelMatch: ['gemini'], stripLines: [42] }]
  listeners.get('loader/volatile-update').listener([['rules']])

  stream.listener(optionsOf(), () => {})
  assert.equal(calls.length, 2)
  assert.ok(!JSON.stringify(calls[1].messages).includes('powered by DeepSeek Harness'))
})

test('turning filtering off live passes the next request straight through', () => {
  const { ctx, listeners, calls } = makeCtx()
  let enabled = true
  let nextCalls = 0
  apply(ctx, {
    enabled: ref(() => enabled),
    rules: ref(() => [{ id: 'rule-a', modelMatch: ['gemini'], stripLines: ['You are an AI agent powered by DeepSeek Harness.'] }]),
  })
  const stream = listeners.get('llm/stream')
  const next = () => { nextCalls += 1; return (async function* pass() { yield { type: 'finish', reason: { kind: 'stop' } } })() }

  stream.listener(optionsOf(), next)
  assert.equal(calls.length, 1)

  enabled = false
  listeners.get('loader/volatile-update').listener([['enabled']])
  stream.listener(optionsOf(), next)
  assert.equal(calls.length, 1)
  assert.equal(nextCalls, 1)
})