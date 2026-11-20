/**
 * Host half of the `dsh-todo-list` bundle.
 *
 * Owns the todo file and the operations the right-sidebar panel needs:
 *
 * - `load` — read the project's todo file, its task counts, and its Git state;
 * - `save` — rewrite only the checklist lines, keeping every other line, and
 *   make sure the file is tracked by Git when the project is a work tree;
 * - `send` — hand a structured requirement-analysis prompt to the current Agent
 *   as one ordinary user message.
 *
 * The file is the single source of truth: the Client never invents state, and
 * a manual edit (by the user, a collaborator, or the AI) is picked up by the
 * next read. The Client reaches these routes over same-origin JSON paths on
 * `ctx.webServer`; DSH builds its typed `ctx.remote` namespaces at build time,
 * so a runtime bundle cannot add one of its own.
 *
 * @module dsh-todo-list
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

/** Same-origin JSON API namespace owned by this plugin. */
const ROUTE_PREFIX = '/dsh-todo/api'
/** Reject oversized request bodies early; every accepted body is small JSON. */
const MAX_BODY_BYTES = 128 * 1024
/** Marker line identifying this plugin as the file's manager. */
const TODO_MARKER = '<!-- dsh-todo:'
/** One Markdown task line: indentation, bullet, checkbox, text. */
const TASK_LINE = /^(\s*)([-*+])\s+\[( |x|X)\]\s+(.*?)\s*$/

/** Services this bundle needs before it activates. */
export const inject = ['webServer', 'sessions', 'workingDirectory', 'agents']

/** Defaults merged over the Loader row's `config`. */
const DEFAULTS = {
  /** Todo file, relative to the Session working directory. */
  fileName: '.todo.md',
  /** Add the file to Git tracking when the project is a work tree. */
  gitTrack: true,
  /** Offer the light entry on a blank new session. */
  hintOnNewSession: true,
  /** Maximum tasks one save may write. */
  maxItems: 200,
  /** Maximum characters kept per task (longer text is truncated). */
  maxItemLength: 500,
  /** Optional prompt template; supports {file}, {total}, {done}, {open}, {list}, {completed}. */
  sendPromptTemplate: '',
  /** Timeout for one git invocation. */
  gitTimeoutMs: 20000,
}

/** Cached Git facts, keyed by directory and relative file path. */
const gitCache = new Map()

/**
 * Register the todo routes.
 * @param ctx - the plugin context.
 * @param config - the Loader row config, merged over {@link DEFAULTS}.
 */
