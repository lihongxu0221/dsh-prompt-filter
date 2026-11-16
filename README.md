# dsh-prompt-filter

一个独立的 DeepSeek Harness（DSH）插件：在请求发往上游模型网关之前，按模型名匹配规则，剥离请求中的 Harness 身份信息——包括系统提示里的身份句、GUI 说明、实现源码路径、搜索工具名、上下文压缩链接，以及工具定义描述里的 `DSH` / `Harness` / `ACP` 等字样。

用于修复 gemini / claude 分组模型（`group/gemini-*`、`group/claude-*`）在 magpie 上游返回 `429 Resource has been exhausted (e.g. check quota)` 的问题：该上游会把系统提示里的 "DeepSeek Harness" 身份文本当成敏感内容直接拒绝，即使额度充足。

插件不修改 DSH 核心、不修改 `@deepseek-ai/dsh-system-prompt`、不向会话日志写入过滤后的文本；插件禁用时请求与现在完全一致。

---

## 1. 环境与已验证版本

| 项 | 值 |
| --- | --- |
| 开发/验证基线 | DSH `0.2.2-rc.3` |
| 源码提交 | `39163dd30f703a79079e2d2446545cff3c453738`（2026-11-13，`deepseek-ai/deepseek-harness`） |
| 源码目录 | `E:\AI\Agents\Deepseek Harness\Code` |
| 插件目录 | `E:\AI\Agents\Deepseek Harness\DSH\dsh-prompt-filter` |
| 运行时 | 应用自带 node 24.21.0；本机 PATH 上的 node 26.4.0 也可跑单测 |

DSH 升级后，请按第 9 节重新核对默认规则是否仍覆盖全部身份文本。

---

## 2. 工作原理（为什么钩在这里）

请求在 `llm/stream` 这条 waterfall 上已经组装完毕：系统提示、运行时上下文、记忆/提醒块、工具 schema 都在 `GenerateOptions` 里，紧接着就是 adapter 生成 provider 报文。此处是唯一能同时改「系统提示文本」和「工具描述」的位置：

- `system-prompt/assemble` 只能改 section/context 文本，工具 schema 是在 waterfall 之后追加的，改不到。
- `agent/pre-step` 只能替换被接收的消息，不能改 assembly 或工具集。
- `llm/stream` 的 `next()` 不接受参数，不能“替换参数后继续”；本插件把请求浅拷贝成可变对象，再通过 `ctx.llm.stream(clone)` 重新派发，并用 `WeakSet` 防止递归。

监听器以 `prepend: true` 注册，因此重新派发时其余 `llm/stream` 监听器（billion-context 等）只会在内层执行一次，不会被跑两遍。

重试方面：`dsh-llm-retry` 在 normal 模式下对 `RATE_LIMIT` 会直接排定退避并返回 `{kind:'retry'}`，不会调用下游监听器。因此“相同请求体不再重试”的否决必须注册在它之前（同样 `prepend: true`），命中 `noRetryOn` 时返回 `undefined` 且不调用 `next()`，让本轮直接失败。

过滤范围：

- system 角色的全部文本块（系统提示 + 运行时上下文 + 记忆块）。
- developer 角色文本块，以及 `source.kind === 'runtime-context'` 的 `<system-reminder>` 提醒消息（两者同属 `scope.memoryReminders`；普通 user 消息永不修改）。
- 工具 schema 的 `description`、`parameters` 里各层的 `description`；不碰 enum / default / const 等参数数据。
- 可选：工具名（`scope.toolNames`，默认关闭；开启后只做安全字符集校验并同步改写 assistant 消息里对应的 `tool-call` 名，但不改写 tool 结果消息的关联，属于高风险选项）。
- 永不修改 user / assistant / tool 消息的正文。

`scope.paths` 默认开启：文本里的带引号路径（源码目录、工作目录）会被替换成 `[path]`，避免 `dsh-windows` 这类路径泄漏品牌名；需要保留真实路径时设 `paths: false`（此时路径中的 `dsh` 不会被替换）。

---

## 3. 安装

### 方式 A：plugin_manager（推荐）

```
plugin_manager install_bundle → target = "E:\AI\Agents\Deepseek Harness\DSH\dsh-prompt-filter"
```

