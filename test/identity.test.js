import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Package, bundle, and icon identity.
 *
 * DSH `readPluginMeta` (packages/boot/app-boot/src/package-meta.ts, present on
 * dsh-v0.2.2-rc.5 and on default-branch 4b399c39) imports the Cordis row
 * `name`, then checks that the nearest package.json name equals
 * `barePackageName(specifier)`. These tests lock that contract for this
 * package. They do not replace or relax the host check.
 */

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = '@deepseek-ai/dsh-prompt-filter'
const ROW_ID = 'dsh-prompt-filter'
const MAX_ICON_BYTES = 256 * 1024

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Package name of a specifier, without a subpath. Scoped names keep both segments. */
function barePackageName(request) {
  if (!request || request[0] === '.' || request[0] === '/' || request[0] === '\\'
    || request[0] === '#' || request.includes(':')) return undefined
  const first = request.indexOf('/')
  if (request[0] !== '@') return first < 0 ? request : request.slice(0, first)
  if (first < 0) return undefined
  const second = request.indexOf('/', first + 1)
  return second < 0 ? request : request.slice(0, second)
}

/** First insert row of the shipped bundle patch. `config` ends the row header. */
function shippedBundleRow(text) {
  let inInsert = false
  let row
  for (const line of text.split(/\r?\n/)) {
    if (/^- insert:\s*$/.test(line)) {
      inInsert = true
      continue
    }
    if (!inInsert) continue
    if (/^ {4}- id: \S+/.test(line)) {
      row = { id: line.slice(line.indexOf(':') + 1).trim() }
      continue
    }
    if (row && /^ {6}name: \S+/.test(line)) {
      row.name = line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '')
    }
    if (row && /^ {6}config:\s*$/.test(line)) break
  }
  return row
}

/**
 * Same ownership rule as DSH `assertPackageOwned`: an ancestor package.json
 * must name the import's package. A mismatch walks to the filesystem root
 * and fails, which is the icon rejection seen with a bare alias.
 */
function assertPackageOwned(file, name) {
  const real = realpathSync(file)
  for (let directory = dirname(real); ; directory = dirname(directory)) {
    const manifest = join(directory, 'package.json')
    try {
      if (readJson(manifest).name === name) return manifest
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (dirname(directory) === directory) {
      throw new Error(`${real}: icon must remain inside its package directory`)
    }
  }
}

function materializePackage(target) {
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'package.json'), readFileSync(join(root, 'package.json')))
  writeFileSync(join(target, 'icon.svg'), readFileSync(join(root, 'icon.svg')))
}

function profileWithPackages(specifiers) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prompt-filter-identity-'))
  const parent = join(dir, 'profile')
  mkdirSync(join(parent, 'node_modules'), { recursive: true })
  writeFileSync(join(parent, 'package.json'), JSON.stringify({ name: 'profile-fixture', type: 'module' }))
  writeFileSync(join(parent, 'probe.mjs'), `
const specifier = process.argv[2]
try {
  console.log(JSON.stringify({ ok: true, url: import.meta.resolve(specifier) }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, code: error.code }))
}
`)
  for (const specifier of specifiers) {
    // Each specifier gets its own directory and its own copy of the manifest.
    materializePackage(join(parent, 'node_modules', specifier))
  }
  return { dir, parent }
}

/** Resolve through Node's ESM resolver from the fixture, not from this package. */
function resolveFrom(parent, specifier) {
  const output = execFileSync(process.execPath, [join(parent, 'probe.mjs'), specifier], { encoding: 'utf8' })
  return JSON.parse(output)
}

