/**
 * Inbound restoration on the model response stream.
 *
 * The outbound request renames tool names and skill ids to neutral names. The
 * model therefore answers with neutral names, and DSH must see the original
 * ones again before it parses and executes the call. `llm/stream` returns an
 * `AsyncIterable<StreamChunk>`, so this module wraps that stream and rewrites:
 *
 *   - `tool-call-delta.name`
 *   - the authoritative `block-end` tool-call block (`name` and `arguments`)
 *
 * Skill ids travel inside the `skill` tool's `arguments` JSON. Tool arguments
 * are withheld per call index until the block closes (or the stream finishes),
 * then emitted as one restored delta, so a split `argumentsDelta` can never
 * leak a neutral skill id into the assembled block.
 */

function restoreJsonArguments(json, reverseSkills) {
  if (typeof json !== 'string' || json === '' || reverseSkills.size === 0) return json
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    return json
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return json
  const current = parsed.name
  if (typeof current !== 'string') return json
  const restored = reverseSkills.get(current)
  if (restored === undefined || restored === current) return json
  return JSON.stringify({ ...parsed, name: restored })
}

/** Wrapper stream that restores every renamed tool call and skill id. */
export async function* restoreStream(stream, rule) {
  const names = rule.names
  const reverseTools = names?.reverseTools ?? new Map()
  const reverseSkills = names?.reverseSkills ?? new Map()
  const skillTool = rule.skillToolName ?? 'skill'
  const pending = new Map()
  const activeSkills = new Map()

  const flush = (index) => {
    const state = pending.get(index)
    if (state === undefined) return undefined
    pending.delete(index)
    return {
      type: 'tool-call-delta',
      index,
      id: state.id,
      name: state.name,
      argumentsDelta: restoreJsonArguments(state.buffer, reverseSkills),
    }
  }

  for await (const chunk of stream) {
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'tool-call-delta') {
      const known = activeSkills.get(chunk.index)
      const realName = chunk.name === undefined
        ? (known?.name)
        : (reverseTools.get(chunk.name) ?? chunk.name)
      if (realName === skillTool) {
        const state = pending.get(chunk.index) ?? { id: chunk.id, name: realName, buffer: '' }
        state.id = chunk.id ?? state.id
        state.buffer += chunk.argumentsDelta ?? ''
        pending.set(chunk.index, state)
        activeSkills.set(chunk.index, { name: realName })
        continue
      }
      if (chunk.name !== undefined) activeSkills.delete(chunk.index)
      yield realName !== undefined && realName !== chunk.name ? { ...chunk, name: realName } : chunk
      continue
    }

    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'block-end' && chunk.block?.type === 'tool-call') {
      const block = chunk.block
      const realName = reverseTools.get(block.name) ?? block.name
      const argumentsText = realName === skillTool
        ? restoreJsonArguments(block.arguments, reverseSkills)
        : block.arguments
      activeSkills.delete(chunk.index)
      if (pending.has(chunk.index)) {
        const state = pending.get(chunk.index)
        state.name = realName
        const delta = flush(chunk.index)
        if (delta !== undefined) yield delta
      }
      yield { ...chunk, block: { ...block, name: realName, arguments: argumentsText } }
      continue
    }

    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'finish') {
      for (const index of [...pending.keys()]) {
        const delta = flush(index)
        if (delta !== undefined) yield delta
      }
      activeSkills.clear()
      yield chunk
      continue
    }

    yield chunk
  }

  for (const index of [...pending.keys()]) {
    const delta = flush(index)
    if (delta !== undefined) yield delta
  }
}
