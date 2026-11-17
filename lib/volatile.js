/**
 * Volatile config references.
 *
 * A schema field marked `.volatile()` arrives as a stable reference whose
 * value the loader commits in place; `apply` is not restarted. The plugin
 * therefore unwraps references before normalizing, and rebuilds its compiled
 * rules when `loader/volatile-update` fires.
 *
 * Identification uses the shared protocol symbol rather than an import, so
 * the plugin keeps no runtime dependency on cosmokit (and the same check
 * works across ESM/CJS copies of the library).
 */

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Whether `value` is a volatile config reference. */
export function isVolatileRef(value) {
  return typeof value === 'object' && value !== null && VOLATILE_WRITE in value
}

/**
 * Recursively replace volatile references with their current plain values.
 *
 * Arrays and plain objects are walked; everything else is returned as-is.
 */
export function plain(value, seen = new Set()) {
  if (isVolatileRef(value)) return plain(value.get(), seen)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return value
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => plain(item, seen))
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = plain(item, seen)
    return out
  } finally {
    seen.delete(value)
  }
}