test('the shipped bundle registers the scoped package name and keeps the row id', () => {
  const pkg = readJson(join(root, 'package.json'))
  assert.equal(pkg.name, PACKAGE_NAME)
  assert.equal(pkg.icon, undefined)
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.equal(pkg.exports['./package.json'], './package.json')

  const row = shippedBundleRow(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
  assert.equal(row.id, ROW_ID)
  assert.equal(row.name, pkg.name)
  assert.equal(barePackageName(row.name), pkg.name)
  assert.notEqual(barePackageName(ROW_ID), pkg.name)

  const index = readFileSync(join(root, 'index.js'), 'utf8')
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  assert.match(index, /export const name = 'dsh-prompt-filter'/)
  assert.match(client, /id: '@deepseek-ai\/dsh-prompt-filter'/)
})

test('install examples name the scoped package and do not add a bare alias', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const profile = readFileSync(join(root, 'examples/profile.yml'), 'utf8')
  const override = readFileSync(join(root, 'examples/cordis.patch.yml'), 'utf8')

  assert.match(readme, /dsh plugin --profile desktop add @deepseek-ai\/dsh-prompt-filter/)
  assert.match(readme, /pnpm remove dsh-prompt-filter/)
  assert.match(readme, /pnpm add @deepseek-ai\/dsh-prompt-filter@github:lihongxu0221\/dsh-prompt-filter#<commit>/)
  assert.doesNotMatch(readme, /dsh plugin --profile desktop add dsh-prompt-filter\b/)
  assert.match(readme, /不要添加裸包名 `dsh-prompt-filter` 依赖别名/)

  assert.match(profile, /name: '@deepseek-ai\/dsh-prompt-filter'/)
  assert.match(profile, /dsh plugin --profile desktop add @deepseek-ai\/dsh-prompt-filter/)
  assert.doesNotMatch(profile, /dsh plugin --profile desktop add dsh-prompt-filter\b/)
  assert.match(profile, /id: dsh-prompt-filter/)

  assert.match(override, /name: '@deepseek-ai\/dsh-prompt-filter'/)
  assert.doesNotMatch(override, /^\s*name:/m)
  assert.match(override, /^- id: dsh-prompt-filter$/m)
})

test('the icon export stays inside the package that owns the bundle specifier', () => {
  const pkg = readJson(join(root, 'package.json'))
  const iconPath = realpathSync(join(root, pkg.exports['./icon']))
  const local = relative(realpathSync(root), iconPath)
  assert.notEqual(local, '..')
  assert.equal(local.startsWith(`..${sep}`), false)
  const stat = statSync(iconPath)
  assert.equal(stat.isFile(), true)
  assert.ok(stat.size > 0 && stat.size <= MAX_ICON_BYTES)
  assert.match(readFileSync(iconPath, 'utf8'), /^<svg[\s>]/)

  const manifest = assertPackageOwned(iconPath, PACKAGE_NAME)
  assert.equal(readJson(manifest).name, PACKAGE_NAME)
  assert.throws(
    () => assertPackageOwned(iconPath, ROW_ID),
    /icon must remain inside its package directory/,
  )
})

test('Node resolves the scoped icon and package entries, and a bare alias does not own the icon', () => {
  const fixture = profileWithPackages([PACKAGE_NAME, ROW_ID])
  try {
    const scopedIconResult = resolveFrom(fixture.parent, `${PACKAGE_NAME}/icon`)
    assert.equal(scopedIconResult.ok, true)
    const scopedIcon = fileURLToPath(scopedIconResult.url)
    const scopedManifest = assertPackageOwned(scopedIcon, barePackageName(PACKAGE_NAME))
    assert.equal(realpathSync(dirname(scopedManifest)), realpathSync(join(fixture.parent, 'node_modules', PACKAGE_NAME)))
    assert.equal(readJson(scopedManifest).name, PACKAGE_NAME)
    assert.equal(relative(realpathSync(dirname(scopedManifest)), realpathSync(scopedIcon)), 'icon.svg')

    const scopedPackage = resolveFrom(fixture.parent, `${PACKAGE_NAME}/package.json`)
    assert.equal(scopedPackage.ok, true)
    assert.equal(readJson(fileURLToPath(scopedPackage.url)).name, PACKAGE_NAME)

    const bareIconResult = resolveFrom(fixture.parent, `${ROW_ID}/icon`)
    assert.equal(bareIconResult.ok, true)
    const bareIcon = fileURLToPath(bareIconResult.url)
    assert.notEqual(realpathSync(bareIcon), realpathSync(scopedIcon))
    assert.equal(readJson(assertPackageOwned(bareIcon, PACKAGE_NAME)).name, PACKAGE_NAME)
    assert.throws(
      () => assertPackageOwned(bareIcon, barePackageName(ROW_ID)),
      /icon must remain inside its package directory/,
    )
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})

test('a scoped install does not resolve the bare package specifier', () => {
  const fixture = profileWithPackages([PACKAGE_NAME])
  try {
    const scopedPackage = resolveFrom(fixture.parent, `${PACKAGE_NAME}/package.json`)
    assert.equal(scopedPackage.ok, true)
    assert.equal(readJson(fileURLToPath(scopedPackage.url)).name, PACKAGE_NAME)
    assert.deepEqual(resolveFrom(fixture.parent, ROW_ID), { ok: false, code: 'ERR_MODULE_NOT_FOUND' })
    assert.deepEqual(resolveFrom(fixture.parent, `${ROW_ID}/icon`), { ok: false, code: 'ERR_MODULE_NOT_FOUND' })
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true })
  }
})
