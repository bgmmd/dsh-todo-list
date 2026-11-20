/**
 * Host-half integration test.
 *
 * Mounts the real `apply()` on a minimal fake Cordis context, invokes the
 * registered JSON routes with Node request/response stand-ins, and runs the
 * real `git` binary in throwaway repositories. No network and no browser.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { apply, buildPrompt, inject, parseTodoFile, serializeTodoFile } from '../index.js'

const SESSION_ID = 'session-test'
const ORIGIN = 'http://127.0.0.1:5566'
const ROUTE = '/dsh-todo/api'

/** Root of every fixture for one run. */
let root
/** A plain (non-Git) project directory. */
let plain
/** A Git work tree. */
let repo
/** A work tree whose .gitignore excludes the todo file. */
let ignoredRepo

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-todo-test-'))
  plain = join(root, 'plain')
  repo = join(root, 'repo')
  ignoredRepo = join(root, 'ignored')
  for (const dir of [plain, repo, ignoredRepo]) mkdirSync(dir, { recursive: true })
  for (const dir of [repo, ignoredRepo]) {
    git(dir, ['init', '-b', 'main'])
    git(dir, ['config', 'user.email', 'test@example.invalid'])
    git(dir, ['config', 'user.name', 'Todo Test'])
  }
  writeFileSync(join(ignoredRepo, '.gitignore'), '.todo.md\n')
})

after(() => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // Best effort.
  }
})

/** Run git and return stdout; fail loudly unless `allowFail`. */
function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (options.allowFail !== true) assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout ?? ''
}

