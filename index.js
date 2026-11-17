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
 *
 * Live configuration: every field is `.volatile()`, so edits made in the GUI
 * (plugin detail page, settings page, sidebar panel) are committed in place
 * without restarting the plugin. The listeners read one mutable `state`
 * object; `loader/volatile-update` rebuilds it, keeping the last valid rules
 * when a new candidate fails to compile.
 */

import { normalizeConfig } from './lib/config.js'
import { restoreStream } from './lib/inbound.js'
import { VERSION } from './lib/version.js'
import { matchModel } from './lib/match.js'
import { buildFilteredRequest, formatReport } from './lib/request.js'
import { matchesNoRetry, modelForSession, recordModel } from './lib/retry.js'
import { compileRule } from './lib/rule.js'
import { headerFor, isSubagentHeader } from './lib/session.js'
import { dryRunStream, writeTrace } from './lib/trace.js'
import { plain } from './lib/volatile.js'

export const name = 'dsh-prompt-filter'
export const version = VERSION

/** `llm` is the hook surface; `agents` is optional and looked up lazily. */
export const inject = ['llm']

/**
 * The loader config schema. Imported lazily because the linked package only
 * resolves `@deepseek-ai/schemastery` inside a DSH profile (the runner wires
 * peer dependencies at activation time); plain `node --test` runs without a
 * profile, where the schema is simply absent and the filter still works.
 */
let Schema
try {
  Schema = (await import('@deepseek-ai/schemastery')).default
} catch {
  Schema = undefined
}

/**
 * Every editable field is volatile: it appears in the settings surfaces and
 * a save is committed into the running plugin without a restart.
 */
export const Config = Schema === undefined ? undefined : Schema.object({
  /** Register the sidebar entry (关闭后仍可用 /prompt-filter 或插件页打开). */
  sidebarEntry: Schema.boolean().default(true).volatile()
    .description('在左侧栏显示入口；关闭后不再注册侧栏入口，仍可用 /prompt-filter 命令或插件页打开。'),
  /** Master switch for filtering. */
  enabled: Schema.boolean().default(true).volatile()
    .description('启用对 gemini/claude 请求的过滤。'),
  /** Report instead of dispatching a filtered request. */
  dryRun: Schema.boolean().default(false).volatile()
    .description('试运行：不发送请求，只返回 PROMPT_FILTER_DRY_RUN。'),
  /** Write the filtered report to the trace directory. */
  debug: Schema.boolean().default(false).volatile()
    .description('把过滤报告写入 trace 目录。'),
  /** Filter subagent sessions too. */
  applyToSubagents: Schema.boolean().default(true).volatile()
    .description('对子代理的请求同样生效。'),
  /** Trace directory; empty means the default location. */
  traceDir: Schema.string().default('').volatile()
    .description('trace 目录；留空使用默认位置。'),
  /** Rule list; validated by the plugin so schema stays forward-compatible. */
  rules: Schema.array(Schema.any()).default([]).volatile()
    .description('过滤规则：id、modelMatch、identityOverride、noRetryOn、scope、stripLines、replace、nameMap。'),
})

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

/**
 * Normalize and compile one candidate configuration.
 *
 * Returns `{ active: false }` for a disabled or broken candidate; requests
 * then pass straight through, which keeps DSH working while the user fixes
 * the configuration in the GUI.
 */
function buildState(rawConfig, log) {
  const config = normalizeConfig(plain(rawConfig))
  if (config.problems.length > 0) {
    log.error(`invalid config, filtering stays off: ${config.problems.join('; ')}`)
    return { active: false, reason: 'invalid', config, rules: [] }
  }
  if (!config.enabled) {
    log.info('disabled; requests pass through unchanged')
    return { active: false, reason: 'disabled', config, rules: [] }
  }

  let rules
  try {
    rules = config.rules.map((rule, index) => compileRule(rule, index))
  } catch (error) {
    log.error(`invalid rules, filtering stays off: ${error?.message ?? error}`)
    return { active: false, reason: 'invalid', config, rules: [] }
  }
  if (rules.length === 0) {
    log.info('no rules configured; requests pass through unchanged')
    return { active: false, reason: 'empty', config, rules: [] }
  }
  return { active: true, reason: 'ok', config, rules }
}

export function apply(ctx, rawConfig) {
  const log = makeLogger(ctx)
  let state = buildState(rawConfig, log)
  let lastValid = state.active ? state : undefined

  if (Config === undefined) {
    log.error('@deepseek-ai/schemastery is unavailable; the GUI configuration form cannot be exposed')
  }

  const rebuild = () => {
    let next
    try {
      next = buildState(rawConfig, log)
    } catch (error) {
      log.error(`configuration reload failed: ${error?.message ?? error}`)
      return
    }
    if (next.active) {
      state = next
      lastValid = next
      log.info(`configuration reloaded: ${next.rules.length} rule(s)`)
      return
    }
    // An explicit disable (or an emptied rule list) is a deliberate state, not
    // a broken edit: honor it. Only an edit that fails validation keeps the
    // last valid rules so requests keep working while the user fixes it.
    if (next.reason === 'invalid' && lastValid !== undefined) {
      state = lastValid
      log.warn('configuration is invalid; keeping the last valid rules so requests keep working')
      return
    }
    state = next
  }

  // Volatile commits do not restart the plugin; this event is the only signal
  // that a GUI save changed the values behind the stable references. The
  // listener is scoped to this fiber, so it is removed with the plugin.
  try {
    ctx.on('loader/volatile-update', () => { rebuild() })
  } catch (error) {
    log.warn(`volatile configuration reload is unavailable: ${error?.message ?? error}`)
  }

  // Declare that this plugin ships its own settings pages, so the generic
  // auto-generated presentation is not offered next to them.
  try {
    if (typeof ctx.inject === 'function' && ctx.fiber !== undefined) {
      ctx.inject(['settings'], (sctx) => {
        try {
          sctx.effect(() => sctx.get('settings').configure({ auto: false }, ctx.fiber), 'prompt-filter: settings pages')
        } catch (error) {
          log.warn(`settings presentation could not be configured: ${error?.message ?? error}`)
        }
      })
    }
  } catch (error) {
    log.warn(`settings service is unavailable: ${error?.message ?? error}`)
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

    const current = state
    if (!current.active) return next()
    const config = current.config

    if (options.sessionId !== undefined && options.sessionId !== null) {
      recordModel(options.sessionId, options.provider, options.model)
    }

    const rule = current.rules.find((candidate) => matchModel(candidate.matchers, {
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
    const stream = ctx.llm.stream(filtered.request)
    // Restore the original tool names / skill ids on the way back, before DSH
    // parses and executes the call. The mapping is static, so it is stable for
    // every turn, every parallel call, and every retry of this rule.
    return rule.names.size > 0 ? restoreStream(stream, rule) : stream
  }, { prepend: true })

  ctx.on('agent/request-error', (payload, next) => {
    const current = state
    if (!current.active) return next()
    const config = current.config

    const failure = payload?.failure
    if (failure === null || typeof failure !== 'object') return next()

    const session = payload?.agent?.session
    if (!config.applyToSubagents && isSubagentHeader(session?.header)) return next()

    const info = modelForSession(session?.id)
    if (info === undefined) return next()

    const rule = current.rules.find((candidate) => matchModel(candidate.matchers, info))
    if (rule === undefined || !matchesNoRetry(rule.noRetryOn, failure)) return next()

    log.warn(`suppressed identical retry for ${info.provider}/${info.model}: ${failure.code ?? ''} ${failure.message ?? ''}`.trim())
    return undefined
  }, { prepend: true })
}