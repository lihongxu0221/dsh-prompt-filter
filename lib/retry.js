/**
 * Retry protection.
 *
 * `llm/stream` records the provider/model seen for each session, because the
 * `agent/request-error` payload carries the agent, provider, and failure but
 * not the model. The veto listener then looks the session up and suppresses
 * retries whose failure matches that rule's `noRetryOn` patterns. When the
 * current runtime supplies `payload.provider`, it must agree with the cached
 * request so a stale session entry cannot veto a different provider's retry.
 */

const MAX_SESSIONS = 1000
const sessionModels = new Map()

export function recordModel(sessionId, provider, model) {
  if (sessionId === undefined || sessionId === null) return
  const key = String(sessionId)
  if (!sessionModels.has(key) && sessionModels.size >= MAX_SESSIONS) {
    const oldest = sessionModels.keys().next().value
    if (oldest !== undefined) sessionModels.delete(oldest)
  }
  sessionModels.set(key, { provider, model })
}

export function modelForSession(sessionId, provider) {
  if (sessionId === undefined || sessionId === null) return undefined
  const info = sessionModels.get(String(sessionId))
  if (info === undefined) return undefined
  if (provider !== undefined && provider !== null && info.provider !== provider) return undefined
  return info
}

/** Test hook: the map is process-wide and should not leak between cases. */
export function resetSessionModels() {
  sessionModels.clear()
}

/**
 * Case-insensitive substring match against the failure code, message, and
 * status. Patterns are plain substrings on purpose: users write phrases like
 * "Resource has been exhausted", not regexes.
 */
export function matchesNoRetry(patterns, failure) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false
  if (failure === null || typeof failure !== 'object') return false
  const haystack = [
    failure.code,
    failure.message,
    failure.status === undefined || failure.status === null ? '' : String(failure.status),
  ]
    .filter((value) => typeof value === 'string' && value !== '')
    .join('\n')
    .toLowerCase()
  if (haystack === '') return false
  return patterns.some((pattern) => haystack.includes(String(pattern).toLowerCase()))
}