或在 GUI 里 **Plugins > Add plugin** 选择上面这个目录。安装后重启 DSH（或重载该插件行），插件列表里会出现 **Prompt Filter / 提示词过滤器**。

安装是“链接本地目录”的方式：之后的代码改动重启即可生效，无需重新安装；但 `package.json` 的 `files` 字段对链接安装不生效，发布打包前请自行核对文件清单。

### 方式 B：手动写进 profile

不推荐手改 profile 的 `package.json` 或 `cordis.patch.yml`；如确需手动，可把该目录 link 进 profile 的依赖，并让 profile 的 bundle 列表包含 `dsh-prompt-filter`。任何情况下都不要把本插件文件拷进 DSH 安装目录或 `node_modules`。

### 配置生效

- 本插件的默认配置随 `cordis.patch.yml` 一起安装，可直接使用。
- 修改 profile 的 `cordis.patch.yml` 中 id 为 `dsh-prompt-filter` 的行即可覆盖配置；**同 id 的行会整体替换 bundle 配置**，请复制完整对象再改（见 `examples/cordis.patch.yml`）。
- 配置在插件加载时编译校验；改完配置重启 DSH 生效（至少重启后生效）。非法配置不会让 DSH 崩溃：插件打印 `invalid config, plugin left inactive` 并保持不注册监听器。

---

## 4. 配置参考

```yaml
- id: dsh-prompt-filter
  config:
    enabled: true            # 总开关；false 时不注册任何监听器，行为与未安装一致
    dryRun: false            # true：只记录/打印，不真正发请求（会产生一次失败回合）
    debug: true              # 每次命中规则都把过滤后的请求写入 trace 目录
    applyToSubagents: true   # false：子代理（origin=subagent / delegationDepth>0）不过滤
    traceDir: ''             # 空 = $DSH_HOME/dsh-prompt-filter/trace（保留最近 50 个文件）
    rules:
      - id: default-gemini-claude
        modelMatch:          # 子串匹配，大小写不敏感；也支持 "/正则/flags" 或 {pattern, regex}
          - gemini
          - claude
        identityOverride: You are a helpful coding assistant.
        noRetryOn:           # failure.code / message / status 中包含这些子串时不重试同一请求体
          - Resource has been exhausted
          - RATE_LIMIT
        scope:
          system: true
          toolDescriptions: true
          toolNames: false   # 高风险：会重命名工具并改写 assistant 消息中的调用名
          memoryReminders: true  # developer 记忆块 + runtime-context 提醒消息
          paths: true        # false 时保留引号内的真实路径
        stripLines: [...]
        replace: [...]
```

`modelMatch` 的匹配对象是 `provider`、`model`、`provider/model` 三者，任一命中即生效。

`stripLines` 条目：

```yaml
- pattern: 精确子串或 /正则/flags   # 字符串默认按子串处理
  mode: line                        # line（默认，删除包含它的整行）或 paragraph（删除所在空行分段）
  regex: true                       # 或直接在 pattern 里写 /.../flags
```

`replace` 条目：`{from, to, regex?}`，`from` 同样支持 `/.../flags` 与 `{pattern, regex}`。

规则按数组顺序匹配，第一条命中的规则生效；需要按不同上游/模型分组时写多条规则即可。

---

## 5. 默认规则覆盖了哪些身份文本

`default-gemini-claude` 规则（见 `cordis.patch.yml`）逐条对应需求文档第 2 节：

