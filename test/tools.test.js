import assert from 'node:assert/strict'
import test from 'node:test'

import { FALLBACK_RULES } from '../lib/config.js'
import { compileRule } from '../lib/rule.js'
import { filterTools, toolNameResolver } from '../lib/tools.js'
import { TOOLS, forbiddenHits } from './fixture.js'

const rule = compileRule(FALLBACK_RULES[0], 0)

test('tool descriptions lose brand tokens but keep the rest of the text', () => {
  const result = filterTools(TOOLS, rule)
  assert.equal(result.changed, true)
  assert.equal(result.count, 3)
  assert.equal(result.descriptionsChanged, 3)
  for (const tool of result.tools) {
    assert.deepEqual(forbiddenHits(tool.description), [], `${tool.name}: ${tool.description}`)
  }
  assert.ok(result.tools[0].description.includes('session cwd'))
  assert.ok(result.tools[2].description.includes('APP version'))
})

test('parameters keep enum values and rewrite only descriptions', () => {
  const result = filterTools(TOOLS, rule)
  const engine = result.tools[0].parameters.properties.engine
  assert.deepEqual(engine.enum, ['deepseek-tools', 'deepseek-official', 'bing'])
  assert.ok(!engine.description.includes('deepseek-tools'))
  assert.ok(!engine.description.includes('deepseek-official'))
  assert.deepEqual(result.tools[0].parameters.required, ['command'])
})

test('default nameMap renames known tools outbound', () => {
  const result = filterTools(TOOLS, rule)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['run_bash', 'context_status', 'plugin_registry'])
  assert.equal(result.namesChanged, 3)
  assert.equal(result.nameMap.get('ops_bash'), 'run_bash')
  assert.equal(result.nameMap.get('acp_status'), 'context_status')
})

test('scope.toolNames renames schemas through nameMap', () => {
  const renamed = compileRule({
    modelMatch: ['gemini'],
    stripLines: [],
    replace: [],
    nameMap: { tools: { ops_bash: 'shell_exec' } },
  }, 0)
  const result = filterTools(TOOLS, renamed)
  assert.equal(result.namesChanged, 1)
  assert.equal(result.nameMap.get('ops_bash'), 'shell_exec')
  assert.ok(result.tools.some((tool) => tool.name === 'shell_exec'))
})

test('tool renames never collide with an existing tool name', () => {
  const renamed = compileRule({
    modelMatch: ['gemini'],
    stripLines: [],
    replace: [],
    nameMap: { tools: { alpha_dsh: 'beta_tool' } },
  }, 0)
  const tools = [
    { name: 'alpha_dsh', description: 'a', parameters: {} },
    { name: 'beta_tool', description: 'existing', parameters: {} },
  ]
  const result = filterTools(tools, renamed)
  assert.deepEqual(result.tools.map((tool) => tool.name), ['alpha_dsh', 'beta_tool'])
  assert.equal(result.nameMap.size, 0)
})

test('unfiltered tool arrays return unchanged', () => {
  const plain = { modelMatch: ['gemini'], stripLines: [], replace: [] }
  const result = filterTools(TOOLS, compileRule(plain, 0))
  assert.equal(result.changed, false)
  assert.equal(result.tools, TOOLS)
})
test('history-only renames do not shadow a declared tool name', () => {
  const mapped = compileRule(FALLBACK_RULES[0], 0)
  const declared = filterTools([{ name: 'run_bash', description: 'existing', parameters: {} }], mapped)
  const resolve = toolNameResolver(mapped, declared.nameMap, declared.declared)
  assert.equal(resolve('ops_bash'), 'ops_bash')
  assert.equal(resolve('ops_grep'), 'search_text')
})
