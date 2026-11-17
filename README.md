# dsh-prompt-filter

一个独立的 DeepSeek Harness（DSH）插件：在请求发往上游模型网关之前，按模型名匹配规则，剥离请求中的 Harness 身份信息——包括系统提示里的身份句、GUI 说明、实现源码路径、搜索工具名、上下文压缩链接，以及工具定义描述里的 `DSH` / `Harness` / `ACP` 等字样。

另外支持两类分离的改写：只出站不还原的 `stripLines` / `replace`，以及出站改名、入站还原的 `nameMap`（工具名与技能 id）。

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

v0.2.0 的界面部分（`client.js`）由 `node --test` 的假 React/槽位测试覆盖注册逻辑；host 的 `Config` 已在真实 `@deepseek-ai/schemastery` 下验证：可 `toJSON`、各字段被包装成 volatile ref、非法 `rules` 会在写入前被拒。浏览器内的实际排版（四个入口的视觉）需要重启应用后人工看一眼。

---

## 2. 工作原理（为什么钩在这里）

请求在 `llm/stream` 这条 waterfall 上已经组装完毕：系统提示、运行时上下文、记忆/提醒块、工具 schema 都在 `GenerateOptions` 里，紧接着就是 adapter 生成 provider 报文。此处是唯一能同时改「系统提示文本」和「工具描述」的位置：

- `system-prompt/assemble` 只能改 section/context 文本，工具 schema 是在 waterfall 之后追加的，改不到。
- `agent/pre-step` 只能替换被接收的消息，不能改 assembly 或工具集。
- `llm/stream` 的 `next()` 不接受参数，不能“替换参数后继续”；本插件把请求浅拷贝成可变对象，再通过 `ctx.llm.stream(clone)` 重新派发，并用 `WeakSet` 防止递归。

监听器以 `prepend: true` 注册，因此重新派发时其余 `llm/stream` 监听器（billion-context 等）只会在内层执行一次，不会被跑两遍。

已知限制：DSH 的 `isAgentLoopRequest` 用 `WeakSet` 按**对象身份**判断，而插件发出的是浅拷贝，标记不会跟随。上游唯一的生产消费者是 `session-title`（`packages/session/session-title/src/index.ts`），所以**被过滤模型的会话不再自动生成标题**；其余功能不受影响。上游没有提供可写的请求装配钩子，这是「重写请求」的固有代价，不做 hack 绕过。

重试方面：`dsh-llm-retry` 在 normal 模式下对 `RATE_LIMIT` 会直接排定退避并返回 `{kind:'retry'}`，不会调用下游监听器。因此“相同请求体不再重试”的否决必须注册在它之前（同样 `prepend: true`），命中 `noRetryOn` 时返回 `undefined` 且不调用 `next()`，让本轮直接失败。

过滤范围：

- system 角色的全部文本块（系统提示 + 运行时上下文 + 记忆块）。
- developer 角色文本块，以及 `source.kind === 'runtime-context'` 的 `<system-reminder>` 提醒消息（两者同属 `scope.memoryReminders`；普通 user 消息永不修改）。
- 工具 schema 的 `description`、`parameters` 里各层的 `description`；不碰 enum / default / const 等参数数据。
- 工具名与技能 id：只通过独立的 `nameMap` 出站改名，并在模型响应流里按同一张表还原（`scope.toolNames` / `scope.skillCatalog`，默认开启），详见 §4.2。
- `GenerateOptions.toolHistory`：路由声明 `toolUpdate`（`in-history` / `addition-only`）时，上游 `projectToolUpdates` 会忽略 `options.tools`，改用 history 重建工具声明表，所以 history 里的工具名与描述必须与 `options.tools` 同步过滤。
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
    sidebarEntry: true       # 在左侧栏显示入口；false 时不注册侧栏图标，仍可用 /prompt-filter、插件页、设置页打开
    enabled: true            # 过滤总开关；false 时监听器仍在但原样放行（GUI 入口保留）
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
          toolNames: true    # 通过 nameMap 改工具名，入站还原（见 §4.2）
          skillCatalog: true # 技能目录与 skill 工具参数里的技能 id 同样改名/还原
          memoryReminders: true  # developer 记忆块 + runtime-context 提醒消息
          paths: true        # false 时保留引号内的真实路径
        skillToolName: skill # 承载技能 id 的工具名（默认 skill）
        stripLines: [...]    # 只出站：删行/删段，永不还原
        replace: [...]       # 只出站：文本替换，永不还原
        nameMap:             # 出站改名 + 入站还原；不要把这些标识符再写进 replace
          tools:
            ops_bash: run_bash
            ops_grep: search_text
            plugin_manager: plugin_registry
          skills:
            dsh-badge: assistant-badge
            dsh-doc: product-doc
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

