#!/usr/bin/env node
/**
 * Audit a trace written by dsh-prompt-filter (debug/dryRun) for identity
 * tokens that must never reach gemini/claude requests.
 *
 * Usage: node scripts/audit-trace.mjs <trace.json> [...]
 * Exit:  0 = clean, 1 = token found, 2 = usage/parse error.
 *
 * Note: `dsh` is checked as a whole token (no adjacent ASCII letters/digits),
 * which mirrors what the upstream gateway actually rejects. Substrings such as
 * `spreadsheets` and the documented `webkit.messageHandlers.dshui` example in
 * the ui_present tool description are not identity tokens and are ignored.
 */

import { readFileSync } from 'node:fs'

const TOKENS = [
  { token: 'deepseek harness' },
  { token: 'dsh', wordDelimited: true },
  { token: '__dsh_boot__' },
  { token: 'deepseek-tools' },
  { token: 'deepseek-official' },
  { token: 'billion-context' },
]

function occurrences(text, token, wordDelimited) {
  const found = []
  if (!wordDelimited) {
    const haystack = text.toLowerCase()
    let index = haystack.indexOf(token)
    while (index !== -1) {
      found.push(index)
      index = haystack.indexOf(token, index + 1)
    }
    return found
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gi')
  for (const match of text.matchAll(pattern)) found.push(match.index)
  return found
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/audit-trace.mjs <trace.json> [...]')
  process.exit(2)
}

let failed = false

for (const file of files) {
  let trace
  try {
    trace = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`${file}: cannot read trace (${error.message})`)
    failed = true
    continue
  }

  const fields = [{ name: 'systemInstruction', text: String(trace.systemInstruction ?? '') }]
  if (Array.isArray(trace.reminderTexts)) {
    for (const [index, text] of trace.reminderTexts.entries()) {
      fields.push({ name: `reminderTexts[${index}]`, text: String(text ?? '') })
    }
  }
  for (const tool of Array.isArray(trace.toolSchemas) ? trace.toolSchemas : []) {
    fields.push({ name: `tool:${tool?.name ?? ''}`, text: String(tool?.description ?? '') })
  }

  const problems = []
  for (const field of fields) {
    for (const { token, wordDelimited } of TOKENS) {
      for (const index of occurrences(field.text, token, wordDelimited)) {
        problems.push(`${field.name} contains "${token}" at offset ${index}`)
      }
    }
  }

  const chars = fields.reduce((total, field) => total + field.text.length, 0)
  console.log(`${file}: ${fields.length} field(s), ${chars} chars`)

  if (problems.length === 0) {
    console.log('  OK: no forbidden identity tokens')
  } else {
    failed = true
    for (const problem of problems) console.log(`  FAIL: ${problem}`)
  }
}

process.exit(failed ? 1 : 0)