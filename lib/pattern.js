/**
 * Pattern compilation shared by model matching, strip rules, and replace
 * rules.
 *
 * Accepted forms:
 *   - a literal string                  "DeepSeek Harness"
 *   - a raw regex literal string        "/^You are .*$/i"
 *   - an object { pattern, regex? }     { pattern: "^DSH_", regex: true }
 *
 * The plugin deliberately accepts config from YAML, where users cannot write
 * a RegExp object, so `/.../flags` is the only regex literal syntax.
 */

const RAW_REGEX = /^\/([\s\S]*)\/([a-z]*)$/

const ESCAPE = /[.*+?^${}()|[\]\\]/g

/** Escape a literal string so it can be used as a regex source. */
export function escapeRegExp(value) {
  return String(value).replace(ESCAPE, '\\$&')
}

/**
 * Compile one pattern spec into a RegExp.
 *
 * `global: true` is used for replacement (replace every occurrence); for
 * tests the flag is stripped so `RegExp#test` stays stateless.
 */
export function toRegExp(spec, options = {}) {
  const global = options.global === true
  let source
  let flags = ''

  if (spec !== null && typeof spec === 'object' && !(spec instanceof RegExp)) {
    if (typeof spec.pattern !== 'string' || spec.pattern === '') {
      throw new Error('pattern must be a non-empty string')
    }
    if (spec.regex === true) source = spec.pattern
    else source = escapeRegExp(spec.pattern)
  } else if (typeof spec === 'string' && spec !== '') {
    const raw = RAW_REGEX.exec(spec)
    if (raw !== null) {
      source = raw[1]
      flags = raw[2] ?? ''
    } else {
      source = escapeRegExp(spec)
    }
  } else {
    throw new Error('pattern must be a non-empty string')
  }

  // A stray `g` would make RegExp#test stateful across lines.
  const cleaned = flags.replace(/g/g, '')
  return new RegExp(source, global ? `${cleaned}g` : cleaned)
}