### 4.2 两类改写必须分开（重要）

**第一类：只出站改写，不还原** —— `stripLines`、`replace`、`identityOverride`。用于身份句、说明文字、正文里的品牌词。改出去就不管回来，因为入站不需要这些文本。

**第二类：出站改名 + 入站还原** —— `nameMap.tools` 与 `nameMap.skills`。只用于 DSH 还要靠原名解析执行的标识符，例如工具名 `ops_bash` 和技能 id `dsh-badge`。模型看到的是中性名，响应回到 DSH 之前由 `llm/stream` 的包装流按同一张表改回原名，因此：

- 工具调用的 `tool-call-delta.name`、权威 `block-end` 块、`tool-addition` / `tool-removal` 都会还原；
- `skill` 工具的 `arguments` JSON 里的 `name` 会还原，分片流式参数按调用索引缓冲后整段下发，避免中性 id 漏进 DSH；
- 映射天然一对一双向唯一、每轮稳定；目标名不许含 `dsh` / `acp` / `harness`，也不许与源名相同。

**不要**把工具名或技能 id 写进 `replace`：编译期会直接报错并提示 `move it to nameMap so the response can be restored`。两类配置互不影响，可以单独增删：从 `nameMap` 里删掉某个工具，该工具出站不再改名、入站也不再还原。

### 4.1 界面入口与可视化配置（v0.2.0）

本插件自带浏览器端模块（`client.js`，随 `dsh.client` 声明加载），装好后有四个入口，全部编辑同一份 volatile 配置：

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| 侧栏图标 | 左侧栏 `sidebar.panellist`（order 31） | 可在配置里用「在左侧栏显示入口」关闭；关闭后不再注册图标，其余入口不受影响 |
| 面板 | 侧栏图标 / 插件页「打开面板」/ `/prompt-filter` 命令 | `main` 面板始终注册，所以关掉侧栏入口也能打开 |
| 插件页配置卡 | 侧栏 Plugins → 本插件行页（`plugins.row.config`）及包页（`plugins.bundle.config`） | 行摘要显示「提示词过滤 · 侧栏入口 开/关」 |
| 设置页分区 | 设置 → 「提示词过滤」（`settings.section`，order 55） | 与插件页同一张表单 |

可改字段：`sidebarEntry`、`enabled`、`dryRun`、`debug`、`applyToSubagents`、`traceDir`，以及 `rules`（JSON 数组，保存前校验 JSON 语法与数组形状）。保存走配置表单的 `mutate(ops, revision)`，写入当前 profile 的 Cordis patch：

- 所有字段都标了 `.volatile()`，保存后**立即生效**，不重启、不重跑 `apply`；
- host 在 `apply` 里缓存编译结果，监听 `loader/volatile-update` 后重建；编译失败（例如写坏正则）会保留上一份可用规则并打日志，不会让插件失效；
- 显式关闭（`enabled: false`）或清空规则会被采纳，监听器改为原样放行。

`rules` 建议先在文本编辑器里改好 YAML 再粘贴；JSON 里 `"regex": true` 与 `/.../flags` 两种写法都保留原样，界面不做结构化改写。

#### 侧栏图标的注册时机（v0.2.1 修复）

`sidebar.panellist` 是 root 级 list 槽位，由 `sidebar.panel.icon` 那一批插件声明。如果同一批激活的插件在槽位声明**之前**就 `slots.register(...)`，这次注册会被运行时丢弃，图标永远不出现（而且不报错）。因此 `client.js` 的 `installSidebar()` 用 `entry/desired/applied/inSlot` 四个状态做门控：

1. 只有 `ctx.slots.inject('sidebar.panellist', cb)` 的回调真正执行（`inSlot = true`）之后才注册图标；
2. `applyEntry(on)` 用 `applied` 去重，避免 `configForms` 快照每次刷新都重复注册；
3. 回调的清理函数负责注销图标、退订快照、复位状态，槽位重建时可以重新注册。

同理，**任何槽位注册都应放在对应的 `slots.inject` 回调里**，不要先在服务 effect 里注册。

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
| `powered by dsh` / `DSH plugin` / `DSH sandbox` | 替换为 `powered by the assistant` / `plugin` / `sandbox` |
| `ACP TAGS` / `ACP marker integrity` | 替换为 `CONTEXT TAGS` / `context marker integrity` |
| persona 行 `You are a coding agent powered by the <model> model.` | 正则整行删除 |
| `Current agent implementation checkout:` / `Current Web GUI URL:` | 整行删除 |

工具名与技能 id 不带中文、不在 `replace` 里，而由 `nameMap` 处理：

