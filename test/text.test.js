import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_RULES } from '../lib/config.js'
import { compileRule } from '../lib/rule.js'
import { applyTextRules } from '../lib/text.js'
import { SYSTEM_PROMPT, forbiddenHits } from './fixture.js'

const rule = compileRule(FALLBACK_RULES[0], 0)

test('default rule removes identity lines, paragraphs, and brand tokens', () => {
  const { text, hits } = applyTextRules(SYSTEM_PROMPT, rule)
  assert.ok(hits.strip >= 4)
  assert.ok(hits.replace >= 2)
  assert.equal(hits.identity, true)
  assert.deepEqual(forbiddenHits(text), [])
  assert.ok(text.startsWith('You are a helpful coding assistant.'))
})

test('paragraph removal takes the whole blank-line-delimited block', () => {
  const { text } = applyTextRules(SYSTEM_PROMPT, rule)
  assert.ok(!text.includes('The browser provides no implicit DOM'))
  assert.ok(!text.includes('The apps/web Vite entry'))
  assert.ok(!text.includes('Use this checkout only to inspect or extend'))
})

test('functional runtime context lines stay, paths get neutralized', () => {
  const { text } = applyTextRules(SYSTEM_PROMPT, rule)
  assert.ok(text.includes('Current working directory:'))
  assert.ok(text.includes('Current working directory:'))
  assert.ok(!/dsh/i.test(text))
  assert.ok(!text.toLowerCase().includes('web gui'))
})

test('brand replacements apply to leftover functional text', () => {
  const custom = compileRule({
    modelMatch: ['gemini'],
    stripLines: [],
    replace: [
      { from: 'dsh web', to: 'the app' },
      { from: 'window.__DSH_BOOT__', to: 'the app boot payload' },
    ],
  }, 0)
  const { text } = applyTextRules('Only the app server injects window.__DSH_BOOT__; use dsh web.', custom, { identity: false })
  assert.equal(text, 'Only the app server injects the app boot payload; use the app.')
})

test('disabled path scope keeps quoted paths untouched', () => {
  const scoped = compileRule({ ...FALLBACK_RULES[0], scope: { ...FALLBACK_RULES[0].scope, paths: false } }, 0)
  const source = `${SYSTEM_PROMPT}\nSession path: "D:\\repos\\dsh-windows".`
  const { text } = applyTextRules(source, scoped)
  assert.ok(text.includes('D:\\repos\\dsh-windows'))
  assert.ok(/\bdsh\b/.test(text))
})

test('literal and raw-regex patterns both compile', () => {
  const custom = compileRule({
    modelMatch: ['gemini'],
    stripLines: ['/^You are an AI agent.*$/'],
    replace: [{ from: 'DeepSeek Harness', to: 'the agent' }],
  }, 0)
  const { text } = applyTextRules('You are an AI agent powered by DeepSeek Harness.\nKeep me.', custom)
  assert.ok(!text.includes('You are an AI agent'))
  assert.ok(!text.includes('DeepSeek Harness'))
  assert.ok(text.includes('Keep me'))
})

test('a no-op rule leaves the text identical and adds no identity line', () => {
  const custom = compileRule({ modelMatch: ['gemini'], stripLines: [], replace: [] }, 0)
  const source = 'plain system prompt with no brand'
  const { text, hits } = applyTextRules(source, custom)
  assert.equal(text, source)
  assert.equal(hits.identity, false)
})

test('invalid regex is reported at compile time', () => {
  assert.throws(() => compileRule({
    modelMatch: ['gemini'],
    replace: [{ from: '/(unclosed/', to: 'x', regex: true }],
  }, 0), /Invalid regular expression|pattern/)
})

test('identity sentence is not duplicated when already present', () => {
  const custom = compileRule({
    ...FALLBACK_RULES[0],
    identityOverride: 'You are a helpful coding assistant.',
  }, 0)
  const source = 'You are a helpful coding assistant.\nYou are an AI agent powered by DeepSeek Harness.'
  const { text } = applyTextRules(source, custom)
  assert.equal(text.match(/You are a helpful coding assistant\./g)?.length, 1)
})