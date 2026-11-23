/**
 * Client-half structural test.
 *
 * `client.js` is a browser artifact: it registers a lazy factory on
 * `window.__ModuleLoader__`. This test installs that facade plus a minimal
 * React/DOM stand-in, then drives the real factory with a fake Client context to
 * verify the manifest contract, the header trigger, the dropdown host, the
 * new-session hint, the dictionaries, and the CSS the module installs.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** Collected `__ModuleLoader__.load()` calls. */
const loaded = []
/** Style elements appended to the fake document head. */
const installedStyles = []

globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded.push(module)
    },
  },
}

globalThis.document = {
  createElement() {
    return {
      dataset: {},
      textContent: '',
      remove() {
        const at = installedStyles.indexOf(this)
        if (at >= 0) installedStyles.splice(at, 1)
      },
    }
  },
  head: {
    appendChild(element) {
      installedStyles.push(element)
    },
  },
}

// A fresh module instance: the artifact runs once when it is imported.
await import('../client.js')

/** Minimal React face: the factory only defines components at load time. */
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(factory) {
    return factory()
  },
  useCallback(callback) {
    return callback
  },
  useRef(value) {
    return { current: value }
  },
  useSyncExternalStore() {},
}

const modules = new Map([
  ['react', React],
  ['react-dom', { createPortal: (element) => element }],
])

/** Build a fake Client context and capture everything the plugin registers. */
function makeContext() {
  const captured = {
    styles: installedStyles,
    dictionaries: [],
    injections: [],
    registrations: [],
  }
  const ctx = {
    effect(callback) {
      return callback()
    },
    locale: {
      register(ns, locale, dict) {
        captured.dictionaries.push({ ns, locale, dict })
        return () => {}
      },
      bind() {
        return (key) => key
      },
      subscribe() {
        return () => {}
      },
      getSnapshot() {
        return { active: 'zh' }
      },
    },
    slots: {
      inject(key, callback) {
        captured.injections.push(key)
        callback()
        return () => {}
      },
      register(options, component) {
        captured.registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { captured, ctx }
}

const plugin = loaded[0].factory((id) => {
  assert.ok(modules.has(id), `unexpected require(${id})`)
  return modules.get(id)
})

test('registers exactly one browser module under the package name', () => {
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-todo-list')
  assert.equal(typeof loaded[0].factory, 'function')
})

test('declares only the slots and locale services', () => {
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
})

test('installs one stylesheet that uses theme tokens only', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  assert.equal(captured.styles.length, 1)
  const style = captured.styles[0]
  assert.equal(style.dataset.dshPlugin, 'dsh-todo-list')
  assert.match(style.textContent, /\.dsh-todo-dd\b/)
  assert.match(style.textContent, /position: fixed/)
  assert.match(style.textContent, /--dsw-alias-label-primary/)
  assert.match(style.textContent, /text-decoration: line-through/)
  assert.doesNotMatch(style.textContent, /#[0-9a-fA-F]{3,8}\b/, 'CSS must not hard-code colours')
})

test('registers the header trigger, the dropdown host, and the new-session hint', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  assert.deepEqual(captured.injections.sort(), [
    'conversation.hero.options',
    'conversation.input.overlay',
    'conversation.session.header.utilities',
  ])
  assert.equal(captured.registrations.length, 3)

  const trigger = captured.registrations.find((entry) => entry.options.name === 'conversation.session.header.utilities')
  assert.ok(trigger !== undefined)
  assert.equal(trigger.options.id, 'dsh-todo-list')
  assert.equal(typeof trigger.options.order, 'number')
  assert.equal(trigger.options.locale, 'dshTodo')
  assert.equal(typeof trigger.component, 'function')
  const triggerInjected = trigger.options.inject('session-1')
  assert.equal(triggerInjected.sessionId, 'session-1')
  assert.equal(typeof triggerInjected.t, 'function')
  assert.equal(typeof triggerInjected.subscribe, 'function')
  assert.equal(typeof triggerInjected.getSnapshot, 'function')

  const host = captured.registrations.find((entry) => entry.options.name === 'conversation.input.overlay')
  assert.ok(host !== undefined)
  assert.equal(host.options.id, 'dsh-todo-list-panel')
  assert.equal(typeof host.component, 'function')
  assert.equal(host.options.inject('session-1').sessionId, 'session-1')

  const hero = captured.registrations.find((entry) => entry.options.name === 'conversation.hero.options')
  assert.ok(hero !== undefined)
  assert.equal(hero.options.id, 'dsh-todo-list')
  assert.equal(typeof hero.component, 'function')
})

test('registers both dictionaries with the same keys', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  const found = new Map(captured.dictionaries.map((entry) => [entry.locale, entry.dict]))
  assert.deepEqual([...found.keys()].sort(), ['en', 'zh'])
  const enKeys = Object.keys(found.get('en')).sort()
  const zhKeys = Object.keys(found.get('zh')).sort()
  assert.deepEqual(zhKeys, enKeys)
  for (const key of ['panel.title', 'trigger.label', 'add.placeholder', 'send.label', 'send.success', 'empty.body', 'hint.empty', 'git.tracked', 'error.sessionNotLive']) {
    assert.equal(typeof found.get('en')[key], 'string')
    assert.equal(typeof found.get('zh')[key], 'string')
  }
  assert.equal(found.get('en')['trigger.label'], 'Todo')
  assert.equal(found.get('zh')['trigger.label'], '待办')
  assert.equal(found.get('zh')['panel.title'], '待办清单')
})

test('manifest exports the client bundle and display metadata', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'dsh-todo-list')
  assert.equal(manifest.version, '0.2.0')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'))
  assert.ok(!manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
  assert.ok(manifest.files.includes('client.js'))
  assert.ok(manifest.files.includes('locale/*.json'))
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
  const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'))
  assert.equal(en.meta.title, 'Todo list')
  assert.equal(zh.meta.title, '待办清单')
  assert.match(en.meta.description, /dropdown/i)
  assert.match(zh.meta.description, /下拉面板/)
  assert.ok(en.meta.description.length > 80)
  assert.ok(zh.meta.description.length > 40)
})
