#!/usr/bin/env node
/**
 * Verify that the three version sources agree:
 *   - package.json version
 *   - lib/version.js VERSION constant
 *   - the git tag passed as argv[2] or GITHUB_REF_NAME (vX.Y.Z)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const versionSource = fs.readFileSync(path.join(root, 'lib/version.js'), 'utf8')
const match = /VERSION\s*=\s*'([^']+)'/.exec(versionSource)
const constant = match?.[1]

const tag = (process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '').replace(/^v/, '')
const problems = []
if (!constant) problems.push('lib/version.js: VERSION constant not found')
if (constant && constant !== pkg.version) problems.push(`lib/version.js ${constant} !== package.json ${pkg.version}`)
if (tag && tag !== pkg.version) problems.push(`tag ${tag} !== package.json ${pkg.version}`)

console.log(`package.json=${pkg.version} lib/version.js=${constant ?? '?'} tag=${tag || '(none)'}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`version mismatch: ${problem}`)
  process.exit(1)
}
console.log('version check passed')
