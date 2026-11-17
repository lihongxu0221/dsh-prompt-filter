#!/usr/bin/env node
/** Lightweight "build": syntax-check every shipped module and verify versions. */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const files = ['index.js', 'client.js', ...fs.readdirSync(path.join(root, 'lib')).map((f) => path.join('lib', f))]
for (const file of files) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' })
}
execFileSync(process.execPath, [path.join(root, 'scripts/check-version.mjs')], { stdio: 'inherit' })
console.log(`build ok: ${files.length} files`)
