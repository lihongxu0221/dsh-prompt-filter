import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'

import {
  matchesNoRetry,
  modelForSession,
  recordModel,
  resetSessionModels,
} from '../lib/retry.js'

beforeEach(() => resetSessionModels())

test('the model seen on llm/stream is remembered per session', () => {
  recordModel('s1', 'magpie', 'group/gemini-3.8-flash')
  assert.deepEqual(modelForSession('s1'), { provider: 'magpie', model: 'group/gemini-3.8-flash' })
  assert.deepEqual(modelForSession('s1', 'magpie'), { provider: 'magpie', model: 'group/gemini-3.8-flash' })
  assert.equal(modelForSession('s1', 'other-provider'), undefined)
  assert.equal(modelForSession('missing'), undefined)
  assert.equal(modelForSession(undefined), undefined)
})

test('the session map stays bounded', () => {
  for (let index = 0; index < 1200; index += 1) recordModel(`s-${index}`, 'magpie', 'x')
  assert.ok(modelForSession('s-1199'))
  assert.equal(modelForSession('s-0'), undefined)
})

test('noRetryOn matches the upstream 429 quota message', () => {
  const patterns = ['Resource has been exhausted', 'RATE_LIMIT']
  assert.equal(matchesNoRetry(patterns, {
    code: 'RATE_LIMIT',
    status: 429,
    message: 'Resource has been exhausted (e.g. check quota).',
  }), true)
})

test('noRetryOn is case-insensitive and falls through for unrelated failures', () => {
  const patterns = ['resource has been exhausted']
  assert.equal(matchesNoRetry(patterns, { code: 'SERVER', message: 'Resource has been exhausted' }), true)
  assert.equal(matchesNoRetry(patterns, { code: 'TIMEOUT', message: 'request timed out' }), false)
  assert.equal(matchesNoRetry([], { code: 'RATE_LIMIT', message: 'x' }), false)
  assert.equal(matchesNoRetry(patterns, null), false)
})