| 原名 | 对外名 |
| --- | --- |
| `ops_bash` / `ops_grep` / `ops_glob` / `ops_inspect_local_file` / `ops_discover_tools` | `run_bash` / `search_text` / `find_files` / `inspect_file` / `discover_tools` |
| `acp_cache` / `acp_status` / `acp_read_original_image` | `cache_reconcile` / `context_status` / `read_original_image` |
| `plugin_manager` / `session_event_read` / `session_event_search` / `session_event_trace` | `plugin_registry` / `event_read` / `event_search` / `event_trace` |
| 技能 `dsh-badge` / `dsh-doc` / `official-plugins` / `diagnose-windows-sandbox-acl` | `assistant-badge` / `product-doc` / `plugin-catalog` / `sandbox-acl-diagnostics` |

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
4. 对 `group/gemini-3.8-flash` 的实际请求跑 `scripts/audit-trace.mjs`：`systemInstruction`、`reminderTexts`、`toolSchemas[].description` 与工具名里应搜不到 `DeepSeek Harness` / `dsh` / `DSH` / `ACP` / `billion-context` / `__DSH_BOOT__` / `deepseek-tools` / `deepseek-official`（中性名除外）。工具 `parameters` 里的 `enum` 值（例如搜索提供方 id）属于运行参数，按设计保留。
5. 打一轮会调用工具或技能的对话：DSH 能正常解析并执行；日志里到达 DSH 的调用名是原名（`ops_bash`、`skill` 的 `dsh-doc` 等）。
6. 对照：切到 deepseek 模型新建会话发一条消息，日志中不应出现 `filtered`（规则不匹配），系统提示、工具名与技能 id 保持原样。
7. 关闭过滤（`enabled: false`）：请求应原样放行（不 clone、不 trace），监听器仍在但不改动请求；界面入口保留。

**重要**：测试阶段同一时间只发一条 gemini/claude 请求，也不要并发启动多个探测子代理。连续 429 会让 上游网关 对整个客户端触发 `bili_throttle_hold`，进而阻塞 deepseek 主会话。

---

## 8. 已知限制

