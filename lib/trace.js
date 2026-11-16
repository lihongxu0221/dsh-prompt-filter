/**
 * Trace files and the dry-run terminal stream.
 *
 * A trace holds exactly what this plugin is about to send: the composed
 * systemInstruction and every tool name/description (after filtering), plus
 * the rule and hit counts. `scripts/audit-trace.mjs` checks those fields for
 * forbidden tokens.
 */

import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { formatReport } from './request.js'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const MAX_TRACE_FILES = 50

export function traceDirOf(config) {
  if (config !== null && typeof config === 'object' && typeof config.traceDir === 'string' && config.traceDir !== '') {
    return config.traceDir
  }
  return join(DSH_HOME, 'dsh-prompt-filter', 'trace')
}

function prune(dir, log) {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => ({ name, path: join(dir, name), mtimeMs: statSync(join(dir, name)).mtimeMs }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const file of files.slice(MAX_TRACE_FILES)) unlinkSync(file.path)
  } catch (error) {
    log?.warn?.(`trace pruning failed: ${error?.message ?? error}`)
  }
}

export function writeTrace(config, report, log) {
  try {
    const dir = traceDirOf(config)
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const model = String(report?.model ?? 'model').replace(/[^A-Za-z0-9_.-]+/g, '-')
    const file = join(dir, `${stamp}-${model}.json`)
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
    prune(dir, log)
    log?.info?.(`trace written: ${file}`)
    return file
  } catch (error) {
    log?.warn?.(`trace write failed: ${error?.message ?? error}`)
    return undefined
  }
}

/**
 * Terminal stream for dry-run: nothing reaches the provider, and the loop
 * asks `agent/request-error` with a code no retry policy accepts, so the turn
 * ends with the report instead of a fake assistant message.
 */
export async function* dryRunStream(report) {
  yield {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        code: 'PROMPT_FILTER_DRY_RUN',
        message: `[dsh-prompt-filter] dry-run: request not sent. ${formatReport(report)}`,
      },
    },
  }
}