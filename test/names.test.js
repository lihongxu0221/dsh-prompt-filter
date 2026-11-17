import assert from 'node:assert/strict'
import test from 'node:test'

import { compileNameMap } from '../lib/names.js'
import { compileRule } from '../lib/rule.js'

function problemsOf(raw) {
  const problems = []
  compileNameMap(raw, 'rules[0].nameMap', problems)
  return problems
}

test('a well-formed map compiles both directions', () => {
  const problems = []
  const names = compileNameMap({
    tools: { ops_bash: 'run_bash', acp_cache: 'cache_reconcile' },
    skills: { 'dsh-badge': 'assistant-badge' },
  }, 'rules[0].nameMap', problems)
  assert.deepEqual(problems, [])
  assert.equal(names.size, 3)
  assert.equal(names.tools.get('ops_bash'), 'run_bash')
  assert.equal(names.reverseTools.get('run_bash'), 'ops_bash')
  assert.equal(names.skills.get('dsh-badge'), 'assistant-badge')
  assert.equal(names.reverseSkills.get('assistant-badge'), 'dsh-badge')
})

test('brand names are rejected on the neutral side', () => {
  const problems = problemsOf({ tools: { ops_bash: 'dsh_bash' } })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /must not contain dsh, acp, or harness/)

  const acp = problemsOf({ skills: { 'dsh-doc': 'acp-doc' } })
  assert.equal(acp.length, 1)
  assert.match(acp[0], /must not contain/)
})

test('one-to-one mapping is enforced', () => {
  const problems = problemsOf({ tools: { ops_bash: 'run_bash', ops_grep: 'run_bash' } })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /both map to "run_bash"/)
})

test('equal, empty and malformed names are rejected', () => {
  assert.match(problemsOf({ tools: { ops_bash: 'ops_bash' } })[0], /target equals the source/)
  assert.match(problemsOf({ tools: { '': 'run_bash' } })[0], /empty source/)
  assert.match(problemsOf({ tools: { 'ops bash': 'run_bash' } })[0], /must match/)
  assert.match(problemsOf({ tools: [] })[0], /must be a mapping/)
  assert.match(problemsOf({ other: {} })[0], /not a supported name-map section/)
})

test('renameText replaces whole tokens only, longest name first', () => {
  const problems = []
  const names = compileNameMap({
    tools: { ops_bash: 'run_bash', ops_bash_long: 'run_bash_long' },
    skills: { 'dsh-doc': 'product-doc' },
  }, 'rules[0].nameMap', problems)
  assert.deepEqual(problems, [])
  assert.equal(names.renameText('use ops_bash then ops_bash_long'), 'use run_bash then run_bash_long')
  assert.equal(names.renameText('ops_bashx stays'), 'ops_bashx stays')
  assert.equal(names.renameText('see dsh-doc'), 'see product-doc')
  assert.equal(names.restoreText('see product-doc and run_bash'), 'see dsh-doc and ops_bash')
})

test('compileRule surfaces nameMap problems and warns on old replace-based renames', () => {
  assert.throws(() => compileRule({
    modelMatch: ['gemini'],
    stripLines: [],
    replace: [{ from: 'ops_bash', to: 'run_bash' }],
    nameMap: { tools: { ops_bash: 'run_bash' } },
  }, 0), /ops_bash/)
})
