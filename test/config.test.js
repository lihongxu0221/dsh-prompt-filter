import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_SCOPE, FALLBACK_RULES, normalizeConfig } from '../lib/config.js'

test('missing rules fall back to the built-in default rule set', () => {
  const config = normalizeConfig({})
  assert.equal(config.enabled, true)
  assert.equal(config.rules.length, 1)
  assert.deepEqual(config.rules[0].modelMatch, ['gemini', 'claude'])
  assert.deepEqual(config.problems, [])
})

test('an empty rules array also falls back to defaults', () => {
  const config = normalizeConfig({ rules: [] })
  assert.equal(config.rules.length, 1)
  assert.equal(config.rules[0].id, FALLBACK_RULES[0].id)
})

test('explicit rules replace the fallback entirely', () => {
  const config = normalizeConfig({ rules: [{ id: 'only-claude', modelMatch: ['claude'], stripLines: [] }] })
  assert.equal(config.rules.length, 1)
  assert.equal(config.rules[0].id, 'only-claude')
})

test('disabled and dry-run switches default to off, subagents to on', () => {
  const config = normalizeConfig(undefined)
  assert.equal(config.enabled, true)
  assert.equal(config.dryRun, false)
  assert.equal(config.debug, false)
  assert.equal(config.applyToSubagents, true)
  assert.equal(config.traceDir, '')
})

test('non-boolean scope entries are reported by rule compilation', async () => {
  const { compileRule } = await import('../lib/rule.js')
  assert.throws(
    () => compileRule({ modelMatch: ['gemini'], scope: { system: 'yes' } }, 0),
    /scope\.system must be a boolean/,
  )
})

test('default scope keeps tool names off and paths on', () => {
  assert.equal(DEFAULT_SCOPE.toolNames, false)
  assert.equal(DEFAULT_SCOPE.paths, true)
})

test('a non-object config is rejected', () => {
  const config = normalizeConfig('nope')
  assert.ok(config.problems.length > 0)
})

test('a non-array traceDir is rejected', () => {
  const config = normalizeConfig({ traceDir: 42 })
  assert.ok(config.problems.some((problem) => problem.includes('traceDir')))
})