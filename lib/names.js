/**
 * Explicit outbound rename map with a mandatory inbound inverse.
 *
 * Two independent sets are supported:
 *   - `tools`: tool names (the model calls them, DSH executes them)
 *   - `skills`: skill ids (the model passes them to the `skill` tool)
 *
 * Rules:
 *   - the outbound name must not contain dsh / acp / harness (case-insensitive)
 *   - keys and values are unique in both directions (never two keys -> one value)
 *   - the map is static, so it is stable for every turn and every session
 *
 * Everything here is data; nothing is written back to `replace`, so the two
 * halves stay independent and removable one entry at a time.
 */

import { escapeRegExp } from './pattern.js'

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,64}$/
const BRAND = /(dsh|acp|harness)/i

function collect(part, key, where, problems) {
  const map = new Map()
  if (part === undefined || part === null) return map
  if (typeof part !== 'object' || Array.isArray(part)) {
    problems.push(`${where}.${key} must be a mapping of source -> neutral name`)
    return map
  }
  const seen = new Map()
  for (const [from, to] of Object.entries(part)) {
    const source = String(from).trim()
    if (source === '') {
      problems.push(`${where}.${key}: empty source name`)
      continue
    }
    if (!SAFE_NAME.test(source)) {
      problems.push(`${where}.${key}: source "${source}" must match ${SAFE_NAME}`)
      continue
    }
    if (typeof to !== 'string' || to.trim() === '') {
      problems.push(`${where}.${key}.${source} must map to a non-empty string`)
      continue
    }
    const target = to.trim()
    if (!SAFE_NAME.test(target)) {
      problems.push(`${where}.${key}.${source}: target "${target}" must match ${SAFE_NAME}`)
      continue
    }
    if (BRAND.test(target)) {
      problems.push(`${where}.${key}.${source}: target "${target}" must not contain dsh, acp, or harness`)
      continue
    }
    if (target === source) {
      problems.push(`${where}.${key}.${source}: target equals the source name`)
      continue
    }
    if (seen.has(target)) {
      problems.push(`${where}.${key}: "${seen.get(target)}" and "${source}" both map to "${target}"`)
      continue
    }
    seen.set(target, source)
    map.set(source, target)
  }
  return map
}

/** Compile `rule.nameMap` into forward and reverse maps plus a text renamer. */
export function compileNameMap(raw, where, problems) {
  const tools = new Map()
  const skills = new Map()
  if (raw === undefined || raw === null) {
    return finalize(tools, skills)
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`${where} must be a { tools, skills } mapping`)
    return finalize(tools, skills)
  }
  for (const key of Object.keys(raw)) {
    if (key !== 'tools' && key !== 'skills') {
      problems.push(`${where}.${key} is not a supported name-map section (use tools or skills)`)
    }
  }
  for (const [source, target] of collect(raw.tools, 'tools', where, problems)) tools.set(source, target)
  for (const [source, target] of collect(raw.skills, 'skills', where, problems)) skills.set(source, target)
  return finalize(tools, skills)
}

function finalize(tools, skills) {
  const reverseTools = new Map()
  for (const [from, to] of tools) reverseTools.set(to, from)
  const reverseSkills = new Map()
  for (const [from, to] of skills) reverseSkills.set(to, from)
  const all = [...tools.entries(), ...skills.entries()]
  const lookup = new Map(all)
  let renameText = (text) => text
  if (all.length > 0) {
    const alternation = all
      .map(([from]) => from)
      .sort((a, b) => b.length - a.length)
      .map((from) => escapeRegExp(from))
      .join('|')
    const pattern = new RegExp(`(?<![A-Za-z0-9_])(${alternation})(?![A-Za-z0-9_])`, 'g')
    renameText = (text) => (typeof text === 'string' ? text.replace(pattern, (hit) => lookup.get(hit) ?? hit) : text)
  }
  return {
    tools,
    skills,
    reverseTools,
    reverseSkills,
    size: all.length,
    /** Replace whole-token source names in model-facing prose. */
    renameText,
    /** Reverse of `renameText`, used on inbound text that must be restored. */
    restoreText: inverseText(tools, skills),
  }
}

function inverseText(tools, skills) {
  const all = [...tools.entries(), ...skills.entries()]
  const reverse = new Map(all.map(([from, to]) => [to, from]))
  if (all.length === 0) return (text) => text
  const alternation = all
    .map(([, to]) => to)
    .sort((a, b) => b.length - a.length)
    .map((to) => escapeRegExp(to))
    .join('|')
  const pattern = new RegExp(`(?<![A-Za-z0-9_])(${alternation})(?![A-Za-z0-9_])`, 'g')
  return (text) => (typeof text === 'string' ? text.replace(pattern, (hit) => reverse.get(hit) ?? hit) : text)
}

/** Rename a tool name on the way out; returns the same string when unmapped. */
export function outboundToolName(names, name) {
  return names.tools.get(name) ?? name
}

/** Rename a skill id on the way out; returns the same string when unmapped. */
export function outboundSkillName(names, name) {
  return names.skills.get(name) ?? name
}