| 身份源 | 处理 |
| --- | --- |
| `You are an AI agent powered by DeepSeek Harness.` | 整行删除，换成中性身份句 |
| persona：`You are a coding agent powered by the <model> model.` | 正则整行删除 |
| `You are interacting with the user through the DeepSeek Harness Web GUI…` 整段 | 段落删除（含 `__DSH_BOOT__`、`dsh web`、Vite 说明） |
| `The runtime context names the DeepSeek Harness implementation checkout…` 整段 | 段落删除 |
| `Current DeepSeek Harness implementation checkout:` / `Web GUI URL:` 行 | 整行删除 |
| `The session workspace …` / `also includes these source folders:` 行 | 整行删除 |
| `Current DSH file policy:` | 替换为 `Current file policy:` |
| `enforced by the DSH file sandbox` / `The DSH file sandbox does not restrict` | 去品牌替换 |
| `DSH session cwd` | 替换为 `session cwd` |
| `window.__DSH_BOOT__` | 替换为 `the app boot payload` |
| `dsh web` | 替换为 `the app` |
| 搜索工具名 `deepseek-tools` / `deepseek-official` | 替换为 `search-tools` / `search-official` |
| `github.com/ranxianglei/billion-context` 段落 | 段落删除 |
| `billion-context` | 替换为 `context-compaction` |
| `ACP` | 替换为 `cross-session` |
| `DeepSeek Harness` / `Harness` | 替换为 `the agent` / `agent` |
| 孤立的 `DSH` / `dsh`（前后不是字母数字） | 替换为 `APP` / `app` |

所有规则都在 YAML 里，改配置不需要改代码。

---

## 6. dry-run、debug 与审计

### 单测

```bash
cd "E:\AI\Agents\Deepseek Harness\DSH\dsh-prompt-filter"
node --test
```

### dry-run

把 `dryRun: true` 写进配置并重启，然后正常发一条消息。插件会：

1. 生成过滤后的请求报告并写入 trace（`debug` 或 `dryRun` 任一开启）；
2. 不调用上游，直接以一个非重试错误码 `PROMPT_FILTER_DRY_RUN` 结束本轮；
3. 日志中输出 `[dsh-prompt-filter] dry-run rule=… model=… system=… tools=…`。

### debug / trace

`debug: true` 时每次命中规则都会在 `$DSH_HOME/dsh-prompt-filter/trace/`（或 `traceDir`）写一个 JSON。

> **隐私**：trace 保存的是过滤后、即将发往上游的完整系统提示与工具说明，其中包含工作区路径等信息；只保留最近 50 个文件，请勿把 trace 目录提交到公开仓库或贴到 issue 里。

```json
{
  "at": "2026-11-16T03:19:37.249Z",
  "provider": "magpie",
  "model": "group/gemini-3.8-flash",
  "ruleId": "default-gemini-claude",
  "system": {"messages": 1, "charsBefore": 12112, "charsAfter": 10687},
  "reminders": {"messages": 1, "count": 1},
  "systemInstruction": "……",
  "reminderTexts": ["<system-reminder>……</system-reminder>"],
  "toolSchemas": [{"name": "ops_bash", "description": "……"}],
  "hits": {"strip": 6, "replace": 12, "identity": 1}
}
```

### 审计脚本

```bash
node scripts/audit-trace.mjs "$DSH_HOME/dsh-prompt-filter/trace/<file>.json"
```

检查 `systemInstruction`、`reminderTexts[]` 与全部 `toolSchemas[].description` 是否还含以下任一 token（大小写不敏感）：

`deepseek harness`、`dsh`、`__dsh_boot__`、`deepseek-tools`、`deepseek-official`、`billion-context`。

其中 `dsh` 按“整词”检查：前后不能是 ASCII 字母或数字。因此英文普通单词 `spreadsheets` 内部的 `dsh`，以及 `ui_present` 工具说明里 `webkit.messageHandlers.dshui` 这类文档示例不算残留——带这些内容的真实请求实测返回 200，上游并不将其视为身份 token；其余 token 仍按子串匹配。

退出码：`0` 干净、`1` 发现残留、`2` 用法/解析错误。可一次传多个文件。

> trace 记录的是“进入 adapter 前”的请求。若之后还有插件在 fetch/proxy 层改写报文（例如 billion-context 的压缩代理），请以该层的网关日志为准；本插件无法替下游代理的二次注入负责。

---

## 7. 验收步骤（按需求文档第 5 节）

1. 安装插件并重启，确认插件列表出现 Prompt Filter。
2. 新建一个空会话，只选 `group/gemini-3.8-flash`，发送一条 `hi`。
3. 观察：
   - 回合正常返回（200，不再出现 `Resource has been exhausted`）；
   - 日志出现 `[dsh-prompt-filter] filtered rule=default-gemini-claude …`；
   - `scripts/audit-trace.mjs` 对最新 trace 退出码为 0。
