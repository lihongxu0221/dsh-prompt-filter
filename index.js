/**
 * dsh-prompt-filter — strip DeepSeek Harness identity from requests sent to
 * selected models.
 *
 * Hook: the `llm/stream` waterfall runs immediately before the adapter builds
 * the provider request, after the system prompt, runtime context, memory
 * blocks, and tool schemas are assembled. `next()` takes no arguments, so the
 * only way to replace the request is to re-dispatch a mutable clone through
 * `llm.stream()`. The listener is prepended, so every other `llm/stream`
 * listener runs exactly once (on the inner dispatch) instead of twice.
 *
 * Retry: `agent/request-error` is also prepended, because `dsh-llm-retry`
 * decides to retry a RATE_LIMIT failure without consulting downstream
 * listeners; a downstream veto would never be asked.
 */

import { normalizeConfig } from './lib/config.js'
import { matchModel } from './lib/match.js'
import { buildFilteredRequest, formatReport } from './lib/request.js'
import { matchesNoRetry, modelForSession, recordModel } from './lib/retry.js'
import { compileRule } from './lib/rule.js'
import { headerFor, isSubagentHeader } from './lib/session.js'
import { dryRunStream, writeTrace } from './lib/trace.js'

export const name = 'dsh-prompt-filter'

/** `llm` is the hook surface; `agents` is optional and looked up lazily. */
export const inject = ['llm']

function makeLogger(ctx) {
  let logger
  try {
    logger = ctx?.logger
  } catch {
    logger = undefined
  }
  const write = (level, message) => {
    const line = `[dsh-prompt-filter] ${message}`
    if (logger !== undefined && logger !== null && typeof logger[level] === 'function') {
      logger[level](line)
      return
    }
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  }
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  }
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const log = makeLogger(ctx)

  if (config.problems.length > 0) {
    log.error(`invalid config, plugin left inactive: ${config.problems.join('; ')}`)
    return
  }
  if (!config.enabled) {
    log.info('disabled; no request listeners registered')
    return
  }

  let rules
  try {
    rules = config.rules.map((rule, index) => compileRule(rule, index))
  } catch (error) {
    log.error(`invalid rules, plugin left inactive: ${error?.message ?? error}`)
    return
  }
  if (rules.length === 0) {
    log.info('no rules configured, plugin left inactive')
    return
  }

  const dispatched = new WeakSet()
  const agentsOf = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('agents') : undefined
    } catch {
      return undefined
    }
  }

  ctx.on('llm/stream', (options, next) => {
    if (options === null || typeof options !== 'object') return next()
    if (dispatched.has(options)) return next()

    if (options.sessionId !== undefined && options.sessionId !== null) {
      recordModel(options.sessionId, options.provider, options.model)
    }

    const rule = rules.find((candidate) => matchModel(candidate.matchers, {
      provider: options.provider,
      model: options.model,
    }))
    if (rule === undefined) return next()
    if (!config.applyToSubagents && isSubagentHeader(headerFor(agentsOf(), options.sessionId))) return next()

    let filtered
    try {
      filtered = buildFilteredRequest(options, rule, config)
    } catch (error) {
      log.error(`filtering failed, sending the original request: ${error?.message ?? error}`)
      return next()
    }
    if (!filtered.changed) return next()

    if (config.debug || filtered.dryRun) writeTrace(config, filtered.report, log)
    if (filtered.dryRun) {
      log.info(`dry-run ${formatReport(filtered.report)}`)
      return dryRunStream(filtered.report)
    }

    log.info(`filtered ${formatReport(filtered.report)}`)
    dispatched.add(filtered.request)
    return ctx.llm.stream(filtered.request)
  }, { prepend: true })

  ctx.on('agent/request-error', (payload, next) => {
    const failure = payload?.failure
    if (failure === null || typeof failure !== 'object') return next()

    const session = payload?.agent?.session
    if (!config.applyToSubagents && isSubagentHeader(session?.header)) return next()

    const info = modelForSession(session?.id)
    if (info === undefined) return next()

    const rule = rules.find((candidate) => matchModel(candidate.matchers, info))
    if (rule === undefined || !matchesNoRetry(rule.noRetryOn, failure)) return next()

    log.warn(`suppressed identical retry for ${info.provider}/${info.model}: ${failure.code ?? ''} ${failure.message ?? ''}`.trim())
    return undefined
  }, { prepend: true })
}