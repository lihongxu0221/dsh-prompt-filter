import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/** Load the browser half the way the module loader does, without a browser. */
function loadClientModule() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let definition
  const windowStub = {
    __ModuleLoader__: {
      load(next) {
        definition = next
      },
    },
  }
  // The module is a browser script, so evaluate it against a stub window.
  new Function('window', 'document', 'require', 'console', source)(windowStub, undefined, () => ({}), console)
  assert.ok(definition, 'client.js did not register itself with __ModuleLoader__')
  return definition
}

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useEffect() {},
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
}

const primitivesStub = {
  Button: props => ReactStub.createElement('button', props),
  Checkbox: props => ReactStub.createElement('input', props),
  Input: props => ReactStub.createElement('input', props),
}

function makeCtx(services) {
  const slots = []
  const disposals = []
  const slotInjections = []
  const contextInjections = []
  const ctx = {
    slots: {
      register(options, component) {
        const registration = { options, component }
        slots.push(registration)
        const dispose = () => {
          const index = slots.indexOf(registration)
          if (index >= 0) slots.splice(index, 1)
        }
        disposals.push(dispose)
        return dispose
      },
      inject(name, callback) {
        slotInjections.push({ name, callback })
        return () => {}
      },
    },
    inject(deps, callback) {
      contextInjections.push({ deps, callback })
      return () => {}
    },
    effect(callback) {
      return callback()
    },
    get(name) {
      return services ? services[name] : undefined
    },
  }
  return { ctx, slots, slotInjections, contextInjections }
}

function readyForm(value) {
  const listeners = new Set()
  const form = {
    getSnapshot: () => ({ status: 'ready', value, revision: 1, writable: true }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async () => true,
  }
  return { form, listeners }
}

test('client.js registers the panel, settings page, config cards, and command', () => {
  const definition = loadClientModule()
  assert.equal(definition.id, 'dsh-prompt-filter')
  const plugin = definition.factory(name => (name === 'react' ? ReactStub : primitivesStub))
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(typeof plugin.apply, 'function')

  const { ctx, slots, slotInjections, contextInjections } = makeCtx({})
  plugin.apply(ctx)

  // The main panel and the settings section are always available, so the
  // command and the plugin page can open the panel with the sidebar off.
  for (const { name, callback } of slotInjections) callback()
  const bySlot = slotName => slotInjections.find(injection => injection.name === slotName)
  assert.ok(bySlot('main'))
  assert.ok(bySlot('settings.section'))
  assert.ok(bySlot('settings.section.icon'))
  assert.ok(bySlot('plugins.row.config'))
  assert.ok(bySlot('plugins.bundle.config'))
  assert.ok(bySlot('sidebar.panellist'))

  const registered = name => slots.filter(entry => entry.options.name === name)
  assert.equal(registered('main')[0].options.key, 'dsh-prompt-filter')
  assert.equal(registered('settings.section')[0].options.id, 'dsh-prompt-filter')
  assert.equal(registered('plugins.row.config')[0].options.key, 'dsh-prompt-filter#dsh-prompt-filter')
  assert.equal(registered('plugins.bundle.config')[0].options.key, 'dsh-prompt-filter')
  // Sidebar entry defaults to on while no configuration form is served.
  assert.equal(registered('sidebar.panellist').length, 1)

  const commandInjection = contextInjections.find(injection => injection.deps.includes('commandUi'))
  assert.ok(commandInjection)
})

test('the sidebar entry follows the persisted setting and the command still opens the panel', () => {
  const definition = loadClientModule()
  const plugin = definition.factory(name => (name === 'react' ? ReactStub : primitivesStub))

  const selected = []
  const { form } = readyForm({ sidebarEntry: false })
  let command
  const services = {
    layout: { selectPanel: id => selected.push(id) },
    configForms: { get: () => form },
    commandUi: {
      register(contribution) {
        if (contribution.name === 'prompt-filter') command = contribution
        return () => {}
      },
    },
  }
  const { ctx, slots, slotInjections, contextInjections } = makeCtx(services)
  plugin.apply(ctx)

  for (const { name, callback } of slotInjections) {
    if (name === 'sidebar.panellist') callback()
  }
  assert.equal(slots.filter(entry => entry.options.name === 'sidebar.panellist').length, 0)

  // The panel itself stays registered, so the slash command opens it.
  const mainInjection = slotInjections.find(injection => injection.name === 'main')
  mainInjection.callback()
  assert.equal(slots.filter(entry => entry.options.name === 'main').length, 1)

  const commandInjection = contextInjections.find(injection => injection.deps.includes('commandUi'))
  assert.ok(commandInjection)
  commandInjection.callback({ get: name => services[name], effect: callback => callback() })
  assert.equal(typeof command.description(), 'string')
  command.ui.run()
  assert.deepEqual(selected, ['dsh-prompt-filter'])
})
test('a live sidebarEntry change registers and removes the entry', () => {
  const definition = loadClientModule()
  const plugin = definition.factory(name => (name === 'react' ? ReactStub : primitivesStub))

  const listeners = new Set()
  const state = { status: 'ready', value: { sidebarEntry: true }, revision: 1, writable: true }
  const form = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async () => true,
  }
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const { ctx, slots, slotInjections } = makeCtx({ configForms: { get: () => form } })
  plugin.apply(ctx)
  for (const { name, callback } of slotInjections) {
    if (name === 'sidebar.panellist') callback()
  }
  const count = () => slots.filter(entry => entry.options.name === 'sidebar.panellist').length
  assert.equal(count(), 1)

  state.value = { sidebarEntry: false }
  notify()
  assert.equal(count(), 0)

  state.value = { sidebarEntry: true }
  notify()
  assert.equal(count(), 1)
})
