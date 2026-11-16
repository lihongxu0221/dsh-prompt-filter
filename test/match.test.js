import assert from 'node:assert/strict'
import test from 'node:test'

import { compileMatchers, matchModel } from '../lib/match.js'

test('substring matching covers gemini and claude in group-prefixed ids', () => {
  const matchers = compileMatchers(['gemini', 'claude'], 'modelMatch', [])
  assert.equal(matchModel(matchers, { provider: 'magpie', model: 'group/gemini-3.8-flash' }), true)
  assert.equal(matchModel(matchers, { provider: 'magpie', model: 'group/claude-sonnet-5.5' }), true)
  assert.equal(matchModel(matchers, { provider: 'magpie', model: 'auto/deepseek-v4.1-flash' }), false)
})

test('matching is case-insensitive and covers the provider/model composite', () => {
  const matchers = compileMatchers(['MAGPIE/GROUP/GEMINI'], 'modelMatch', [])
  assert.equal(matchModel(matchers, { provider: 'magpie', model: 'group/gemini-3.8-flash' }), true)
})

test('regex entries match raw model ids', () => {
  const problems = []
  const matchers = compileMatchers(['/^group\\/gemini-/i'], 'modelMatch', problems)
  assert.deepEqual(problems, [])
  assert.equal(matchModel(matchers, { provider: 'magpie', model: 'group/gemini-4-hydrogen' }), true)
  assert.equal(matchModel(matchers, { provider: 'magpie', model: 'group/grok-4.7' }), false)
})

test('invalid matcher lists are reported instead of throwing', () => {
  const problems = []
  assert.deepEqual(compileMatchers(undefined, 'modelMatch', problems), [])
  assert.ok(problems.length > 0)
})