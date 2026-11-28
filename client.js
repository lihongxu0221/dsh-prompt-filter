// Browser half of dsh-prompt-filter.
//
// Hand-written plain JS (no build step): the browser module table supplies
// React, and ui-primitives supplies the themed atoms. This module contributes
//   - the switchable sidebar entry and the `main` panel it opens;
//   - the plugin-page config cards (`plugins.row.config`, `plugins.bundle.config`);
//   - a Settings section that edits the same volatile config;
//   - the `/prompt-filter` command, which opens the panel even when the
//     sidebar entry is switched off.
//
// Every widget reads the live `configForms` snapshot and writes through
// `form.mutate(...)`, so edits land in the profile's Cordis patch and take
// effect without a restart.
window.__ModuleLoader__.load({
  id: '@lihongxu0221/dsh-prompt-filter',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    /**
     * Profile entry id: the patch row id and the settings namespace both use it.
     * The row's `name` is the scoped package name, so bundle-level slot keys use
     * the package name while row-level keys pair it with this entry id.
     */
    const NS = 'dsh-prompt-filter'
    const PANEL_ID = 'dsh-prompt-filter'
    const SECTION_ID = 'dsh-prompt-filter'
    const ROW_KEY = '@lihongxu0221/dsh-prompt-filter#dsh-prompt-filter'
    const BUNDLE_KEY = '@lihongxu0221/dsh-prompt-filter'
    const BOOLEAN_FIELDS = ['sidebarEntry', 'enabled', 'dryRun', 'debug', 'applyToSubagents']

    let primitives = {}
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives') || {}
    } catch {
      primitives = {}
    }

    const Button = primitives.Button || fallbackButton
    const Checkbox = primitives.Checkbox || fallbackCheckbox
    const Input = primitives.Input || fallbackInput

    function fallbackButton(props) {
      const { variant, size, icon, children, ...rest } = props
      return h('button', { type: 'button', ...rest }, children)
    }

    function fallbackCheckbox({ checked, onChange, label, disabled, title }) {
      return h(
        'label',
        { title, style: S.checkbox },
        h('input', {
          type: 'checkbox',
          checked: checked === true,
          disabled: disabled === true,
          onChange: event => onChange(event.target.checked),
        }),
        h('span', undefined, label),
      )
    }

    function fallbackInput(props) {
      const { icon, ...rest } = props
      return h('input', { ...rest, style: { ...S.input, ...rest.style } })
    }

    // ---------------------------------------------------------------- i18n ---

    const TEXTS = {
      zh: {
        nav: '提示词过滤',
        sectionNav: '提示词过滤',
        panelTitle: '提示词过滤器',
        panelIntro:
          '这里编辑发往 Gemini / Claude 的提示词过滤配置。所有改动都写入当前 profile 的 Cordis patch，保存后立即生效，无需重启。',
        settingsIntro: '与插件页面共用同一份配置；保存后立即生效。',
        rowIntro: '关闭侧栏入口后，仍可用 /prompt-filter 命令、插件页或本设置页打开。',
        rowSummary: '提示词过滤 · 侧栏入口',
        rowSummaryOn: '开',
        rowSummaryOff: '关',
        fieldSidebarEntry: '在左侧栏显示入口',
        hintSidebarEntry:
          '关闭后不再注册侧栏入口，仍可用 /prompt-filter 命令或插件页打开；该设置会持久化，重启后仍生效。',
        fieldEnabled: '启用过滤',
        hintEnabled: '关闭后监听仍在，但直接原样放行请求；侧栏入口与命令保留。',
        fieldDryRun: '只审计不发请求（dryRun）',
        hintDryRun: '打开后本轮以 PROMPT_FILTER_DRY_RUN 结束，不向上游发送请求。',
        fieldDebug: '写入 trace 文件',
        hintDebug: '过滤后的完整提示词会写入追踪目录，注意不要公开。',
        fieldApplyToSubagents: '同时应用于子代理',
        hintApplyToSubagents: '关闭后只过滤主会话的请求。',
        fieldTraceDir: '追踪目录',
        hintTraceDir: '留空时使用 DSH_HOME/dsh-prompt-filter/trace。',
        rulesTitle: '规则（JSON 数组）',
        rulesHint:
          '直接编辑规则数组，保存前会校验 JSON 与数组形状。每条规则支持 id、modelMatch、identityOverride、noRetryOn、scope、stripLines、replace。',
        openPanel: '打开面板',
        save: '保存',
        saving: '保存中…',
        saved: '已保存，立即生效。',
        refused: '保存被拒绝，请检查配置后重试。',
        nothing: '没有改动。',
        jsonError: 'JSON 解析失败：',
        rulesArrayError: '规则必须是 JSON 数组。',
        loading: '正在读取配置…',
        unavailable: '当前 profile 没有为这个插件提供配置表单。',
        notice: '提示',
        readOnly: '当前配置表单为只读，无法保存改动。',
        commandDescription: '打开提示词过滤器 / Open Prompt Filter',
      },
      en: {
        nav: 'Prompt Filter',
        sectionNav: 'Prompt Filter',
        panelTitle: 'Prompt Filter',
        panelIntro:
          'Edit the prompt-filter configuration applied to Gemini / Claude requests. Every change is written to this profile Cordis patch and takes effect immediately.',
        settingsIntro: 'Shares the same configuration as the plugin page; saves apply immediately.',
        rowIntro: 'With the sidebar entry off, /prompt-filter, this plugin page, and the settings page still open the panel.',
        rowSummary: 'Prompt filter · sidebar entry',
        rowSummaryOn: 'on',
        rowSummaryOff: 'off',
        fieldSidebarEntry: 'Show entry in the left sidebar',
        hintSidebarEntry:
          'When off, no sidebar entry is registered; the /prompt-filter command and the plugin page still open it. The setting is persisted and survives restarts.',
        fieldEnabled: 'Enable filtering',
        hintEnabled: 'When off, the listeners stay registered but pass requests through unchanged; GUI entries remain.',
        fieldDryRun: 'Audit only, send nothing (dryRun)',
        hintDryRun: 'The turn ends with PROMPT_FILTER_DRY_RUN instead of reaching the upstream model.',
        fieldDebug: 'Write trace files',
        hintDebug: 'The filtered prompt is written to the trace directory; do not publish it.',
        fieldApplyToSubagents: 'Apply to subagents too',
        hintApplyToSubagents: 'When off, only main-session requests are filtered.',
        fieldTraceDir: 'Trace directory',
        hintTraceDir: 'Leave empty to use DSH_HOME/dsh-prompt-filter/trace.',
        rulesTitle: 'Rules (JSON array)',
        rulesHint:
          'Edit the rules array directly; JSON and array shape are validated before saving. Each rule supports id, modelMatch, identityOverride, noRetryOn, scope, stripLines, replace.',
        openPanel: 'Open panel',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved and applied.',
        refused: 'Save refused; check the configuration and retry.',
        nothing: 'Nothing changed.',
        jsonError: 'Invalid JSON: ',
        rulesArrayError: 'Rules must be a JSON array.',
        loading: 'Reading configuration…',
        unavailable: 'This profile does not serve a configuration form for this plugin.',
        notice: 'Notice',
        readOnly: 'This configuration form is read-only; changes cannot be saved.',
        commandDescription: 'Open Prompt Filter',
      },
    }

    function tr(lang, key) {
      const dict = TEXTS[lang] || TEXTS.en
      return dict[key] !== undefined ? dict[key] : TEXTS.en[key] !== undefined ? TEXTS.en[key] : key
    }

    function readLang(ctx) {
      try {
        const locale = ctx.get('locale')
        const snapshot = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined
        const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'en'
        return active.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    function useLang(ctx) {
      const [lang, setLang] = useState(() => readLang(ctx))
      useEffect(() => {
        let locale
        try {
          locale = ctx.get('locale')
        } catch {
          locale = undefined
        }
        if (!locale || typeof locale.subscribe !== 'function') return undefined
        setLang(readLang(ctx))
        let dispose
        try {
          dispose = locale.subscribe(() => setLang(readLang(ctx)))
        } catch {
          dispose = undefined
        }
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, [ctx])
      return lang
    }

    // ------------------------------------------------------- config form ----

    function service(ctx, name) {
      try {
        return ctx.get(name)
      } catch {
        return undefined
      }
    }

    function formOf(ctx) {
      const forms = service(ctx, 'configForms')
      if (!forms || typeof forms.get !== 'function') return undefined
      try {
        return forms.get(NS)
      } catch {
        return undefined
      }
    }

    function readSnapshot(form) {
      if (!form || typeof form.getSnapshot !== 'function') return undefined
      try {
        return form.getSnapshot()
      } catch {
        return undefined
      }
    }

    function subscribeForm(form, listener) {
      if (!form || typeof form.subscribe !== 'function') return undefined
      try {
        return form.subscribe(listener)
      } catch {
        return undefined
      }
    }

    function useSnapshot(form, fallback) {
      const [snap, setSnap] = useState(() => readSnapshot(form) || fallback)
      useEffect(() => {
        const live = readSnapshot(form) || fallback
        setSnap(live)
        const dispose = subscribeForm(form, () => setSnap(readSnapshot(form) || fallback))
        return () => {
          if (typeof dispose === 'function') dispose()
        }
      }, [form])
      return snap
    }

    // The bubble patch ships `sidebarEntry: true`, so the entry is visible
    // until the configuration explicitly says otherwise: a shell that serves
    // no config form still gets the entry, and a user who turned it off gets
    // it removed as soon as the snapshot turns ready.
    function sidebarEnabledFor(form) {
      const snap = readSnapshot(form)
      if (!snap || snap.status !== 'ready' || !snap.value) return true
      return snap.value.sidebarEntry !== false
    }

    function openPanel(ctx) {
      const layout = service(ctx, 'layout')
      try {
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
      } catch {
        // The panel may be unavailable in this shell; the caller keeps working.
      }
    }

    // --------------------------------------------------------- components ---

    function PanelIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M3 5h18l-7 8v5.5L10 21v-8z' }),
        h('path', { d: 'M7 9h10' }),
      )
    }

    function ConfigCard({ ctx, lang, form, stateFallback, mutateFallback, surface }) {
      const t = key => tr(lang, key)
      const live = useSnapshot(form, stateFallback)
      const snap = form ? live : stateFallback
      const [draft, setDraft] = useState(null)
      const [rulesText, setRulesText] = useState('[]')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)

      const status = snap && snap.status ? snap.status : 'unavailable'
      const value = status === 'ready' && snap.value && typeof snap.value === 'object' ? snap.value : undefined
      const writable = value && snap.writable !== false
      const revision = snap ? snap.revision : undefined

      useEffect(() => {
        if (!value) {
          setDraft(null)
          return
        }
        const next = {}
        for (const field of BOOLEAN_FIELDS) next[field] = value[field] === true
        next.traceDir = typeof value.traceDir === 'string' ? value.traceDir : ''
        setDraft(next)
        setRulesText(JSON.stringify(Array.isArray(value.rules) ? value.rules : [], null, 2))
        setError(null)
        setNotice(null)
      }, [revision, status])

      const setField = (field, next) => setDraft(current => (current ? { ...current, [field]: next } : current))

      const save = async () => {
        if (!value || !draft || !writable) return
        const mutate = form && typeof form.mutate === 'function' ? (ops, rev) => form.mutate(ops, rev) : mutateFallback
        if (typeof mutate !== 'function') {
          setError(t('unavailable'))
          return
        }
        let rules
        try {
          rules = JSON.parse(rulesText)
        } catch (cause) {
          setError(t('jsonError') + (cause && cause.message ? cause.message : String(cause)))
          return
        }
        if (!Array.isArray(rules)) {
          setError(t('rulesArrayError'))
          return
        }
        const ops = []
        for (const field of BOOLEAN_FIELDS) {
          if (draft[field] !== (value[field] === true)) ops.push({ op: 'set', path: [field], value: draft[field] })
        }
        const traceDir = typeof draft.traceDir === 'string' ? draft.traceDir : ''
        if (traceDir !== (typeof value.traceDir === 'string' ? value.traceDir : '')) {
          ops.push({ op: 'set', path: ['traceDir'], value: traceDir })
        }
        if (rulesText !== JSON.stringify(Array.isArray(value.rules) ? value.rules : [], null, 2)) {
          ops.push({ op: 'set', path: ['rules'], value: rules })
        }
        if (ops.length === 0) {
          setError(null)
          setNotice(t('nothing'))
          return
        }
        setBusy(true)
        setError(null)
        setNotice(null)
        try {
          const accepted = await mutate(ops, revision)
          setNotice(accepted ? t('saved') : t('refused'))
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause))
        } finally {
          setBusy(false)
        }
      }

      if (surface === 'summary') {
        const on = value ? value.sidebarEntry !== false : true
        return h(
          'span',
          { style: S.summary },
          t('rowSummary') + ' · ' + (on ? t('rowSummaryOn') : t('rowSummaryOff')),
        )
      }

      if (status === 'loading') {
        return h('div', { style: S.hint }, t('loading'))
      }
      if (!value) {
        return h('div', { style: S.hint }, t('unavailable'))
      }

      const toggle = (field, labelKey, hintKey) =>
        h(
          'div',
          { style: S.group, key: field },
          h(Checkbox, {
            checked: draft ? draft[field] === true : value[field] === true,
            label: t(labelKey),
            disabled: busy || !writable,
            onChange: next => setField(field, next),
          }),
          h('div', { style: S.hint }, t(hintKey)),
        )

      return h(
        'div',
        { style: S.card },
        !writable ? h('div', { style: S.hint }, t('readOnly')) : null,
        h(
          'div',
          { style: S.group },
          h('div', { style: S.label }, t('fieldTraceDir')),
          h(Input, {
            value: draft ? draft.traceDir : '',
            disabled: busy || !writable,
            placeholder: 'DSH_HOME/dsh-prompt-filter/trace',
            onChange: event => setField('traceDir', event.target.value),
            style: { width: '100%' },
          }),
          h('div', { style: S.hint }, t('hintTraceDir')),
        ),
        toggle('sidebarEntry', 'fieldSidebarEntry', 'hintSidebarEntry'),
        toggle('enabled', 'fieldEnabled', 'hintEnabled'),
        toggle('dryRun', 'fieldDryRun', 'hintDryRun'),
        toggle('debug', 'fieldDebug', 'hintDebug'),
        toggle('applyToSubagents', 'fieldApplyToSubagents', 'hintApplyToSubagents'),
        h(
          'div',
          { style: S.group },
          h('div', { style: S.label }, t('rulesTitle')),
          h('div', { style: S.hint }, t('rulesHint')),
          h('textarea', {
            value: rulesText,
            disabled: busy || !writable,
            spellCheck: false,
            rows: Math.min(24, Math.max(6, rulesText.split('\n').length)),
            onChange: event => setRulesText(event.target.value),
            style: S.textarea,
          }),
        ),
        error ? h('div', { style: S.error }, error) : null,
        notice ? h('div', { style: S.ok }, notice) : null,
        h(
          'div',
          { style: S.actions },
          surface === 'row' || surface === 'bundle'
            ? h(Button, { variant: 'outline', size: 'sm', onClick: () => openPanel(ctx) }, t('openPanel'))
            : null,
          h(
            Button,
            { variant: 'primary', size: 'sm', disabled: busy || !writable, onClick: save },
            busy ? t('saving') : t('save'),
          ),
        ),
      )
    }

    function PanelPage({ ctx }) {
      const lang = useLang(ctx)
      const t = key => tr(lang, key)
      return h(
        'div',
        { style: S.page },
        h('div', { style: S.header }, h('h2', { style: S.title }, t('panelTitle'))),
        h('p', { style: S.intro }, t('panelIntro')),
        h(ConfigCard, { ctx, lang, form: formOf(ctx), surface: 'panel' }),
      )
    }

    function SettingsSection({ ctx }) {
      const lang = useLang(ctx)
      const t = key => tr(lang, key)
      return h(
        'div',
        { style: S.page },
        h('h2', { style: S.title }, t('panelTitle')),
        h('p', { style: S.intro }, t('settingsIntro')),
        h(ConfigCard, { ctx, lang, form: formOf(ctx), surface: 'settings' }),
      )
    }

    function RowConfig(props) {
      // The row page hands over `{ view, form }`, where `form` is the same
      // ConfigPageForm the page uses: a live snapshot plus a bound mutate.
      const { ctx, view, form } = props
      const lang = useLang(ctx)
      const state = form && form.state ? form.state : undefined
      const mutateFallback = form && typeof form.mutate === 'function' ? form.mutate : undefined
      return h(
        'div',
        { style: S.card },
        view === 'page' ? h('div', { style: S.hint }, tr(lang, 'rowIntro')) : null,
        h(ConfigCard, {
          ctx,
          lang,
          form: formOf(ctx),
          stateFallback: state,
          mutateFallback,
          surface: view === 'summary' ? 'summary' : 'row',
        }),
      )
    }

    function BundleConfig(props) {
      const { ctx } = props
      const lang = useLang(ctx)
      return h(
        'div',
        { style: S.card },
        h(ConfigCard, { ctx, lang, form: formOf(ctx), surface: 'bundle' }),
      )
    }

    // ------------------------------------------------------------- styles ---

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 18px', maxWidth: '760px' },
      header: { display: 'flex', alignItems: 'center', gap: '10px' },
      title: { margin: 0, fontSize: '17px', fontWeight: 600 },
      intro: { margin: 0, fontSize: '13px', lineHeight: 1.5, opacity: 0.75 },
      card: { display: 'flex', flexDirection: 'column', gap: '12px' },
      group: { display: 'flex', flexDirection: 'column', gap: '4px' },
      label: { fontSize: '13px', fontWeight: 600 },
      hint: { fontSize: '12px', lineHeight: 1.45, opacity: 0.7 },
      checkbox: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' },
      input: {
        boxSizing: 'border-box',
        padding: '6px 8px',
        fontSize: '13px',
        color: 'inherit',
        background: 'rgba(127,127,127,0.08)',
        border: '1px solid rgba(127,127,127,0.35)',
        borderRadius: '6px',
      },
      textarea: {
        boxSizing: 'border-box',
        width: '100%',
        padding: '8px',
        fontSize: '12px',
        lineHeight: 1.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        color: 'inherit',
        background: 'rgba(127,127,127,0.08)',
        border: '1px solid rgba(127,127,127,0.35)',
        borderRadius: '6px',
        resize: 'vertical',
      },
      error: { fontSize: '12px', lineHeight: 1.45, color: '#d9534f', whiteSpace: 'pre-wrap' },
      ok: { fontSize: '12px', lineHeight: 1.45, opacity: 0.8 },
      actions: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' },
      summary: { fontSize: '13px', opacity: 0.85 },
    }

    // -------------------------------------------------------------- apply ---

    function installSidebar(ctx) {
      let entry = null
      let desired = null
      let applied = null
      let inSlot = false

      const applyEntry = on => {
        if (typeof on !== 'boolean') return
        desired = on
        if (!inSlot) return // wait until the sidebar slot declaration exists
        if (on === applied) return
        if (entry) {
          entry()
          entry = null
        }
        applied = on
        if (!on) return
        try {
          entry = ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 31, label: () => tr(readLang(ctx), 'nav') },
            PanelIcon,
          )
        } catch (error) {
          applied = null
          try {
            console.error('[dsh-prompt-filter] sidebar registration failed', error)
          } catch {}
        }
      }

      const sync = () => applyEntry(sidebarEnabledFor(formOf(ctx)))

      ctx.slots.inject('sidebar.panellist', () => {
        inSlot = true
        applyEntry(desired === null ? sidebarEnabledFor(formOf(ctx)) : desired)
        const dispose = subscribeForm(formOf(ctx), sync)
        return () => {
          inSlot = false
          if (typeof dispose === 'function') dispose()
          if (entry) {
            entry()
            entry = null
          }
          applied = null
        }
      })

      // configForms may arrive after the sidebar slot; reconcile when it does.
      ctx.inject(['configForms'], sctx => {
        sctx.effect(() => {
          let forms
          try {
            forms = sctx.get('configForms')
          } catch {
            return undefined
          }
          if (!forms || typeof forms.get !== 'function') return undefined
          const form = forms.get(NS)
          sync()
          const dispose = subscribeForm(form, sync)
          return () => {
            if (typeof dispose === 'function') dispose()
          }
        }, 'prompt-filter: sidebar entry follows config')
      })
    }

    function installCommand(ctx) {
      ctx.inject(['commandUi'], sctx => {
        sctx.effect(() => {
          let command
          try {
            command = sctx.get('commandUi')
          } catch {
            return undefined
          }
          if (!command || typeof command.register !== 'function') return undefined
          const dispose = command.register({
            name: 'prompt-filter',
            description: () => tr(readLang(ctx), 'commandDescription'),
            available: () => true,
            ui: { kind: 'action', run: () => openPanel(ctx) },
          })
          return () => {
            if (typeof dispose === 'function') dispose()
          }
        }, 'prompt-filter: slash command')
      })
    }

    function apply(ctx) {
      const guard = (name, fn) => {
        try {
          fn()
        } catch (error) {
          try {
            console.error(`[dsh-prompt-filter] ${name} failed`, error)
          } catch {}
        }
      }

      guard('main', () =>
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, () => h(PanelPage, { ctx })),
        ),
      )

      guard('settings.section', () =>
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: 55,
              label: () => tr(readLang(ctx), 'sectionNav'),
            },
            () => h(SettingsSection, { ctx }),
          ),
        ),
      )

      guard('settings.section.icon', () =>
        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register({ name: 'settings.section.icon', id: SECTION_ID }, PanelIcon),
        ),
      )

      guard('plugins.row.config', () =>
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY }, props => h(RowConfig, { ctx, ...props })),
        ),
      )

      guard('plugins.bundle.config', () =>
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register({ name: 'plugins.bundle.config', key: BUNDLE_KEY }, props => h(BundleConfig, { ctx, ...props })),
        ),
      )

      guard('installSidebar', () => installSidebar(ctx))
      guard('installCommand', () => installCommand(ctx))
    }

    return { inject: ['slots'], apply }
  },
})