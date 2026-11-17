import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_NAME_MAP, DEFAULT_SCOPE, FALLBACK_RULES, normalizeConfig } from '../lib/config.js'

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

test('default scope renames names and redacts paths', () => {
  assert.equal(DEFAULT_SCOPE.toolNames, true)
  assert.equal(DEFAULT_SCOPE.paths, true)
  assert.equal(DEFAULT_SCOPE.skillCatalog, true)
})

test('a non-object config is rejected', () => {
  const config = normalizeConfig('nope')
  assert.ok(config.problems.length > 0)
})

test('a non-array traceDir is rejected', () => {
  const config = normalizeConfig({ traceDir: 42 })
  assert.ok(config.problems.some((problem) => problem.includes('traceDir')))
})

test('rules saved by an older profile gain nameMap without losing explicit values', async () => {
  const { compileRule } = await import('../lib/rule.js')
  const legacy = {
    rules: [{
      id: 'legacy',
      modelMatch: ['gemini'],
      stripLines: [],
      scope: { system: true, toolDescriptions: true, toolNames: false, memoryReminders: true, paths: true },
    }],
  }
  const rule = normalizeConfig(legacy).rules[0]
  assert.equal(rule.skillToolName, 'skill')
  assert.deepEqual(rule.nameMap, DEFAULT_NAME_MAP)

  const compiled = compileRule(rule, 0)
  assert.equal(compiled.names.size, 16)
  // The profile's explicit choice is not overwritten by hydration.
  assert.equal(compiled.scope.toolNames, false)
  assert.equal(compiled.scope.skillCatalog, true)
})

test('an explicitly empty nameMap still disables renaming', async () => {
  const { compileRule } = await import('../lib/rule.js')
  const rule = normalizeConfig({ rules: [{ id: 'quiet', modelMatch: ['gemini'], nameMap: {} }] }).rules[0]
  assert.deepEqual(rule.nameMap, {})
  assert.equal(compileRule(rule, 0).names.size, 0)
})

test('a partial nameMap is kept as authored instead of merged', async () => {
  const { compileRule } = await import('../lib/rule.js')
  const authored = { tools: { ops_bash: 'run_bash' } }
  const rule = normalizeConfig({ rules: [{ id: 'partial', modelMatch: ['gemini'], nameMap: authored }] }).rules[0]
  assert.deepEqual(rule.nameMap, authored)
  assert.equal(compileRule(rule, 0).names.size, 1)
})

test('default rules carry the additive defaults untouched', () => {
  const rule = normalizeConfig({}).rules[0]
  assert.deepEqual(rule.nameMap, DEFAULT_NAME_MAP)
  assert.equal(rule.skillToolName, 'skill')
})