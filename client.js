/**
 * Client half of the `dsh-todo-list` bundle.
 *
 * Registers one right-Sidebar tab type and its body, a light entry on the blank
 * new-session screen, and the copy for both. Every operation that touches the
 * project goes through the Host half's same-origin JSON routes: this module
 * keeps no authoritative state of its own, so the `.todo.md` file stays the
 * single source of truth and the panel can pick up edits made by the user, a
 * collaborator, or the AI.
 *
 * @module dsh-todo-list/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-todo-list',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dshTodo'
    const PACKAGE = 'dsh-todo-list'
    const KIND = 'dsh-todo-list'
    const API = '/dsh-todo/api'
    const POLL_MS = 4000

    const en = {
      'tab.title': 'Todo list',
      'guide.title': 'Todo list',
      'guide.description': 'Track tasks with the AI and send the list for analysis',
      'counts.open': 'open',
      'counts.total': 'of {total}',
      'counts.done': '{done} done',
      'counts.summary': '{open} open · {done}/{total} done',
      'list.aria': 'Todo list',
      'add.placeholder': 'Add a task and press Enter',
      'add.aria': 'New task',
      'add.submit': 'Add task',
      'empty.title': 'No tasks yet',
      'empty.body': 'Break a complex request into steps, then send the list to the AI for a requirement analysis.',
      'empty.action': 'Add the first task',
      'row.done': 'Mark as done',
      'row.undo': 'Mark as not done',
      'row.delete': 'Delete task',
      'row.edit': 'Edit task',
      'loading': 'Reading the todo list…',
      'refresh.label': 'Refresh from the file',
      'save.saving': 'Saving…',
      'save.failed': 'Could not save the list.',
      'notice.retry': 'Retry',
      'notice.close': 'Dismiss',
      'notice.externalReloaded': 'The file changed on disk, so the list was reloaded.',
      'notice.externalSaved': 'Saved. The file had also changed on disk.',
      'send.label': 'Send to AI',
      'send.busy': 'Sending…',
      'send.success': 'Sent. The AI is analysing the list.',
      'send.disabledEmpty': 'Add an unfinished task first.',
      'send.tooltip': 'Send this list to the current AI session and ask it to analyse the unfinished tasks.',
      'file.tooltip': 'Todo file: {path}',
      'git.tracked': 'Tracked by Git',
      'git.staged': 'Added to the Git index',
      'git.pending': 'Added to Git on first save',
      'git.untracked': 'Not tracked by Git yet',
      'git.ignored': 'Ignored by .gitignore',
      'git.none': 'Not a Git project',
      'git.unavailable': 'Git is unavailable',
      'git.tooltip': 'File: {path}',
      'error.loadFailed': 'Could not read the todo file.',
      'error.network': 'Could not reach the DeepSeek Harness host.',
      'error.routesMissing': 'The todo routes are not registered. Reload the app or reinstall the plugin.',
      'error.sessionNotFound': 'This session could not be resolved. Reopen it and try again.',
      'error.unmanagedFile': 'A file with this name already exists but is not a todo list. Rename the configured fileName or move that file.',
      'error.tooManyItems': 'Too many tasks (the limit is {limit}).',
      'error.invalidTodos': 'The task list could not be saved.',
      'error.emptyList': 'There are no tasks to send yet.',
      'error.noOpenItems': 'Every task is done, so there is nothing to analyse.',
      'error.sessionNotLive': 'This session is not active. Reopen it and try again.',
      'error.readFailed': 'The todo file could not be read.',
      'error.writeFailed': 'The todo file could not be written.',
      'error.generic': 'The request was refused ({code}).',
      'hint.empty': 'Complex task? Track it',
      'hint.progress': 'Todo {open}/{total}',
      'hint.tooltip': 'Break a complex request into tasks in the right sidebar, then let the AI analyse the list.',
    }

    const zh = {
      'tab.title': '待办清单',
      'guide.title': '待办清单',
      'guide.description': '和 AI 一起推进任务，并可把清单发给 AI 做需求分析',
      'counts.open': '项未完成',
      'counts.total': '共 {total} 项',
      'counts.done': '{done} 项已完成',
      'counts.summary': '未完成 {open} · 已完成 {done}/{total}',
      'list.aria': '待办清单',
      'add.placeholder': '添加待办，回车确认',
      'add.aria': '新建待办',
      'add.submit': '添加待办',
      'empty.title': '还没有待办',
      'empty.body': '复杂需求可以拆成待办，再发给 AI 做需求分析，逐项确认是否合理、是否冲突。',
      'empty.action': '添加第一条待办',
      'row.done': '标记为完成',
      'row.undo': '标记为未完成',
      'row.delete': '删除待办',
      'row.edit': '修改待办',
      'loading': '正在读取待办清单…',
      'refresh.label': '从文件重新读取',
      'save.saving': '保存中…',
      'save.failed': '保存失败。',
      'notice.retry': '重试',
      'notice.close': '关闭提示',
      'notice.externalReloaded': '文件已在外部更新，清单已重新加载。',
      'notice.externalSaved': '已保存。文件此前被外部修改过。',
      'send.label': '发送给 AI',
      'send.busy': '发送中…',
      'send.success': '已发送，AI 正在分析清单。',
      'send.disabledEmpty': '请先添加未完成的待办。',
      'send.tooltip': '把这份清单发给当前 AI 会话，重点分析未完成的待办。',
      'file.tooltip': '待办文件：{path}',
      'git.tracked': '已纳入 Git 追踪',
      'git.staged': '已加入 Git 暂存区',
      'git.pending': '保存后自动纳入 Git',
      'git.untracked': '尚未纳入 Git 追踪',
      'git.ignored': '被 .gitignore 忽略',
      'git.none': '非 Git 项目',
      'git.unavailable': 'Git 不可用',
      'git.tooltip': '文件：{path}',
      'error.loadFailed': '无法读取待办文件。',
      'error.network': '无法连接 DeepSeek Harness 宿主进程。',
      'error.routesMissing': '待办路由未注册，请刷新页面或重新安装插件。',
      'error.sessionNotFound': '无法解析当前会话，请重新打开会话后再试。',
      'error.unmanagedFile': '同名文件已存在但不是待办清单。请修改插件配置的 fileName，或移走该文件。',
      'error.tooManyItems': '待办数量过多（上限 {limit} 条）。',
      'error.invalidTodos': '待办清单保存失败。',
      'error.emptyList': '还没有可发送的待办。',
      'error.noOpenItems': '所有待办都已完成，没有需要分析的内容。',
      'error.sessionNotLive': '当前会话未处于活跃状态，请重新打开后再试。',
      'error.readFailed': '无法读取待办文件。',
      'error.writeFailed': '无法写入待办文件。',
      'error.generic': '请求被拒绝（{code}）。',
      'hint.empty': '复杂需求？建个待办清单',
      'hint.progress': '待办 {open}/{total}',
      'hint.tooltip': '在右侧栏把复杂需求拆成待办，并让 AI 帮你分析。',
    }

    /** Flat dictionary lookup with `{token}` interpolation. */
    function fill(template, params) {
      if (template === undefined || template === null) return ''
      return String(template).replace(/\{([a-zA-Z]+)\}/g, (match, key) => (
        params !== undefined && Object.prototype.hasOwnProperty.call(params, key)
          ? String(params[key])
          : match
      ))
    }

    /** Translate one key with optional interpolation. */
    function text(t, key, params) {
      let value
      try {
        value = t(key)
      } catch {
        value = key
      }
      return fill(value, params)
    }

    /** Map one Host error code to a user-facing sentence. */
    function errorText(t, code, extra) {
      const table = {
        'session-not-found': 'error.sessionNotFound',
        'unmanaged-file': 'error.unmanagedFile',
        'too-many-items': 'error.tooManyItems',
        'invalid-todos': 'error.invalidTodos',
        'empty-list': 'error.emptyList',
        'no-open-items': 'error.noOpenItems',
        'session-not-live': 'error.sessionNotLive',
        'read-failed': 'error.readFailed',
        'write-failed': 'error.writeFailed',
        'invalid-file-name': 'error.unmanagedFile',
        'file-is-directory': 'error.unmanagedFile',
      }
      const key = table[code]
      if (key !== undefined) return text(t, key, extra)
      return text(t, 'error.generic', { ...extra, code: code ?? 'unknown' })
    }

    /** Post one JSON request to the Host half. */
    async function post(action, payload) {
      let response
      try {
        response = await fetch(`${API}/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'same-origin',
        })
      } catch (error) {
        throw Object.assign(new Error('network'), { code: 'network', cause: error })
      }
      if (response.status === 404) throw Object.assign(new Error('routes-missing'), { code: 'routes-missing' })
      if (!response.ok) throw Object.assign(new Error(`http-${response.status}`), { code: 'http' })
      try {
        return await response.json()
      } catch (error) {
        throw Object.assign(new Error('bad-response'), { code: 'network', cause: error })
      }
    }

    /** Counts for an optimistic local list. */
    function countTodos(todos) {
      const done = todos.filter((todo) => todo.done).length
      return { total: todos.length, done, open: todos.length - done }
    }

    /** Announce that a Session's file changed, so the hero entry can refresh. */
    function announceChange(sessionId) {
      if (typeof window === 'undefined') return
      window.dispatchEvent(new CustomEvent('dsh-todo:changed', { detail: { sessionId } }))
    }

    // ---------------------------------------------------------------------
    // Icons (inline SVG; no import from the Client primitive package)
    // ---------------------------------------------------------------------

    function CheckIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, 'aria-hidden': true },
        h('path', {
          d: 'M3.2 8.4 6.1 11.2 12.8 4.6', fill: 'none', stroke: 'currentColor',
          strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function PlusIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('path', { d: 'M8 3.2v9.6M3.2 8h9.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }))
    }

    function RefreshIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.6v2.9H10', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function SendIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('path', {
          d: 'M2.4 7.4 13.2 3 9.6 13.2 7.9 9.2 2.4 7.4Z', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function TrashIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true },
        h('path', {
          d: 'M3.2 4.4h9.6M6.2 4.4V3.2h3.6v1.2M4.4 4.4l.6 8.2h6l.6-8.2M6.6 6.8v3.6M9.4 6.8v3.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function LightbulbIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true },
        h('path', {
          d: 'M6.1 10.6c-.7-.6-1.3-1.5-1.3-2.6a3.2 3.2 0 1 1 5.4 2.5c-.3.3-.4.7-.3 1.1l.1.6H6.4l-.1-.6c0-.4-.1-.7-.2-1ZM6.5 13h3M7 14.4h2',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function CheckListIcon(props) {
      const size = props !== undefined && typeof props.size === 'number' ? props.size : 18
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true,
        className: props !== undefined ? props.className : undefined,
      },
      h('rect', { x: 4, y: 3.5, width: 16, height: 17, rx: 3.4, stroke: 'currentColor', strokeWidth: 1.6 }),
      h('path', { d: 'M8.2 9.1 9.6 10.5 12.2 7.9', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('rect', { x: 13.6, y: 8.4, width: 3.6, height: 1.5, rx: 0.75, fill: 'currentColor', opacity: 0.55 }),
      h('path', { d: 'M8.2 14.4 9.6 15.8 12.2 13.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('rect', { x: 13.6, y: 13.7, width: 3.6, height: 1.5, rx: 0.75, fill: 'currentColor', opacity: 0.55 }))
    }

    // ---------------------------------------------------------------------
    // Data hook
    // ---------------------------------------------------------------------

    /**
     * Read, poll and mutate one Session's todo file.
     * @param sessionId - the Session whose working directory owns the file.
     * @param t - namespace-bound translate.
     * @param getSnapshot - locale snapshot reader, for the Host's prompt language.
     */
    function useTodoFile(sessionId, t, getSnapshot) {
      const [data, setData] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [fatal, setFatal] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [sending, setSending] = React.useState(false)
      const [revision, setRevision] = React.useState(0)

      const dataRef = React.useRef(null)
      const editGeneration = React.useRef(0)
      const saveChain = React.useRef(Promise.resolve())
      const queuedSave = React.useRef(null)
      const savingRef = React.useRef(false)
      const sendingRef = React.useRef(false)
      const editingRef = React.useRef(false)
      const noticeTimer = React.useRef(null)

      const setNoticeAuto = React.useCallback((value, autoHideMs) => {
        if (noticeTimer.current !== null) {
          clearTimeout(noticeTimer.current)
          noticeTimer.current = null
        }
        setNotice(value)
        if (value !== null && autoHideMs !== undefined) {
          noticeTimer.current = setTimeout(() => {
            noticeTimer.current = null
            setNotice(null)
          }, autoHideMs)
        }
      }, [])

      React.useEffect(() => () => {
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
      }, [])

      const localeTag = React.useCallback(() => {
        try {
          const snapshot = getSnapshot()
          const id = snapshot !== undefined && snapshot !== null ? snapshot.active ?? '' : ''
          return String(id).toLowerCase().startsWith('zh') ? 'zh' : 'en'
        } catch {
          return 'en'
        }
      }, [getSnapshot])

      const adopt = React.useCallback((next) => {
        dataRef.current = next
        setData(next)
        setPhase('ready')
        setFatal(null)
      }, [])

      const load = React.useCallback(async () => {
        try {
          const response = await post('load', { sessionId })
          if (response.ok !== true) {
            setFatal(response.error ?? 'load-failed')
            setPhase('error')
            return
          }
          adopt(response.state)
        } catch (error) {
          setFatal(error.code === 'network' ? 'network' : 'load-failed')
          setPhase('error')
        }
      }, [sessionId, adopt])

      React.useEffect(() => {
        let cancelled = false
        setPhase('loading')
        void load().then(() => { if (cancelled) return })
        return () => { cancelled = true }
      }, [load, revision])

      const flushSave = React.useCallback(() => {
        saveChain.current = saveChain.current.then(async () => {
          const job = queuedSave.current
          if (job === null) return
          queuedSave.current = null
          savingRef.current = true
          setSaving(true)
          try {
            const known = dataRef.current !== null ? dataRef.current.mtimeMs : undefined
            const response = await post('save', { sessionId, todos: job.todos, knownMtimeMs: known, locale: localeTag() })
            if (response.ok !== true) {
              setNoticeAuto({ kind: 'error', text: errorText(t, response.error, { limit: response.limit }) }, undefined)
              void load()
              return
            }
            const next = response.state
            if (response.externalChanged === true) setNoticeAuto({ kind: 'info', text: text(t, 'notice.externalSaved') }, 6000)
            if (editGeneration.current === job.revision) {
              adopt(next)
            } else {
              dataRef.current = { ...(dataRef.current ?? next), ...next, todos: dataRef.current?.todos ?? next.todos, counts: dataRef.current?.counts ?? next.counts }
              setData(dataRef.current)
            }
            announceChange(sessionId)
          } catch (error) {
            setNoticeAuto({ kind: 'error', text: error.code === 'network' || error.code === 'routes-missing' ? text(t, error.code === 'network' ? 'error.network' : 'error.routesMissing') : text(t, 'save.failed') }, undefined)
          } finally {
            savingRef.current = false
            setSaving(false)
          }
        })
        return saveChain.current
      }, [adopt, localeTag, sessionId, setNoticeAuto, t])

      const persist = React.useCallback((todos) => {
        const previous = dataRef.current
        if (previous === null) return
        editGeneration.current += 1
        const revision = editGeneration.current
        const optimistic = { ...previous, todos, counts: countTodos(todos), exists: true }
        dataRef.current = optimistic
        setData(optimistic)
        queuedSave.current = { todos, revision }
        void flushSave()
      }, [flushSave])

      // Poll the file so an edit made by the AI or a collaborator shows up
      // without a reload; pause while the user is typing or a save is in flight.
      React.useEffect(() => {
        let disposed = false
        const poll = async () => {
          if (disposed || editingRef.current || savingRef.current || queuedSave.current !== null) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          try {
            const response = await post('load', { sessionId })
            if (disposed || response.ok !== true) return
            const next = response.state
            const previous = dataRef.current
            if (previous === null) return
            const mtimeChanged = Math.abs((next.mtimeMs ?? 0) - (previous.mtimeMs ?? 0)) > 1
            const gitChanged = next.git?.tracked !== previous.git?.tracked || next.git?.ignored !== previous.git?.ignored || next.git?.staged !== previous.git?.staged
            if (mtimeChanged) {
              if (editingRef.current || savingRef.current) return
              adopt(next)
              setNoticeAuto({ kind: 'info', text: text(t, 'notice.externalReloaded') }, 5000)
              announceChange(sessionId)
            } else if (gitChanged) {
              dataRef.current = { ...previous, git: next.git, limits: next.limits, hint: next.hint }
              setData(dataRef.current)
            }
          } catch {
            // A transient poll failure is not worth a banner; the next tick retries.
          }
        }
        const timer = setInterval(() => { void poll() }, POLL_MS)
        if (typeof window !== 'undefined') window.addEventListener('focus', poll)
        return () => {
          disposed = true
          clearInterval(timer)
          if (typeof window !== 'undefined') window.removeEventListener('focus', poll)
        }
      }, [adopt, sessionId, setNoticeAuto, t])

      const onEditingChange = React.useCallback((editing) => { editingRef.current = editing }, [])

      const addTodo = React.useCallback((raw) => {
        const previous = dataRef.current
        if (previous === null) return
        const value = String(raw ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim()
        if (value === '') return
        if (previous.todos.length >= (previous.limits?.maxItems ?? 200)) {
          setNoticeAuto({ kind: 'error', text: errorText(t, 'too-many-items', { limit: previous.limits?.maxItems }) }, undefined)
          return
        }
        const limit = previous.limits?.maxItemLength ?? 500
        persist([...previous.todos, { text: value.slice(0, limit), done: false }])
      }, [persist, setNoticeAuto, t])

      const toggleTodo = React.useCallback((index) => {
        const previous = dataRef.current
        if (previous === null) return
        const todos = previous.todos.map((todo, at) => (at === index ? { ...todo, done: !todo.done } : todo))
        persist(todos)
      }, [persist])

      const updateTodo = React.useCallback((index, raw) => {
        const previous = dataRef.current
        if (previous === null) return
        const value = String(raw ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim()
        if (value === '') {
          persist(previous.todos.filter((todo, at) => at !== index))
          return
        }
        const limit = previous.limits?.maxItemLength ?? 500
        persist(previous.todos.map((todo, at) => (at === index ? { ...todo, text: value.slice(0, limit) } : todo)))
      }, [persist])

      const removeTodo = React.useCallback((index) => {
        const previous = dataRef.current
        if (previous === null) return
        persist(previous.todos.filter((todo, at) => at !== index))
      }, [persist])

      const send = React.useCallback(async () => {
        const previous = dataRef.current
        if (previous === null || sendingRef.current) return
        sendingRef.current = true
        setSending(true)
        try {
          const response = await post('send', { sessionId, locale: localeTag() })
          if (response.ok === true) {
            setNoticeAuto({ kind: 'success', text: text(t, 'send.success') }, 7000)
          } else {
            setNoticeAuto({ kind: 'error', text: errorText(t, response.error, {}) }, undefined)
          }
        } catch (error) {
          setNoticeAuto({ kind: 'error', text: text(t, error.code === 'routes-missing' ? 'error.routesMissing' : 'error.network') }, undefined)
        } finally {
          sendingRef.current = false
          setSending(false)
        }
      }, [localeTag, sessionId, setNoticeAuto, t])

      const refresh = React.useCallback(() => {
        setNoticeAuto(null, undefined)
        setRevision((value) => value + 1)
      }, [setNoticeAuto])

      return {
        data, phase, fatal, notice, saving, sending, refresh, send,
        addTodo, toggleTodo, updateTodo, removeTodo, onEditingChange,
      }
    }

    // ---------------------------------------------------------------------
    // Tab body
    // ---------------------------------------------------------------------

    /** One row: checkbox, text or inline editor, and the delete control. */
    function TodoRow(props) {
      const todo = props.todo
      const t = props.t
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState(todo.text)
      const inputRef = React.useRef(null)
      const committedRef = React.useRef(false)

      React.useEffect(() => {
        if (!editing) setDraft(todo.text)
      }, [todo.text, editing])

      const begin = () => {
        committedRef.current = false
        setDraft(todo.text)
        setEditing(true)
        props.onEditingChange(true)
      }

      const finish = (save) => {
        if (!editing) return
        setEditing(false)
        props.onEditingChange(false)
        if (save && !committedRef.current) {
          committedRef.current = true
          if (draft.trim() !== todo.text) props.onSave(draft)
        }
      }

      React.useEffect(() => {
        if (editing && inputRef.current !== null) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, [editing])

      const body = editing
        ? h('input', {
          ref: inputRef,
          className: 'dsh-todo__edit',
          value: draft,
          'aria-label': text(t, 'row.edit'),
          onChange: (event) => setDraft(event.target.value),
          onBlur: () => finish(true),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              finish(true)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              finish(false)
            }
          },
        })
        : h('button', {
          type: 'button',
          className: 'dsh-todo__text',
          title: text(t, 'row.edit'),
          onClick: begin,
        }, todo.text)

      return h('div', { className: `dsh-todo__row${todo.done ? ' is-done' : ''}` },
        h('button', {
          type: 'button',
          role: 'checkbox',
          'aria-checked': todo.done,
          'aria-label': text(t, todo.done ? 'row.undo' : 'row.done'),
          className: 'dsh-todo__check',
          onClick: () => props.onToggle(),
        }, todo.done ? h(CheckIcon) : null),
        body,
        h('button', {
          type: 'button',
          className: 'dsh-todo__delete',
          title: text(t, 'row.delete'),
          'aria-label': text(t, 'row.delete'),
          onClick: () => props.onDelete(),
        }, h(TrashIcon)))
    }

    /** The right-Sidebar tab body. */
    function TodoPanel(props) {
      const t = props.t
      const sessionId = props.sessionId
      React.useSyncExternalStore(props.subscribe, props.getSnapshot)
      const store = useTodoFile(sessionId, t, props.getSnapshot)
      const [draft, setDraft] = React.useState('')
      const addRef = React.useRef(null)

      const data = store.data
      const todos = data !== null ? data.todos : []
      const counts = data !== null ? data.counts : { total: 0, done: 0, open: 0 }
      const maxItems = data !== null ? data.limits?.maxItems ?? 200 : 200
      const canSend = data !== null && counts.open > 0 && !store.sending

      const submitDraft = () => {
        const value = draft
        setDraft('')
        store.addTodo(value)
        if (addRef.current !== null) addRef.current.focus()
      }

      const header = h('div', { className: 'dsh-todo__head' },
        h('div', { className: 'dsh-todo__stats' },
          h('span', { className: 'dsh-todo__stat-open' }, counts.open),
          h('span', { className: 'dsh-todo__stat-label' }, text(t, 'counts.open', { open: counts.open })),
          h('span', { className: 'dsh-todo__stat-total' }, text(t, 'counts.total', { total: counts.total }))),
        h('div', { className: 'dsh-todo__actions' },
          store.saving ? h('span', { className: 'dsh-todo__saving' }, text(t, 'save.saving')) : null,
          h('button', {
            type: 'button',
            className: 'dsh-todo__icon-btn',
            title: text(t, 'refresh.label'),
            'aria-label': text(t, 'refresh.label'),
            onClick: store.refresh,
          }, h(RefreshIcon)),
          h('button', {
            type: 'button',
            className: 'dsh-todo__send',
            title: canSend ? text(t, 'send.tooltip') : text(t, 'send.disabledEmpty'),
            disabled: !canSend,
            onClick: () => { void store.send() },
          }, h(SendIcon), h('span', null, text(t, store.sending ? 'send.busy' : 'send.label'))))),

      progress = h('div', { className: 'dsh-todo__progress', 'aria-hidden': true },
        h('div', {
          className: 'dsh-todo__progress-fill',
          style: { width: counts.total === 0 ? '0%' : `${Math.round((counts.done / counts.total) * 100)}%` },
        }))

      const notice = store.notice === null ? null : h('div', {
        className: `dsh-todo__notice is-${store.notice.kind}`,
        role: store.notice.kind === 'error' ? 'alert' : 'status',
      },
      h('span', { className: 'dsh-todo__notice-text' }, store.notice.text),
      h('button', {
        type: 'button',
        className: 'dsh-todo__notice-close',
        title: text(t, 'notice.close'),
        'aria-label': text(t, 'notice.close'),
        onClick: store.refresh,
      }, '×'))

      if (store.phase === 'loading') {
        return h('div', { className: 'dsh-todo' },
          h('div', { className: 'dsh-todo__placeholder' }, text(t, 'loading')))
      }
      if (store.phase === 'error' || data === null) {
        const code = store.fatal
        const message = code === 'network' || code === 'load-failed'
          ? text(t, code === 'network' ? 'error.network' : 'error.loadFailed')
          : errorText(t, code, {})
        return h('div', { className: 'dsh-todo' },
          h('div', { className: 'dsh-todo__placeholder' },
            h('p', { className: 'dsh-todo__placeholder-title' }, text(t, 'empty.title')),
            h('p', { className: 'dsh-todo__placeholder-body' }, message),
            h('button', { type: 'button', className: 'dsh-todo__ghost-btn', onClick: store.refresh }, text(t, 'notice.retry'))))
      }

      const list = todos.length === 0
        ? h('div', { className: 'dsh-todo__empty' },
          h('p', { className: 'dsh-todo__empty-title' }, text(t, 'empty.title')),
          h('p', { className: 'dsh-todo__empty-body' }, text(t, 'empty.body')),
          h('button', {
            type: 'button',
            className: 'dsh-todo__ghost-btn',
            onClick: () => { if (addRef.current !== null) addRef.current.focus() },
          }, text(t, 'empty.action')))
        : h('div', { className: 'dsh-todo__list', role: 'list', 'aria-label': text(t, 'list.aria') },
          todos.map((todo, index) => h(TodoRow, {
            key: `${index}:${todo.text}`,
            todo,
            t,
            onToggle: () => store.toggleTodo(index),
            onSave: (value) => store.updateTodo(index, value),
            onDelete: () => store.removeTodo(index),
            onEditingChange: store.onEditingChange,
          })))

      return h('div', { className: 'dsh-todo' },
        header,
        progress,
        notice,
        list,
        h('div', { className: 'dsh-todo__add' },
          h('input', {
            ref: addRef,
            className: 'dsh-todo__add-input',
            value: draft,
            placeholder: text(t, 'add.placeholder'),
            'aria-label': text(t, 'add.aria'),
            disabled: todos.length >= maxItems,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submitDraft()
              }
            },
          }),
          h('button', {
            type: 'button',
            className: 'dsh-todo__add-btn',
            title: text(t, 'add.submit'),
            'aria-label': text(t, 'add.submit'),
            disabled: draft.trim() === '' || todos.length >= maxItems,
            onClick: submitDraft,
          }, h(PlusIcon))) ,
        footer(data, t))
    }

    /** File name and Git-tracking badge. */
    function footer(data, t) {
      if (data === null) return null
      const git = data.git ?? { isRepo: false }
      let label
      let tone = 'idle'
      if (git.unavailable === true) {
        label = text(t, 'git.unavailable')
      } else if (!git.isRepo) {
        label = text(t, 'git.none')
      } else if (git.staged === true) {
        label = text(t, 'git.staged')
        tone = 'ok'
      } else if (git.tracked === true) {
        label = text(t, 'git.tracked')
        tone = 'ok'
      } else if (git.ignored === true) {
        label = text(t, 'git.ignored')
        tone = 'warn'
      } else if (data.exists === false) {
        label = text(t, 'git.pending')
      } else {
        label = text(t, 'git.untracked')
        tone = 'warn'
      }
      return h('div', { className: 'dsh-todo__foot' },
        h('span', {
          className: 'dsh-todo__file',
          title: text(t, 'file.tooltip', { path: data.path ?? data.relativePath ?? '' }),
        }, data.name ?? data.relativePath ?? ''),
        h('span', {
          className: `dsh-todo__git is-${tone}`,
          title: text(t, 'git.tooltip', { path: data.relativePath ?? '' }),
        }, label))
    }

    /** The tab chip title, read live so a language change reaches the header. */
    function TodoTabTitle(props) {
      React.useSyncExternalStore(props.subscribe, props.getSnapshot)
      return h('span', null, props.t('tab.title'))
    }

    /** A light entry on the blank new-session screen. */
    function HeroHint(props) {
      const t = props.t
      const sessionId = props.sessionId
      React.useSyncExternalStore(props.subscribe, props.getSnapshot)
      const [state, setState] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        const refresh = async () => {
          try {
            const response = await post('load', { sessionId })
            if (cancelled || response.ok !== true) return
            if (response.state.hint?.enabled === false) return
            setState(response.state)
          } catch {
            // The hint is optional; a failure to read it stays silent.
          }
        }
        const onChanged = (event) => {
          const changed = event !== undefined && event !== null ? event.detail?.sessionId : undefined
          if (changed !== undefined && changed !== sessionId) return
          void refresh()
        }
        void refresh()
        window.addEventListener('dsh-todo:changed', onChanged)
        window.addEventListener('focus', onChanged)
        return () => {
          cancelled = true
          window.removeEventListener('dsh-todo:changed', onChanged)
          window.removeEventListener('focus', onChanged)
        }
      }, [sessionId])

      if (state === null) return null
      const counts = state.counts
      const label = counts.total === 0
        ? text(t, 'hint.empty')
        : text(t, 'hint.progress', { open: counts.open, total: counts.total })
      return h('button', {
        type: 'button',
        className: 'dsh-todo__hint',
        title: text(t, 'hint.tooltip'),
        onClick: () => {
          try {
            props.onOpen()
          } catch {
            // Without an on-screen Session the controller refuses; the hint stays.
          }
        },
      }, h(LightbulbIcon), h('span', { className: 'dsh-todo__hint-label' }, label))
    }

    const CSS = `
.dsh-todo {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.45;
}
.dsh-todo__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 6px;
}
.dsh-todo__stats { display: flex; align-items: baseline; gap: 5px; min-width: 0; overflow: hidden; white-space: nowrap; }
.dsh-todo__stat-open { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-todo__stat-label { color: var(--dsw-alias-label-secondary); }
.dsh-todo__stat-total { color: var(--dsw-alias-label-secondary); opacity: .8; }
.dsh-todo__actions { display: flex; align-items: center; gap: 6px; flex: none; }
.dsh-todo__saving { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dsh-todo__icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; flex: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-todo__icon-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-todo__send {
  display: inline-flex; align-items: center; gap: 4px; flex: none;
  height: 26px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.dsh-todo__send:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-todo__send:disabled { opacity: .45; cursor: not-allowed; }
.dsh-todo__progress { height: 2px; margin: 0 12px; border-radius: 1px; background: var(--dsw-alias-border-l1); overflow: hidden; flex: none; }
.dsh-todo__progress-fill { height: 100%; background: var(--dsw-alias-brand-primary); transition: width .18s ease; }
.dsh-todo__notice {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 8px 12px 0; padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  font-size: 12px; flex: none;
}
.dsh-todo__notice.is-error { color: var(--dsw-alias-state-error-primary); }
.dsh-todo__notice.is-success { color: var(--dsw-alias-state-success-primary); }
.dsh-todo__notice-text { flex: 1; min-width: 0; word-break: break-word; }
.dsh-todo__notice-close {
  flex: none; width: 18px; height: 18px; margin: -2px -2px 0 0; padding: 0;
  border: 0; border-radius: 5px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 14px; line-height: 1; cursor: pointer;
}
.dsh-todo__notice-close:hover { background: var(--dsw-alias-bg-layer-1); }
.dsh-todo__list {
  flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  padding: 6px 6px 8px;
  scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l2) transparent;
}
.dsh-todo__row {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 6px 6px 8px; border-radius: 8px;
}
.dsh-todo__row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-todo__check {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; margin-top: 2px; padding: 0;
  border: 1.5px solid var(--dsw-alias-border-l2); border-radius: 5px;
  background: transparent; color: var(--dsw-alias-bg-base); cursor: pointer;
}
.dsh-todo__check[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-todo__text {
  flex: 1; min-width: 0; padding: 0; border: 0; background: none;
  color: inherit; font: inherit; text-align: left; word-break: break-word;
  cursor: text;
}
.dsh-todo__row.is-done .dsh-todo__text {
  color: var(--dsw-alias-label-secondary);
  text-decoration: line-through;
  opacity: .75;
}
.dsh-todo__edit {
  flex: 1; min-width: 0;
  padding: 2px 6px; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; outline: none;
}
.dsh-todo__delete {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; margin: -1px -2px 0 0; padding: 0;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer; opacity: 0;
}
.dsh-todo__row:hover .dsh-todo__delete,
.dsh-todo__row:focus-within .dsh-todo__delete { opacity: 1; }
.dsh-todo__delete:hover { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-error-primary); }
.dsh-todo__add {
  display: flex; align-items: center; gap: 6px; flex: none;
  margin: 0 12px; padding: 8px 0 2px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dsh-todo__add-input {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  font: inherit; outline: none;
}
.dsh-todo__add-input::placeholder { color: var(--dsw-alias-label-secondary); opacity: .8; }
.dsh-todo__add-input:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-todo__add-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dsh-todo__add-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-todo__add-btn:disabled { opacity: .4; cursor: not-allowed; }
.dsh-todo__empty {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 26px 18px; text-align: center;
}
.dsh-todo__empty-title { margin: 0 0 6px; font-weight: 600; }
.dsh-todo__empty-body { margin: 0 0 12px; color: var(--dsw-alias-label-secondary); }
.dsh-todo__ghost-btn {
  height: 26px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.dsh-todo__ghost-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-todo__placeholder {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 28px 18px; text-align: center; color: var(--dsw-alias-label-secondary);
}
.dsh-todo__placeholder-title { margin: 0 0 6px; color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsh-todo__placeholder-body { margin: 0 0 12px; }
.dsh-todo__foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  flex: none; padding: 6px 12px 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 11.5px; color: var(--dsw-alias-label-secondary);
}
.dsh-todo__file { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.dsh-todo__git { flex: none; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-todo__git.is-ok { color: var(--dsw-alias-state-success-primary); }
.dsh-todo__git.is-warn { color: var(--dsw-alias-state-warn-primary); }
.dsh-todo__hint {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; max-width: 240px; padding: 0 10px;
  border: 1px dashed var(--dsw-alias-border-l2); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; cursor: pointer;
}
.dsh-todo__hint:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-todo__hint-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.dshPlugin = PACKAGE
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, `${PACKAGE}: styles`)

        ctx.effect(() => ctx.locale.register(NS, 'en', en), `${PACKAGE}: en dictionary`)
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), `${PACKAGE}: zh dictionary`)

        const t = ctx.locale.bind(NS)
        const localeFace = {
          t,
          subscribe: (listener) => ctx.locale.subscribe(listener),
          getSnapshot: () => ctx.locale.getSnapshot(),
        }
        const openTab = () => {
          try {
            ctx.sidebarRight.openTab(KIND)
          } catch (error) {
            console.error('dsh-todo-list: could not open the todo tab:', error)
          }
        }

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: PACKAGE,
          kind: KIND,
          title: () => t('tab.title'),
          guide: [{
            id: 'todo',
            order: 20,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: CheckListIcon,
          }],
        }), `${PACKAGE}: tab type`)

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: PACKAGE,
          locale: NS,
          inject: (sessionId) => ({ sessionId, ...localeFace }),
        }, TodoPanel)), `${PACKAGE}: tab body`)

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: PACKAGE,
          locale: NS,
          inject: (sessionId) => ({ sessionId, ...localeFace }),
        }, TodoTabTitle)), `${PACKAGE}: tab title`)

        ctx.effect(() => ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
          name: 'conversation.hero.options',
          id: PACKAGE,
          order: 20,
          locale: NS,
          inject: (sessionId) => ({ sessionId, ...localeFace, onOpen: openTab }),
        }, HeroHint)), `${PACKAGE}: new-session hint`)
      },
    }
  },
})