/** Invoke one route handler with a fake Node request/response pair. */
function invoke(handler, body, options = {}) {
  return new Promise((resolve, reject) => {
    const request = new EventEmitter()
    request.method = options.method ?? 'POST'
    request.headers = { 'content-type': 'application/json', ...(options.headers ?? {}) }
    request.destroy = () => {}
    const response = {
      status: 0,
      writableEnded: false,
      writeHead(status) { this.status = status },
      end(payload) {
        this.writableEnded = true
        try {
          resolve({ status: this.status, body: JSON.parse(payload.toString('utf8')) })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(handler(request, response)).catch(reject)
    process.nextTick(() => {
      if (options.raw !== undefined) request.emit('data', Buffer.from(options.raw))
      else if (body !== undefined) request.emit('data', Buffer.from(JSON.stringify(body)))
      request.emit('end')
    })
  })
}

/** Create a fixture directory. */
function buildDir(dir) {
  mkdirSync(dir, { recursive: true })
}

/** Mount the plugin on a fake context covering the services it injects. */
function mount(cwd, config = {}, options = {}) {
  const routes = new Map()
  const followups = []
  const ctx = {
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      getOrigin: () => ORIGIN,
    },
    sessions: { get: (id) => (id === SESSION_ID ? { header: { cwd } } : undefined) },
    workingDirectory: { get: () => cwd },
    agents: {
      get: (id) => (id === SESSION_ID && options.live !== false ? { followup: (message) => followups.push(message) } : undefined),
    },
    effect(callback) {
      return callback()
    },
  }
  apply(ctx, config)
  return {
    routes,
    followups,
    call(action, body, requestOptions) {
      const route = routes.get(`${ROUTE}/${action}`)
      assert.ok(route !== undefined, `route ${action} is not registered`)
      return invoke(route.handler, body, requestOptions)
    },
  }
}

const todoFor = (cwd) => join(cwd, '.todo.md')

test('registers the three JSON routes and declares its services', () => {
  assert.deepEqual(inject, ['webServer', 'sessions', 'workingDirectory', 'agents'])
  const mounted = mount(plain)
  assert.deepEqual([...mounted.routes.keys()].sort(), [`${ROUTE}/load`, `${ROUTE}/save`, `${ROUTE}/send`])
})

test('a missing file loads as an empty, uncreated list', async () => {
  const mounted = mount(plain, { fileName: 'missing.md' })
  const result = await mounted.call('load', { sessionId: SESSION_ID })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  const state = result.body.state
  assert.equal(state.exists, false)
  assert.equal(state.managed, true)
  assert.deepEqual(state.todos, [])
  assert.equal(state.git.isRepo, false)
  assert.equal(state.hint.enabled, true)
})

test('save creates the file, and load reads the tasks back', async () => {
  const dir = join(root, 'create')
  buildDir(dir)
  const mounted = mount(dir)
  const saved = await mounted.call('save', {
    sessionId: SESSION_ID,
    todos: [{ text: '  第一项  ', done: false }, { text: '第二项', done: true }],
  })
  assert.equal(saved.body.ok, true, JSON.stringify(saved.body))
  assert.equal(saved.body.state.counts.open, 1)
  const text = readFileSync(todoFor(dir), 'utf8')
  assert.match(text, /<!-- dsh-todo:/)
  assert.match(text, /- \[ \] 第一项\n- \[x\] 第二项/)

  const loaded = await mounted.call('load', { sessionId: SESSION_ID })
  assert.equal(loaded.body.state.exists, true)
  assert.deepEqual(loaded.body.state.todos, [{ text: '第一项', done: false }, { text: '第二项', done: true }])
})

test('save preserves headings, notes, and comment lines around the checklist', async () => {
  const dir = join(root, 'preserve')
  buildDir(dir)
  writeFileSync(todoFor(dir), [
    '# Sprint 1',
    '',
    'Some context the team wrote.',
    '',
    '- [ ] keep me',
    '- [ ] change me',
    '- [ ] remove me',
    '',
    '## Notes',
    '',
    'A trailing note.',
  ].join('\n'))
  const mounted = mount(dir)
  const result = await mounted.call('save', {
    sessionId: SESSION_ID,
    todos: [{ text: 'keep me', done: true }, { text: 'changed', done: false }, { text: 'added', done: false }],
  })
  assert.equal(result.body.ok, true, JSON.stringify(result.body))
  const text = readFileSync(todoFor(dir), 'utf8')
  assert.match(text, /# Sprint 1/)
  assert.match(text, /Some context the team wrote\./)
  assert.match(text, /- \[x\] keep me/)
  assert.match(text, /- \[ \] changed/)
  assert.match(text, /- \[ \] added/)
  assert.doesNotMatch(text, /remove me/)
  assert.match(text, /A trailing note\./)
  assert.match(text, /<!-- dsh-todo:/)
})

test('an unmanaged same-name file is never rewritten', async () => {
  const dir = join(root, 'unmanaged')
  buildDir(dir)
  const file = join(dir, 'notes.md')
  writeFileSync(file, '# Notes\n\nThis is not a checklist.\n')
  const mounted = mount(dir, { fileName: 'notes.md' })
  const result = await mounted.call('save', { sessionId: SESSION_ID, todos: [{ text: 'task', done: false }] })
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error, 'unmanaged-file')
  assert.equal(readFileSync(file, 'utf8'), '# Notes\n\nThis is not a checklist.\n')
})

test('a fileName escaping the working directory is rejected', async () => {
  const mounted = mount(plain, { fileName: '../escape.md' })
  const result = await mounted.call('load', { sessionId: SESSION_ID })
  assert.equal(result.body.ok, false)
  assert.equal(result.body.error, 'invalid-file-name')
})

test('a Git work tree gets the file staged automatically', async () => {
  const mounted = mount(repo)
  const saved = await mounted.call('save', { sessionId: SESSION_ID, todos: [{ text: 'git task', done: false }] })
  assert.equal(saved.body.ok, true, JSON.stringify(saved.body))
  assert.equal(saved.body.state.git.isRepo, true)
  assert.equal(saved.body.state.git.tracked, true)
  assert.equal(saved.body.state.git.staged, true)
  const tracked = git(repo, ['ls-files'])
  assert.match(tracked, /\.todo\.md/)
})

test('a Git-ignored file is reported and left untracked', async () => {
  const mounted = mount(ignoredRepo)
  const saved = await mounted.call('save', { sessionId: SESSION_ID, todos: [{ text: 'ignored task', done: false }] })
  assert.equal(saved.body.ok, true, JSON.stringify(saved.body))
  assert.equal(saved.body.state.git.isRepo, true)
  assert.equal(saved.body.state.git.ignored, true)
  assert.equal(saved.body.state.git.tracked, false)
  assert.doesNotMatch(git(ignoredRepo, ['ls-files']), /\.todo\.md/)
})

test('send refuses an empty list, a fully done list, and an inactive session', async () => {
  const dir = join(root, 'send')
  buildDir(dir)
  const mounted = mount(dir)

  const empty = await mounted.call('send', { sessionId: SESSION_ID, locale: 'zh' })
  assert.equal(empty.body.error, 'empty-list')

  await mounted.call('save', { sessionId: SESSION_ID, todos: [{ text: 'done task', done: true }] })
  const allDone = await mounted.call('send', { sessionId: SESSION_ID, locale: 'zh' })
  assert.equal(allDone.body.error, 'no-open-items')

  await mounted.call('save', {
    sessionId: SESSION_ID,
    todos: [{ text: 'done task', done: true }, { text: 'open task', done: false }],
  })
  const offline = mount(dir, {}, { live: false })
  const inactive = await offline.call('send', { sessionId: SESSION_ID, locale: 'zh' })
  assert.equal(inactive.body.error, 'session-not-live')
  assert.equal(offline.followups.length, 0)
})

test('send injects one user-visible analysis message with the whole list', async () => {
  const dir = join(root, 'send-ok')
  buildDir(dir)
  const mounted = mount(dir)
  await mounted.call('save', {
    sessionId: SESSION_ID,
    todos: [{ text: '登录接口', done: true }, { text: '导出 CSV', done: false }],
  })
  const result = await mounted.call('send', { sessionId: SESSION_ID, locale: 'zh' })
  assert.equal(result.body.ok, true, JSON.stringify(result.body))
  assert.equal(mounted.followups.length, 1)
  const message = mounted.followups[0]
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'user' })
  const prompt = message.content[0].text
  assert.match(prompt, /导出 CSV/)
  assert.match(prompt, /登录接口/)
  assert.match(prompt, /结合已完成的 1 项/)
  assert.match(prompt, /实现上的风险与冲突/)
})