- 过滤只发生在请求层：会话界面、日志、`session` 文件里仍是未过滤的原文；这保证插件禁用或卸载后历史完全一致。
- 工具名与技能 id 通过 `nameMap` 改名并还原；映射是静态配置，因此每轮稳定。若某个工具没写进 `nameMap`，它出站保持原名且不会触发还原。
- 工具 `parameters` 的 `enum` / `default` / `const` 值不做替换（它们可能是 provider 的真实参数值）；只改 `description`。
- `noRetryOn` 只阻止“同一请求体重试”，不改变本轮最终错误：会话里仍会显示 429，只是不再重复打 5 次。
- `dryRun` 会真实结束当前回合（错误码 `PROMPT_FILTER_DRY_RUN`），适合验证，不适合日常开启。
- billion-context 等插件在 fetch 层做的压缩/改写不受本插件控制；本插件只保证交到 adapter 的 `GenerateOptions` 干净。
- 引号内路径默认脱敏；如用 `paths: false`，路径中的 `dsh` 会保留，可能触发上游拦截，也说明该路径本身含品牌名。
- 界面配置依赖 profile 的 `configForms`（`@deepseek-ai/dsh-client-ui-settings`）；宿主不提供该服务时卡片会显示“当前 profile 没有为这个插件提供配置表单”，但 YAML 配置与过滤逻辑不受影响。
- 规则用 JSON 文本框编辑，保存时只校验 JSON 语法与数组形状；字段级错误（如 `mode` 拼错）在下一轮过滤时才由 host 编译发现，此时会保留上一份可用规则并打日志。
- `sidebarEntry`、`enabled` 等改动只写当前 profile 的 Cordis patch，不写 bundle 自带的 `cordis.patch.yml`；换 profile 需要重新设置。

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
5. 界面：设置 → 「提示词过滤」一节能打开；插件行页有配置卡；关掉侧栏入口后图标消失，`/prompt-filter` 仍能打开面板。
6. 配置表单的 namespace 若不再是行 id（当前为 `dsh-prompt-filter`），`plugins.row.config` 的 page 会退化成无 form 的卡片；用 `settings.describe()` 的输出核对 `ns`。

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
├─ index.js                # apply()：Config schema、编译缓存、volatile 重建、两个监听器
├─ client.js               # 浏览器端：侧栏入口/面板、插件页与设置页配置卡、/prompt-filter
├─ lib/
│  ├─ config.js            # 默认值、归一化、校验
│  ├─ names.js             # nameMap 编译（双向唯一、品牌名校验、整词替换/还原）
│  ├─ inbound.js           # 响应流还原（tool-call / skill 参数 / 分片缓冲）
│  ├─ pattern.js           # 子串 / 正则编译
│  ├─ match.js             # modelMatch 匹配
│  ├─ text.js              # 删行/删段、替换、路径脱敏
│  ├─ tools.js             # 工具描述过滤 + 工具名改名
│  ├─ messages.js          # system / developer / skill-catalog 文本过滤
│  ├─ request.js           # 克隆请求、生成报告
│  ├─ rule.js              # 规则编译（错误带上下文）
│  ├─ retry.js             # noRetryOn 否决 + 会话模型记忆
│  ├─ session.js           # 子代理识别
│  ├─ trace.js             # trace 写入与 dry-run 流
│  ├─ version.js           # 版本常量（与 package.json、git tag 一致）
│  └─ volatile.js          # 解包 loader 的 volatile 字段
├─ locale/{en,zh-CN}.json  # 插件列表展示
├─ icon.svg
├─ LICENSE                 # MIT
├─ CHANGELOG.md
├─ examples/cordis.patch.yml   # profile 覆盖示例（两类配置分开）
├─ examples/profile.yml
├─ data/plugins/lihongxu0221__dsh-prompt-filter.yml   # awesome-dsh-plugin 条目草稿
├─ .github/workflows/release.yml
├─ scripts/{audit-trace,build,check-version}.mjs
├─ test/                   # node --test（72 项）
└─ README.md
```

## 12. 许可

MIT License，见 [LICENSE](./LICENSE)。插件无运行时第三方依赖（`@deepseek-ai/*` 均为 peerDependencies，由 DSH 运行时提供）。

---

## 13. 发版与市场收录

### 13.1 安装方式（用户视角）

| 方式 | 命令 |
| --- | --- |
| 本地目录链接（开发） | `dsh plugin --profile desktop add "E:/AI/Agents/Deepseek Harness/DSH/dsh-prompt-filter"` |
| npm 预构建包 | `dsh plugin --profile desktop add dsh-prompt-filter` |
| Release tarball | 从 GitHub Release 下载 `dsh-prompt-filter.tgz`，再 `dsh plugin --profile desktop add ./dsh-prompt-filter.tgz` |

### 13.2 自动发版（GitHub Actions）

1. 确认 `package.json` 的 `version` 与 `lib/version.js` 的 `VERSION` 一致（`npm run build` 会检查）。
2. 一键发版：

```bash
npm version patch        # 或 minor / major，自动打 vX.Y.Z tag
git push --follow-tags
```

3. 推送 `vX.Y.Z` tag 后，`.github/workflows/release.yml` 会：安装依赖 → 构建 → 跑测试 → 校验 tag 与版本一致 → `npm pack` 打包 → 计算 SHA-256 → 创建**正式**（非草稿）GitHub Release，并附上：
   - `dsh-prompt-filter.tgz`（无版本号，供 `releases/latest/download/dsh-prompt-filter.tgz` 长期引用）；
   - `dsh-prompt-filter-<version>.tgz`；
   - `SHA256SUMS`。
4. 任一步失败都不会创建 Release。
5. 若仓库配置了 `NPM_TOKEN` secret，会顺带 `npm publish --access public`；没有令牌时该步骤跳过，不影响 Release。

### 13.3 dsh-market / awesome-dsh-plugin 收录清单

| 条件 | 状态 |
| --- | --- |
| 公开仓库、非官方本体、未归档、根目录真实代码 | ✅（GitHub `lihongxu0221/dsh-prompt-filter`） |
| `package.json` 声明 `dsh.bundle.patch` | ✅ |
| 官方 `@deepseek-ai/*` 在 `peerDependencies` | ✅（`@deepseek-ai/schemastery`） |
| 根目录 `cordis.patch.yml` | ✅ |
| GitHub topic `dsh-plugin`（建议再加 `deepseek-harness`、`dsh`） | ✅（已设置 `dsh-plugin` / `deepseek-harness` / `dsh`） |
| About 简介 | ✅（已填写功能描述） |
| LICENSE（MIT，与 `package.json` 一致） | ✅ |
| README 含功能/安装/两类配置示例/核对方法/兼容版本 | ✅ |
| awesome-dsh-plugin 条目草稿 `data/plugins/lihongxu0221__dsh-prompt-filter.yml` | ✅ |
| 界面截图清单 | ✅ `screenshots/README.md`（2 张：主面板配置、侧栏入口） |
| 首个 Release（含无版本号 `.tgz` 与校验和） | ✅（`v0.3.1` 已发布，附件 `dsh-prompt-filter.tgz` / `dsh-prompt-filter-0.3.1.tgz` / `SHA256SUMS`） |
| 仓库创建满 1 天后提交 PR | ⬜ 需等待满 1 天（提交 PR 前确认） |

提交 awesome-dsh-plugin PR 时只新增 `data/plugins/lihongxu0221__dsh-prompt-filter.yml`，不要改对方的 README；收录规则以当时最新的 awesome-dsh-plugin 贡献指南与 dsh-market `CONTRIBUTING.md` 为准。