4. 对照：切到 deepseek 模型新建会话发一条消息，日志中不应出现 `filtered`（规则不匹配），系统提示保持原样。
5. 关闭插件（`enabled: false`）重启，请求应与安装前完全一致（不做 clone、不做 trace、不注册监听器）。

**重要**：测试阶段同一时间只发一条 gemini/claude 请求，也不要并发启动多个探测子代理。连续 429 会让 上游网关 对整个客户端触发 `bili_throttle_hold`，进而阻塞 deepseek 主会话。

---

## 8. 已知限制

- 过滤只发生在请求层：会话界面、日志、`session` 文件里仍是未过滤的原文；这保证插件禁用或卸载后历史完全一致。
- 工具名默认不改；`toolNames: true` 会让工具名与 assistant 消息中的调用名一致变化，但历史工具结果、外部脚本、用户习惯都可能失配，默认保持关闭。
- `noRetryOn` 只阻止“同一请求体重试”，不改变本轮最终错误：会话里仍会显示 429，只是不再重复打 5 次。
- `dryRun` 会真实结束当前回合（错误码 `PROMPT_FILTER_DRY_RUN`），适合验证，不适合日常开启。
- billion-context 等插件在 fetch 层做的压缩/改写不受本插件控制；本插件只保证交到 adapter 的 `GenerateOptions` 干净。
- 引号内路径默认脱敏；如用 `paths: false`，路径中的 `dsh` 会保留，可能触发上游拦截，也说明该路径本身含品牌名。

---

## 9. DSH 升级后的复核清单

1. `node --test` 全绿（纯 JS 逻辑，与 DSH 版本无关）。
2. 在 `Code` 仓库确认这几个位置未变：
   - `packages/llm/llm/src/index.ts` 的 `llm/stream` waterfall 与 `stream(options)`；
   - `packages/core/agent/src/runtime-types.ts` 的 `agent/request-error` 签名与 `RequestErrorAction`；
   - `packages/llm/llm-retry/src/index.ts` 的 `recover()` 顺序（决定否决是否仍需 prepend）；
   - `packages/core/session/src/types.ts` 的 `SessionHeader.origin/delegationDepth`；
   - `packages/llm/llm/src/message.ts` 的 `ContentBlock` 形状（新增 block 类型时确认过滤逻辑不受影响）。
3. 打开 `debug`，发一条 gemini 消息，跑 `scripts/audit-trace.mjs`；若出现新 token，把它加进 `cordis.patch.yml` 的 `stripLines` / `replace`，并同步更新本 README 第 5 节与审计脚本的 token 列表。
4. 确认 dry-run 与 `enabled: false` 行为未变。

---

## 10. 卸载

```
plugin_manager remove_bundle → target = dsh-prompt-filter
```

或 GUI 插件列表里移除；随后重启。卸载不影响 DSH 本身，因为插件没有改动任何 DSH 文件。

---

## 11. 目录结构

```
dsh-prompt-filter/
├─ package.json            # bundle 清单（dsh.bundle.patch 指向 cordis.patch.yml）
├─ cordis.patch.yml        # 默认插件行 + 完整默认规则
├─ index.js                # apply()：注册 llm/stream 与 agent/request-error 监听器
├─ lib/
│  ├─ config.js            # 默认值、归一化、校验
│  ├─ pattern.js           # 子串 / 正则编译
│  ├─ match.js             # modelMatch 匹配
│  ├─ text.js              # 删行/删段、替换、路径脱敏
│  ├─ tools.js             # 工具描述与参数描述的过滤
│  ├─ messages.js          # system / developer 文本过滤
│  ├─ request.js           # 克隆请求、生成报告
│  ├─ rule.js              # 规则编译（错误带上下文）
│  ├─ retry.js             # noRetryOn 否决 + 会话模型记忆
│  ├─ session.js           # 子代理识别
│  └─ trace.js             # trace 写入与 dry-run 流
├─ locale/{en,zh-CN}.json  # 插件列表展示
├─ icon.svg
├─ examples/cordis.patch.yml
├─ scripts/audit-trace.mjs
├─ test/                   # node --test（51 项）
└─ README.md
```

## 12. 许可

本插件为本地私有 bundle（`"private": true`），无第三方依赖；可按需修改。