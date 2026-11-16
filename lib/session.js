/** Session helpers: subagent detection via the session header. */

export function headerFor(agents, sessionId) {
  if (sessionId === undefined || sessionId === null) return undefined
  if (agents === undefined || agents === null || typeof agents.get !== 'function') return undefined
  try {
    return agents.get(sessionId)?.session?.header
  } catch {
    return undefined
  }
}

export function isSubagentHeader(header) {
  if (header === null || typeof header !== 'object') return false
  return header.origin === 'subagent' || (typeof header.delegationDepth === 'number' && header.delegationDepth > 0)
}