export function apply(ctx, config) {
  const settings = resolveConfig(config)
  const mount = (action) => ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE_PREFIX}/${action}`,
      handler: (request, response) => serve(ctx, settings, action, request, response),
    }),
    `dsh-todo-list: ${action} route`,
  )
  mount('load')
  mount('save')
  mount('send')
}

/**
 * Run one request end to end: admit it, resolve the Session, dispatch, and
 * write one JSON response. A thrown error becomes a protocol error so a defect
 * never leaves a hung browser request.
 */
async function serve(ctx, settings, action, request, response) {
  try {
    if (request.method !== 'POST') {
      return writeJson(response, 405, { ok: false, error: 'method-not-allowed' })
    }
    if (!isTrustedRequest(ctx, request)) {
      return writeJson(response, 403, { ok: false, error: 'forbidden' })
    }
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return writeJson(response, 415, { ok: false, error: 'unsupported-media-type' })
    }

    const body = await readJsonBody(request)
    if (body === undefined || typeof body !== 'object' || body === null) {
      return writeJson(response, 400, { ok: false, error: 'invalid-body' })
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const cwd = resolveSessionDirectory(ctx, sessionId)
    if (cwd === undefined) {
      return writeJson(response, 200, { ok: false, error: 'session-not-found' })
    }
    const scope = { sessionId, cwd, locale: body.locale === 'zh' ? 'zh' : 'en' }

    switch (action) {
      case 'load':
        return writeJson(response, 200, await loadOf(settings, scope))
      case 'save':
        return writeJson(response, 200, await saveOf(settings, scope, body))
      case 'send':
        return writeJson(response, 200, await sendOf(ctx, settings, scope))
      default:
        return writeJson(response, 404, { ok: false, error: 'unknown-action' })
    }
  } catch (error) {
    writeJson(response, 500, { ok: false, error: 'internal-error', detail: describe(error) })
  }
}

/** Read the todo state; never writes. */
async function loadOf(settings, scope) {
  const state = readState(settings, scope.cwd)
  if (state.error !== undefined) return { ok: false, error: state.error }
  const git = await inspectGit(settings, scope.cwd, state.rel)
  return { ok: true, state: stateView(state, settings, git) }
}

/** Write only the checklist lines, then make sure Git tracks the file. */
async function saveOf(settings, scope, body) {
  const todos = sanitizeTodos(body.todos, settings)
  if (todos === undefined) return { ok: false, error: 'invalid-todos' }
  if (todos.length > settings.maxItems) {
    return { ok: false, error: 'too-many-items', limit: settings.maxItems }
  }

  const before = readState(settings, scope.cwd)
  if (before.error !== undefined) return { ok: false, error: before.error }
  if (before.exists && !before.parsed.managed) {
    return { ok: false, error: 'unmanaged-file', file: fileView(before) }
  }

  const known = typeof body.knownMtimeMs === 'number' && Number.isFinite(body.knownMtimeMs)
    ? body.knownMtimeMs
    : undefined
  const externalChanged = known !== undefined && before.exists && Math.abs(before.mtimeMs - known) > 1

  const content = serializeTodoFile(before.raw, todos)
  if (content === undefined) {
    return { ok: false, error: 'unmanaged-file', file: fileView(before) }
  }

  writeFileAtomic(before.path, content)
  const git = await ensureGitTracked(settings, scope.cwd, before.rel)
  const after = readState(settings, scope.cwd)
  if (after.error !== undefined) return { ok: false, error: after.error }
  return { ok: true, externalChanged, state: stateView(after, settings, git) }
}

/** Send the checklist to the current Agent as one user-visible follow-up message. */
async function sendOf(ctx, settings, scope) {
  const state = readState(settings, scope.cwd)
  if (state.error !== undefined) return { ok: false, error: state.error }
  if (!state.exists || !state.parsed.managed || state.counts.total === 0) {
    return { ok: false, error: 'empty-list' }
  }
  if (state.counts.open === 0) {
    return { ok: false, error: 'no-open-items', counts: state.counts }
  }
  const agent = ctx.agents.get(scope.sessionId)
  if (agent === undefined || typeof agent.followup !== 'function') {
    return { ok: false, error: 'session-not-live' }
  }
  const text = buildPrompt(scope.locale, state, settings)
  try {
    agent.followup(userMessage(text))
  } catch (error) {
    return { ok: false, error: 'session-not-live', detail: describe(error) }
  }
  return { ok: true, queued: true, counts: state.counts, file: fileView(state) }
}

// ---------------------------------------------------------------------------
// File model
// ---------------------------------------------------------------------------

/** Resolve and read the todo file once, without throwing on a missing file. */
function readState(settings, cwd) {
  let path
  let rel
  try {
    path = resolveTodoPath(settings, cwd)
    rel = toPosix(relative(cwd, path))
  } catch (error) {
    return { error: 'invalid-file-name', detail: describe(error) }
  }

  let raw = ''
  let exists = false
  let mtimeMs = 0
  try {
    raw = readFileSync(path, 'utf8')
    exists = true
    mtimeMs = statSync(path).mtimeMs
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      exists = false
    } else if (error !== null && typeof error === 'object' && error.code === 'EISDIR') {
      return { error: 'file-is-directory', rel }
    } else {
      return { error: 'read-failed', rel, detail: describe(error) }
    }
  }

  const parsed = parseTodoFile(raw)
  return {
    path, rel, raw, exists, mtimeMs, parsed,
    counts: countTodos(parsed.todos),
  }
}

/**
 * Parse every Markdown task line in the document.
 * @param text - the file's text.
 * @returns the task list and whether this plugin may manage the file.
 */
export function parseTodoFile(text) {
  const raw = typeof text === 'string' ? text : ''
  const todos = []
  for (const line of raw.split(/\r?\n/)) {
    const match = TASK_LINE.exec(line)
    if (match === null) continue
    const body = match[4].trim()
    if (body === '') continue
    todos.push({ text: body, done: match[3].toLowerCase() === 'x' })
  }
  const managed = todos.length > 0 || raw.includes(TODO_MARKER) || raw.trim() === ''
  return { todos, managed, hasTasks: todos.length > 0 }
}

/**
 * Rewrite the checklist lines of `original` for `todos`, preserving every other
 * line (title, comments, notes) in place.
 * @param original - the file's current text.
 * @param todos - the new task list.
 * @returns the new file text, or `undefined` when the file must not be managed.
 */
export function serializeTodoFile(original, todos) {
  const lines = todos.map(formatTask)
  if (typeof original !== 'string' || original.trim() === '') return freshDocument(lines)
  if (!parseTodoFile(original).managed) return undefined

  const out = []
  let cursor = 0
  let lastTask = -1
  const hasMarker = original.includes(TODO_MARKER)
  for (const line of original.split(/\r?\n/)) {
    if (!TASK_LINE.test(line)) {
      out.push(line)
      continue
    }
    if (cursor >= lines.length) continue // a task the user deleted
    out.push(lines[cursor])
    lastTask = out.length - 1
    cursor += 1
  }

  const rest = lines.slice(cursor)
  if (rest.length > 0) {
    if (lastTask >= 0) {
      out.splice(lastTask + 1, 0, ...rest)
    } else {
      while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
      if (out.length > 0) out.push('')
      out.push(...rest)
    }
  }
  // Claim a hand-written checklist on first save, so emptying it later keeps
  // the file recognisable as managed instead of turning it into a conflict.
  if (!hasMarker) out.unshift(`${TODO_MARKER} this file is managed by the DSH todo list plugin; tasks are the checklist lines and other content is preserved. -->`, '')
  return `${out.join('\n').replace(/\n+$/, '')}\n`
}

/** One task line in the managed format. */
function formatTask(todo) {
  return `- [${todo.done ? 'x' : ' '}] ${todo.text}`
}

/** The document this plugin creates when the file does not exist yet. */
function freshDocument(taskLines) {
  return [
    `${TODO_MARKER} this file is managed by the DSH todo list plugin; tasks are the checklist lines and other content is preserved. -->`,
    '',
    '# Todo list',
    '',
    ...taskLines,
    '',
  ].join('\n')
}

/** Counts shown in the panel header. */
function countTodos(todos) {
  const done = todos.filter((todo) => todo.done).length
  return { total: todos.length, done, open: todos.length - done }
}

/** Write one file atomically so a crash never leaves a half-written list. */
function writeFileAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  writeFileSync(temp, content, 'utf8')
  try {
    renameSync(temp, path)
  } catch (error) {
    try {
      rmSync(temp, { force: true })
    } catch {
      // Best effort; a leftover temp file is harmless.
    }
    throw error
  }
}

/** Resolve the configured file name inside the Session directory. */
function resolveTodoPath(settings, cwd) {
  const name = settings.fileName
  if (isAbsolute(name) || /^[a-zA-Z]:/.test(name)) throw new Error('fileName must be relative')
  const normalized = normalize(name)
  if (normalized === '.' || normalized === '' || normalized.startsWith(`..${sep}`) || normalized === '..') {
    throw new Error('fileName must stay inside the working directory')
  }
  const path = resolve(cwd, normalized)
  const rel = relative(cwd, path)
  if (rel === '' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('fileName must stay inside the working directory')
  }
  return path
}

/** Wire view of the file, without raw text. */
function fileView(state) {
  return {
    name: basename(state.path),
    path: state.path,
    relativePath: state.rel,
    exists: state.exists,
    mtimeMs: state.mtimeMs,
    managed: !state.exists || state.parsed.managed,
  }
}

/** What the Client receives for one load/save. */
function stateView(state, settings, git) {
  return {
    ...fileView(state),
    todos: state.todos ?? state.parsed.todos,
    counts: state.counts ?? countTodos(state.parsed.todos),
    git,
    hint: { enabled: settings.hintOnNewSession },
    limits: { maxItems: settings.maxItems, maxItemLength: settings.maxItemLength },
  }
}

// ---------------------------------------------------------------------------
// Git tracking
// ---------------------------------------------------------------------------

/**
 * Inspect the file's Git state. Reads are cached briefly because the panel polls.
 * @returns tracked, ignored, staged, and whether the directory is a work tree.
 */
async function inspectGit(settings, cwd, rel, force = false) {
  const key = `${cwd}\u0000${rel}`
  const now = Date.now()
  const cached = gitCache.get(key)
  if (!force && cached !== undefined && now - cached.at < 5000) return cached.state

  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], settings)
  let state
  if (inside.code !== 0) {
    state = {
      isRepo: false,
      tracked: false,
      ignored: false,
      staged: false,
      unavailable: /ENOENT/i.test(inside.stderr),
    }
  } else {
    const tracked = (await runGit(cwd, ['ls-files', '--error-unmatch', '--', rel], settings)).code === 0
    const ignored = tracked ? false : (await runGit(cwd, ['check-ignore', '-q', '--', rel], settings)).code === 0
    state = { isRepo: true, tracked, ignored, staged: false }
  }
  gitCache.set(key, { at: now, state })
  return state
}

/**
 * Make sure the file is tracked by Git. Adding stages the file; the plugin
 * never commits, so the user keeps control of the repository history.
 */
async function ensureGitTracked(settings, cwd, rel) {
  const before = await inspectGit(settings, cwd, rel, true)
  if (!settings.gitTrack || !before.isRepo || before.tracked || before.ignored) return before
  const add = await runGit(cwd, ['add', '--', rel], settings)
  const after = await inspectGit(settings, cwd, rel, true)
  return { ...after, staged: add.code === 0, addFailed: add.code !== 0 }
}

/**
 * Run one git command in `cwd`.
 *
 * Output is captured through temporary files rather than pipes so the same
 * code works under a sandbox that refuses to open named pipes; the child never
 * sees a shell, so every argument reaches git verbatim.
 */
function runGit(cwd, args, settings) {
  return new Promise((resolvePromise) => {
    let directory
    let stdoutFd
    let stderrFd
    try {
      directory = mkdtempSync(join(tmpdir(), 'dsh-todo-list-'))
      stdoutFd = openSync(join(directory, 'stdout'), 'w')
      stderrFd = openSync(join(directory, 'stderr'), 'w')
    } catch (error) {
      cleanup()
      resolvePromise({ code: -1, stdout: '', stderr: describe(error), timedOut: false })
      return
    }

    let child
    try {
      child = spawn('git', args, {
        cwd,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', stdoutFd, stderrFd],
        env: process.env,
      })
    } catch (error) {
      closeQuietly()
      cleanup()
      resolvePromise({ code: -1, stdout: '', stderr: describe(error), timedOut: false })
      return
    }
    closeQuietly()

    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // The process already exited.
      }
    }, settings.gitTimeoutMs)

    const settle = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdout = readQuietly(directory, 'stdout')
      const stderr = readQuietly(directory, 'stderr')
      cleanup()
      resolvePromise({ code, stdout, stderr: timedOut ? `git timed out: ${stderr}` : stderr, timedOut })
    }

    child.on('error', () => settle(-1))
    child.on('close', (code) => settle(typeof code === 'number' ? code : -1))

    /** Close the parent's copies of the redirected files. */
    function closeQuietly() {
      for (const fd of [stdoutFd, stderrFd]) {
        try {
          closeSync(fd)
        } catch {
          // Already closed.
        }
      }
    }

    /** Remove the capture directory when the child has settled. */
    function cleanup() {
      try {
        if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
      } catch {
        // Best effort; a leftover temp file is harmless.
      }
    }
  })
}

/** Read one capture file, tolerating an absent path. */
function readQuietly(directory, name) {
  if (directory === undefined) return ''
  try {
    return readFileSync(join(directory, name), 'utf8')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Prompt, messages, and wire helpers
// ---------------------------------------------------------------------------

/** Build the requirement-analysis prompt for one locale. */
export function buildPrompt(locale, state, settings) {
  const todos = state.todos ?? state.parsed.todos
  const counts = state.counts ?? countTodos(todos)
  const list = todos.map(formatTask).join('\n')
  const completed = todos.filter((todo) => todo.done).map((todo) => `- ${todo.text}`).join('\n')
  const file = state.rel

  if (typeof settings.sendPromptTemplate === 'string' && settings.sendPromptTemplate.trim() !== '') {
    return settings.sendPromptTemplate
      .replaceAll('{file}', file)
      .replaceAll('{path}', state.path)
      .replaceAll('{total}', String(counts.total))
      .replaceAll('{done}', String(counts.done))
      .replaceAll('{open}', String(counts.open))
      .replaceAll('{list}', list)
      .replaceAll('{completed}', completed)
  }

  if (locale === 'zh') {
    return [
      '请对当前项目的待办清单做一次需求分析。',
      '',
      `清单文件：${file}（共 ${counts.total} 项：${counts.done} 项已完成，${counts.open} 项未完成）。`,
      '',
      '## 待办清单',
      list || '(空)',
      '',
      '## 分析要求',
      `1. 逐条分析这 ${counts.open} 项未完成待办：目标是否明确、范围是否合理、是否可独立验收；对含糊或过大的条目给出拆分建议。`,
      `2. 结合已完成的 ${counts.done} 项判断未完成项是否仍然合理：是否已被已完成的工作覆盖、是否与已完成实现冲突或重复、依赖顺序是否需要调整。`,
      '3. 给出建议的执行顺序（先做什么、哪些可以并行、哪些建议放弃或改写），并指出实现上的风险与冲突点。',
      '4. 如需调整清单，请先说明理由和建议，不要直接修改文件；等我确认后再更新。',
      '',
      '需要时可以自行读取仓库中的相关代码和文档作为判断依据，不要臆测。回答用简洁的中文。',
    ].join('\n')
  }
  return [
    'Please analyse the requirement list for this project.',
    '',
    `File: ${file} (${counts.total} tasks: ${counts.done} done, ${counts.open} open).`,
    '',
    '## Todo list',
    list || '(empty)',
    '',
    '## What to analyse',
    `1. Go through each of the ${counts.open} unfinished tasks: is the goal clear, is the scope reasonable, can it be verified on its own? Suggest how to split vague or oversized items.`,
    `2. Using the ${counts.done} completed task(s) as context, judge whether the unfinished ones still make sense: has completed work already covered them, do they conflict or duplicate what is implemented, does the dependency order need to change?`,
    '3. Recommend an execution order (what to do first, what can run in parallel, what to drop or rewrite), and call out implementation risks and conflicts.',
    '4. If the list should change, explain your reasoning first; do not edit the file until I confirm.',
    '',
    'Read the relevant code and documents in the repository when useful; do not guess. Keep the answer concise.',
  ].join('\n')
}

/** One identified, frozen user message accepted by the Agent inbox. */
function userMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** Freeze a JSON-shaped value deeply, matching the message factory's contract. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** Validate and normalize the task list the Client sent. */
function sanitizeTodos(input, settings) {
  if (!Array.isArray(input)) return undefined
  const todos = []
  for (const item of input) {
    if (item === null || typeof item !== 'object' || typeof item.text !== 'string') return undefined
    const text = item.text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
    if (text === '') continue
    todos.push({ text: text.slice(0, settings.maxItemLength), done: item.done === true })
  }
  return todos
}

/** Resolve the Session's effective directory without trusting Client input. */
function resolveSessionDirectory(ctx, sessionId) {
  if (sessionId === '') return undefined
  const session = ctx.sessions.get(sessionId)
  if (session === undefined) return undefined
  try {
    const directory = ctx.workingDirectory.get(session)
    if (typeof directory === 'string' && directory !== '') return directory
  } catch {
    // Fall through to the durable header.
  }
  const headerDirectory = session.header?.cwd
  return typeof headerDirectory === 'string' && headerDirectory !== '' ? headerDirectory : undefined
}

/** Merge the row config over the defaults, tolerating odd values. */
function resolveConfig(input) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const settings = { ...DEFAULTS, ...raw }
  if (typeof settings.fileName !== 'string' || settings.fileName.trim() === '') settings.fileName = DEFAULTS.fileName
  else settings.fileName = settings.fileName.trim()
  if (typeof settings.gitTrack !== 'boolean') settings.gitTrack = DEFAULTS.gitTrack
  if (typeof settings.hintOnNewSession !== 'boolean') settings.hintOnNewSession = DEFAULTS.hintOnNewSession
  if (!Number.isInteger(settings.maxItems) || settings.maxItems < 1) settings.maxItems = DEFAULTS.maxItems
  if (!Number.isInteger(settings.maxItemLength) || settings.maxItemLength < 10) settings.maxItemLength = DEFAULTS.maxItemLength
  if (typeof settings.sendPromptTemplate !== 'string') settings.sendPromptTemplate = DEFAULTS.sendPromptTemplate
  if (!Number.isFinite(settings.gitTimeoutMs) || settings.gitTimeoutMs < 1000) settings.gitTimeoutMs = DEFAULTS.gitTimeoutMs
  return settings
}

/** Whether a request comes from the page this Host serves. */
function isTrustedRequest(ctx, request) {
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  let expected
  try {
    expected = ctx.webServer.getOrigin()
  } catch {
    return true
  }
  return normalizeOrigin(origin) === normalizeOrigin(expected)
}

/** Compare origins without trailing slashes. */
function normalizeOrigin(value) {
  return String(value).replace(/\/+$/, '')
}

/** Read and parse one bounded JSON body. */
function readJsonBody(request) {
  return new Promise((resolvePromise) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolvePromise(value)
    }
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish(undefined)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (size === 0) return finish({})
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        finish(undefined)
      }
    })
    request.on('error', () => finish(undefined))
  })
}

/** Write one JSON response. */
function writeJson(response, status, payload) {
  if (response.writableEnded) return
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Convert a platform path to the wire's `/` form. */
function toPosix(path) {
  return path.split(sep).join('/')
}

/** Message text for an unknown thrown value. */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}
