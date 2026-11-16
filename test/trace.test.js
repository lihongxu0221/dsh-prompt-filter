import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { dryRunStream, traceDirOf, writeTrace } from '../lib/trace.js'

test('dry-run ends the turn with a non-retryable finish instead of sending', async () => {
  const report = { ruleId: 'r', provider: 'magpie', model: 'm', system: { charsBefore: 1, charsAfter: 1 }, tools: { count: 0 }, hits: { strip: 0, replace: 0, identity: 0 } }
  const chunks = []
  for await (const chunk of dryRunStream(report)) chunks.push(chunk)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].type, 'finish')
  assert.equal(chunks[0].reason.kind, 'error')
  assert.equal(chunks[0].reason.failure.code, 'PROMPT_FILTER_DRY_RUN')
})

test('trace files are written and parse back with the filtered fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prompt-filter-'))
  try {
    const report = {
      at: '2026-11-16T00:00:00.000Z',
      provider: 'magpie',
      model: 'group/gemini-3.8-flash',
      ruleId: 'default-gemini-claude',
      systemInstruction: 'You are a helpful coding assistant.',
      toolSchemas: [{ name: 'ops_bash', description: 'Run a command in this session.' }],
      hits: { strip: 1, replace: 2, identity: 1 },
    }
    const file = writeTrace({ traceDir: dir }, report, { info() {}, warn() {} })
    assert.ok(file)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(parsed.ruleId, 'default-gemini-claude')
    assert.equal(parsed.toolSchemas[0].name, 'ops_bash')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('traceDirOf prefers config.traceDir and otherwise uses DSH_HOME', () => {
  assert.equal(traceDirOf({ traceDir: 'C:\\tmp\\traces' }), 'C:\\tmp\\traces')
  assert.ok(traceDirOf({ traceDir: '' }).includes('dsh-prompt-filter'))
})