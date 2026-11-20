/**
 * Client-half structural test.
 *
 * `client.js` is a browser artifact: it registers a lazy factory on
 * `window.__ModuleLoader__`. This test installs that facade plus a minimal
 * React/DOM stand-in, then drives the real factory with a fake Client context to
 * verify the manifest contract, the tab-type registration, every slot
 * registration, the dictionaries, and the CSS the module installs.
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

const modules = new Map([['react', React]])

/** Build a fake Client context and capture everything the plugin registers. */
function makeContext() {
  const captured = {
    styles: installedStyles,
    dictionaries: [],
    tabTypes: [],
    injections: [],
    registrations: [],
    opened: [],
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
    sidebarRightTabs: {
      register(definition) {
        captured.tabTypes.push(definition)
        return () => {}
      },
    },
    sidebarRight: {
      openTab(kind) {
        captured.opened.push(kind)
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

test('declares the services the tab and the controller need', () => {
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
})

test('installs one stylesheet that uses theme tokens only', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  assert.equal(captured.styles.length, 1)
  const style = captured.styles[0]
  assert.equal(style.dataset.dshPlugin, 'dsh-todo-list')
  assert.match(style.textContent, /--dsw-alias-label-primary/)
  assert.match(style.textContent, /text-decoration: line-through/)
  assert.doesNotMatch(style.textContent, /#[0-9a-fA-F]{3,8}\b/, 'CSS must not hard-code colours')
})

test('registers the tab type with a guide entry', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  assert.equal(captured.tabTypes.length, 1)
  const definition = captured.tabTypes[0]
  assert.equal(definition.id, 'dsh-todo-list')
  assert.equal(definition.kind, 'dsh-todo-list')
  assert.equal(typeof definition.title, 'function')
  assert.equal(definition.title(''), 'tab.title')
  assert.equal(definition.guide.length, 1)
  assert.equal(definition.guide[0].id, 'todo')
  assert.equal(typeof definition.guide[0].order, 'number')
  assert.equal(typeof definition.guide[0].title, 'function')
  assert.equal(typeof definition.guide[0].icon, 'function')
})

test('registers the tab body, its live title, and the new-session hint', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  assert.deepEqual(captured.injections.sort(), [
    'conversation.hero.options',
    'sidebar.right.pane.tab',
    'sidebar.right.pane.tab.title',
  ])
  assert.equal(captured.registrations.length, 3)

  const body = captured.registrations.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
  assert.ok(body !== undefined)
  assert.equal(body.options.key, 'dsh-todo-list')
  assert.equal(body.options.locale, 'dshTodo')
  assert.equal(typeof body.component, 'function')
  const injected = body.options.inject('session-1')
  assert.equal(injected.sessionId, 'session-1')
  assert.equal(typeof injected.t, 'function')
  assert.equal(typeof injected.subscribe, 'function')
  assert.equal(typeof injected.getSnapshot, 'function')

  const title = captured.registrations.find((entry) => entry.options.name === 'sidebar.right.pane.tab.title')
  assert.ok(title !== undefined)
  assert.equal(title.options.key, 'dsh-todo-list')

  const hero = captured.registrations.find((entry) => entry.options.name === 'conversation.hero.options')
  assert.ok(hero !== undefined)
  assert.equal(hero.options.id, 'dsh-todo-list')
  const heroInjected = hero.options.inject('session-1')
  heroInjected.onOpen()
  assert.deepEqual(captured.opened, ['dsh-todo-list'])
})

test('registers both dictionaries with the same keys', () => {
  const { captured, ctx } = makeContext()
  plugin.apply(ctx)
  const found = new Map(captured.dictionaries.map((entry) => [entry.locale, entry.dict]))
  assert.deepEqual([...found.keys()].sort(), ['en', 'zh'])
  const enKeys = Object.keys(found.get('en')).sort()
  const zhKeys = Object.keys(found.get('zh')).sort()
  assert.deepEqual(zhKeys, enKeys)
  for (const key of ['tab.title', 'add.placeholder', 'send.label', 'send.success', 'empty.body', 'hint.empty', 'git.tracked', 'error.sessionNotLive']) {
    assert.equal(typeof found.get('en')[key], 'string')
    assert.equal(typeof found.get('zh')[key], 'string')
  }
  assert.equal(found.get('en')['tab.title'], 'Todo list')
  assert.equal(found.get('zh')['tab.title'], '待办清单')
})

test('manifest exports the client bundle and display metadata', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'dsh-todo-list')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.client.immediately, true)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
  assert.ok(manifest.files.includes('client.js'))
  assert.ok(manifest.files.includes('locale/*.json'))
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
  const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'))
  assert.equal(en.meta.title, 'Todo list')
  assert.equal(zh.meta.title, '待办清单')
  assert.ok(en.meta.description.length > 80)
  assert.ok(zh.meta.description.length > 40)
})
