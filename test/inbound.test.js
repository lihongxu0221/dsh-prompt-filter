import assert from 'node:assert/strict'
import test from 'node:test'

import { restoreStream } from '../lib/inbound.js'
import { compileRule } from '../lib/rule.js'

const rule = compileRule({
  modelMatch: ['gemini'],
  stripLines: [],
  replace: [],
  nameMap: {
    tools: { ops_bash: 'run_bash', skill: 'skill_runner' },
    skills: { 'dsh-badge': 'assistant-badge', 'dsh-doc': 'product-doc' },
  },
}, 0)

async function collect(chunks) {
  const out = []
  for await (const chunk of restoreStream(chunks, rule)) out.push(chunk)
  return out
}

test('tool names are restored in delta-only streams', async () => {
  const out = await collect([
    { type: 'tool-call-delta', index: 0, id: 'c1', name: 'run_bash', argumentsDelta: '{"command":' },
    { type: 'tool-call-delta', index: 0, argumentsDelta: '"pwd"}' },
    { type: 'finish', reason: 'tool-calls' },
  ])
  assert.equal(out[0].name, 'ops_bash')
  assert.equal(out[1].name, undefined)
  assert.equal(out[1].argumentsDelta, '"pwd"}')
})

test('block-end restores the authoritative tool name and arguments', async () => {
  const out = await collect([
    { type: 'tool-call-delta', index: 0, id: 'c1', name: 'run_bash', argumentsDelta: '{"command":"pwd"}' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'c1', name: 'run_bash', arguments: '{"command":"pwd"}' },
    },
  ])
  const end = out.find((chunk) => chunk.type === 'block-end')
  assert.equal(end.block.name, 'ops_bash')
  assert.equal(end.block.arguments, '{"command":"pwd"}')
})

test('a split skill id is buffered and restored as one delta', async () => {
  const out = await collect([
    { type: 'tool-call-delta', index: 1, id: 'c2', name: 'skill_runner', argumentsDelta: '{"name":"assistant-' },
    { type: 'tool-call-delta', index: 1, argumentsDelta: 'badge"}' },
    { type: 'finish', reason: 'tool-calls' },
  ])
  const deltas = out.filter((chunk) => chunk.type === 'tool-call-delta')
  assert.equal(deltas.length, 1, 'the skill arguments must be emitted once')
  assert.equal(deltas[0].name, 'skill')
  assert.equal(deltas[0].argumentsDelta, '{"name":"dsh-badge"}')
  assert.ok(!JSON.stringify(out).includes('assistant-badge'), 'neutral skill id must never reach DSH')
})

test('skill ids inside block-end arguments are restored', async () => {
  const out = await collect([
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'c3', name: 'skill_runner', arguments: '{"name":"product-doc"}' },
    },
    { type: 'finish', reason: 'tool-calls' },
  ])
  const end = out.find((chunk) => chunk.type === 'block-end')
  assert.equal(end.block.name, 'skill')
  assert.equal(JSON.parse(end.block.arguments).name, 'dsh-doc')
})

test('unmapped names and other chunks pass through untouched', async () => {
  const chunks = [
    { type: 'text-delta', index: 0, text: 'hello' },
    { type: 'usage', inputTokens: 1, outputTokens: 2 },
    { type: 'future-plugin-chunk', payload: { keep: true } },
    { type: 'tool-call-delta', index: 0, id: 'c4', name: 'free_search', argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'c4', name: 'free_search', arguments: '{}' } },
    { type: 'finish', reason: { kind: 'stop' }, replayState: { token: 'r1' } },
  ]
  const out = await collect(chunks)
  assert.equal(out[0], chunks[0])
  assert.equal(out[1], chunks[1])
  assert.equal(out[2], chunks[2])
  assert.equal(out[2].payload.keep, true)
  assert.equal(out[3], chunks[3])
  assert.deepEqual(out[4], chunks[4])
  assert.deepEqual(out[5], chunks[5])
})