test('prompt template overrides the built-in copy', () => {
  const prompt = buildPrompt('en', {
    rel: '.todo.md',
    path: '/tmp/.todo.md',
    todos: [{ text: 'a', done: false }, { text: 'b', done: true }],
    counts: { total: 2, done: 1, open: 1 },
  }, { sendPromptTemplate: 'file={file} open={open} done={done} list={list}' })
  assert.equal(prompt, 'file=.todo.md open=1 done=1 list=- [ ] a\n- [x] b')
})

test('rejects unsafe requests', async () => {
  const mounted = mount(plain)
  const method = await mounted.call('load', { sessionId: SESSION_ID }, { method: 'GET' })
  assert.equal(method.status, 405)
  const crossSite = await mounted.call('load', { sessionId: SESSION_ID }, { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403)
  const wrongType = await mounted.call('load', { sessionId: SESSION_ID }, { headers: { 'content-type': 'text/plain' } })
  assert.equal(wrongType.status, 415)
  const badJson = await mounted.call('load', undefined, { raw: '{nope' })
  assert.equal(badJson.status, 400)
  const unknownSession = await mounted.call('load', { sessionId: 'nope' })
  assert.equal(unknownSession.body.error, 'session-not-found')
})

test('rejects invalid or oversized task payloads', async () => {
  const dir = join(root, 'limits')
  buildDir(dir)
  const mounted = mount(dir, { maxItems: 2, maxItemLength: 10 })
  const notArray = await mounted.call('save', { sessionId: SESSION_ID, todos: 'nope' })
  assert.equal(notArray.body.error, 'invalid-todos')
  const tooMany = await mounted.call('save', {
    sessionId: SESSION_ID,
    todos: [{ text: 'a', done: false }, { text: 'b', done: false }, { text: 'c', done: false }],
  })
  assert.equal(tooMany.body.error, 'too-many-items')
  const truncated = await mounted.call('save', { sessionId: SESSION_ID, todos: [{ text: 'abcdefghijklmno', done: false }] })
  assert.equal(truncated.body.ok, true, JSON.stringify(truncated.body))
  assert.equal(truncated.body.state.todos[0].text, 'abcdefghij')
})

test('parse and serialize keep a hand-written checklist coherent', () => {
  const original = '# My list\n\n- [ ] one\n- [x] two\n'
  assert.deepEqual(parseTodoFile(original).todos, [{ text: 'one', done: false }, { text: 'two', done: true }])
  const claimed = serializeTodoFile(original, [])
  assert.ok(claimed.includes('<!-- dsh-todo:'))
  assert.doesNotMatch(claimed, /- \[[ x]\]/)
  assert.deepEqual(parseTodoFile(claimed).todos, [])
  assert.equal(parseTodoFile(claimed).managed, true)
})

test('external edits are reported as a warning, not silently dropped', async () => {
  const dir = join(root, 'external')
  buildDir(dir)
  const mounted = mount(dir)
  const first = await mounted.call('save', { sessionId: SESSION_ID, todos: [{ text: 'one', done: false }] })
  assert.equal(first.body.ok, true)
  // Another writer changes the file, then this save is based on the old mtime.
  writeFileSync(todoFor(dir), '- [ ] one\n- [ ] added elsewhere\n')
  const saved = await mounted.call('save', {
    sessionId: SESSION_ID,
    todos: [{ text: 'one', done: true }, { text: 'added elsewhere', done: false }],
    knownMtimeMs: first.body.state.mtimeMs,
  })
  assert.equal(saved.body.ok, true, JSON.stringify(saved.body))
  assert.equal(saved.body.externalChanged, true)
  assert.match(readFileSync(todoFor(dir), 'utf8'), /- \[x\] one/)
})
