/** Realistic prompt/tool fixtures for the filter unit tests (offline, sanitized). */

export const SYSTEM_PROMPT = [
  'You are an AI agent powered by DeepSeek Harness.',
  '',
  'You are a coding agent powered by the group/gemini-3.8-flash model.',
  'Work in the current repository and follow the project instructions.',
  '',
  'You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.',
  'The browser provides no implicit DOM, route, or screenshot context.',
  'The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while `pnpm run dev:web` is also running from this same checkout.',
  'The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__.',
  'Every other change requires rebuilding the affected Web artifacts.',
  '',
  'The runtime context names the DeepSeek Harness implementation checkout.',
  'The checkout location and current working directory are separate values and may differ.',
  'Use this checkout only to inspect or extend DSH itself.',
  '',
  'Some functional context follows.',
  'Current DeepSeek Harness implementation checkout: "E:\\AI\\Agents\\Deepseek Harness\\Code".',
  'Current DeepSeek Harness Web GUI URL: "http://127.0.0.1:62109".',
  'Current working directory: "D:\\repos\\my-project".',
  'Current DSH file policy: danger-full-access.',
  'The DSH file sandbox does not restrict file modifications by available operations.',
  'The session workspace "D:\\repos\\my-project" also includes these source folders: "C:\\Users\\dev\\.config", "E:\\src\\my-plugin".',
  '',
  'Context management for this conversation is provided by billion-context (github.com/ranxianglei/billion-context). Report billion-context problems to that project\'s issue tracker.',
  '',
  'Available skills include dsh-doc, which explains how a DSH plugin, bundle, or tool definition works.',
  'Keep functional content such as tool usage and runtime context intact.',
].join('\n')

export const TOOLS = [
  {
    name: 'ops_bash',
    description: "Run a command in this session's DSH session cwd. Output is bounded with spill paths.",
    parameters: {
      type: 'object',
      properties: {
        engine: {
          type: 'string',
          description: 'Search engine id, one of deepseek-tools or deepseek-official.',
          enum: ['deepseek-tools', 'deepseek-official', 'bing'],
        },
        command: { type: 'string', description: 'Command under the DSH file policy.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'acp_status',
    description: 'Context status from billion-context. ACP tags quote message refs.',
    parameters: { type: 'object', properties: { detail: { type: 'string', description: 'ACP detail level.' } } },
  },
  {
    name: 'plugin_manager',
    description: 'List plugins in the current profile. Unmet DSH version requirements block installation.',
    parameters: { type: 'object', properties: {} },
  },
]

export const USER_MESSAGE = {
  role: 'user',
  id: 'm1',
  source: { kind: 'user' },
  content: [{ type: 'text', text: 'Explain DeepSeek Harness and dsh to me, then keep the DSH acronym.' }],
}

export const ASSISTANT_TOOL_CALL = {
  role: 'assistant',
  id: 'm2',
  source: { kind: 'model', provider: 'magpie', model: 'group/gemini-3.8-flash' },
  content: [{ type: 'tool-call', id: 'call-1', name: 'ops_bash', arguments: '{"command":"pwd"}' }],
}

export const DEVELOPER_MEMORY = {
  role: 'developer',
  id: 'm3',
  content: [{ type: 'text', text: 'Memory: the user works on DSH plugins under .dsh and dsh-workspace-browser.' }],
}

export const SYSTEM_MESSAGE = {
  role: 'system',
  id: 'm4',
  source: { kind: 'system-prompt' },
  content: [{ type: 'text', text: SYSTEM_PROMPT }],
}

export const RUNTIME_REMINDER = {
  role: 'user',
  id: 'm5',
  source: { kind: 'runtime-context', form: 'snapshot' },
  content: [{
    type: 'text',
    text: '<system-reminder>\nCurrent DSH file policy: danger-full-access.\nCurrent working directory: "D:\\repos\\my-project".\nThe session workspace "D:\\repos\\my-project" also includes these source folders: "C:\\Users\\dev\\.config".\n</system-reminder>',
  }],
}

export const FORBIDDEN = [
  'deepseek harness',
  'dsh',
  '__dsh_boot__',
  'deepseek-tools',
  'deepseek-official',
  'billion-context',
]

export function forbiddenHits(text) {
  const haystack = String(text).toLowerCase()
  return FORBIDDEN.filter((token) => haystack.includes(token))
}