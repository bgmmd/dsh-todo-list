# dsh-todo-list — 需求分析与设计决策

> 状态：需求分析完成，已实现并安装验证（v0.1.0）。验证细节见第 8 节。
> 目标环境：DeepSeek Harness Desktop / Web（0.2.2-rc.5，Web GUI），插件以 bundle 形式安装到 profile。
> 分析依据：运行时 Inspect（Host/Client Service、Slots、Theme）与安装版本的包源码（`@deepseek-ai/dsh-client-ui-sidebar-right`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-slots`）。

## 1. 背景与目标

复杂需求往往包含多个步骤、多个验收点，散落在对话里容易遗漏；AI 会话结束或换人接手后，更难知道「做到哪一步了」。
本插件把**待办清单**变成项目里的一份真实文件，并给它一个长期可见的位置（对话右侧栏），同时让 AI 能直接读到它、按它分析需求。

目标：

1. 对话右侧栏常驻一个可视化的待办清单，支持新建、勾选完成、修改、删除；
2. 新会话创建时给一条轻提示，引导复杂需求创建待办；
3. 清单以文件形式存放在会话项目根目录，Git 项目自动纳入追踪，随提交共享给协作者；
4. 一键把清单发给当前 AI，让 AI 重点分析未完成项，并结合已完成项判断合理性、冲突与执行顺序。

## 2. 逐条需求解读与合理性判断

| # | 原始需求 | 解读 | 判断 |
|---|---|---|---|
| 1 | 对话栏右侧的待办清单，可新建/勾选（置灰+删除线）/修改/删除 | 放在 Web GUI 右侧栏（`rightbar`）的一个自定义页签中，而非浮动卡片 | 合理。右侧栏是产品已有的「第二栏」，有正式扩展点（`ctx.sidebarRightTabs` + `sidebar.right.pane.tab`），不会遮挡对话 |
| 2 | 新建会话时轻提示「复杂需求可以创建待办清单」 | 空白新会话的 Hero 区域出现一个轻量入口；同时页签自身有空状态提示 | 合理。用 Hero 的 `conversation.hero.options` 座位，只在「空白会话 + 有 Session」时渲染，不需要自己造 toast 体系 |
| 3 | 文件存当前根目录；Git 项目提交时纳入追踪 | 存到会话工作目录（项目根）的 `.todo.md`；首次写入时若在 Git 工作树内且未被忽略，自动 `git add` 纳入索引；被忽略时明确告警 | 合理，但需要防冲突：不能覆盖仓库里已有的 `TODO.md`，因此默认用点文件 `.todo.md`，并拒绝改写「同名但没有清单内容」的文件 |
| 4 | 把清单发给 AI，重点分析未完成待办，结合已完成项分析合理性/冲突 | 插件 UI 按钮 → Host 生成结构化分析提示词 → 作为一条**用户可见的跟进消息**进入当前会话，AI 开启新一轮分析 | 合理。走会话日志（单一事实来源），fork/resume 后仍可复现；不做静默注入，用户看得到自己发起了分析 |
| 5 | 先建目录放代码，验证通过后推 GitHub，仓库名自定 | 目录 `dsh-todo-list/`，独立 Git 仓库，验证后创建 `bgmmd/dsh-todo-list` 并推送 | 合理（凭据已在本机可用） |

**结论：需求整体合理，可以按上述形态实现。** 以下细节需要做出决策。

## 3. 已定决策

- **D1 位置**：右侧栏页签（kind = `dsh-todo-list`），并在右侧栏的 Guide 页注册一张入口卡（`guide` entry），用户可从 Guide 打开，也可由新会话提示直接打开。
- **D2 存储位置**：`<会话工作目录>/.todo.md`，可通过 bundle 配置 `fileName` 改；必须是相对路径且不得越出工作目录。
- **D3 文件格式**：Markdown 任务列表，人类可读、Git diff 友好：
  ```markdown
  # Todo list

  - [ ] 未完成的事项
  - [x] 已完成的事项
  ```
  解析时识别文件中任意位置的 `- [ ]` / `- [x]` 行；保存时**只改任务行**，保留标题、注释、其他正文，避免吞掉协作者写的说明。
- **D4 文件安全**：
  - 文件不存在或为空 → 生成模板；
  - 文件存在、有任务行（或有插件标记）→ 接管任务行；
  - 文件存在、既无任务行也无插件标记且非空 → 拒绝写入（`unmanaged-file`），提示改 `fileName`，绝不覆盖用户文件。
- **D5 Git 追踪**：保存后若 `git rev-parse --is-inside-work-tree` 为 true：
  - 已跟踪 → 正常；
  - 未跟踪但被忽略 → 只告警（不改 `.gitignore`）；
  - 未跟踪且未忽略 → `git add -- <file>` 纳入索引（不 commit，提交时机仍由用户决定）。
- **D6 新会话提示**：Hero 右侧的紧凑入口（灯泡图标 + 「复杂需求？建个待办清单 / Track a complex task」），点击直接打开右侧栏页签；清单已有内容时显示「待办 2/5」入口。只在空白会话出现，不打扰已有对话。
- **D7 发给 AI 的形态**：`ctx.agents.get(sessionId).followup(userMessage(text))`，一条普通用户消息；提示词包含完整清单、完成/未完成计数、分析要求（未完成项逐条、与已完成项的冲突/重复/依赖、建议顺序、不要直接改文件先给建议）。会话不活跃时明确报错，不静默丢弃。
- **D8 双向同步**：面板打开时每 4 秒轮询文件元数据（mtime），发现外部修改（AI 或协作者）自动重载；正在编辑或保存时暂停，避免打断输入。
- **D9 文案**：中英文（跟随 DSH locale），英文句子仅首字母大写；所有颜色只用 `--dsw-alias-*` 主题 token。
- **D10 包名/仓库**：包名 `dsh-todo-list`，仓库 `bgmmd/dsh-todo-list`，MIT。

## 4. 功能规格

### FR-1 右侧栏页签
- 注册 tab 类型 `dsh-todo-list`（`multiple: false`，`keepMounted: false`），并在 Guide 中提供入口卡。
- 页签标题中英文随语言切换（`sidebar.right.pane.tab.title`）。
- 页签打开时占据右侧栏整栏，内容自适应高度、可滚动。

### FR-2 待办操作
- 新建：底部输入框回车新增，新增后清空并保持输入焦点；空文本忽略；长度超限（默认 500 字符）截断并提示。
- 勾选：点击复选框切换完成；完成后文字置灰 + 删除线。
- 修改：点击文字进入行内编辑（input），Enter/失焦保存，Esc 取消；空文本视为删除。
- 删除：行尾删除按钮（悬停/聚焦可见），删除后立即保存。
- 保存：乐观更新 + 串行写队列；失败时顶部条提示并提供「重试」。

### FR-3 文件与 Git 状态
- 头部显示「未完成/总数」计数。
- 底部显示文件名与 Git 状态徽标：`已纳入 Git 追踪` / `未纳入 Git（.gitignore 忽略）` / `非 Git 项目` / `已暂存待提交`。
- 文件被外部修改时自动重载，并短暂提示「文件已更新」。

### FR-4 新会话轻提示
- 空白会话 Hero 行出现入口；点击打开右侧栏待办页签。
- 无待办时文案引导创建，有待办时显示进度入口。
- 配置 `hintOnNewSession: false` 可关闭。

### FR-5 发送给 AI
- 头部「发送给 AI」按钮；无未完成项时禁用并提示先创建待办。
- 点击后调用 Host：重新读取文件 → 组装提示词 → 注入当前会话 → 返回结果。
- 成功提示「已发送，AI 正在分析」；失败区分「会话不活跃」「文件为空」「请求被拒绝」。

## 5. 非功能需求

- **安全**：同源 JSON 路由，仅接受本页 Origin；拒绝跨站、非 JSON、超大 body（默认 128 KiB）；所有路径限制在工作目录内；Git 只执行只读命令 + `git add`。
- **不污染会话**：除用户主动「发送给 AI」产生的一条用户消息外，插件不写任何会话事件；待办状态不进入会话日志。
- **零运行时依赖**：Host 只用 Node 内置模块；Client 只用 `react`（平台模块表提供）。
- **可卸载**：页签、Guide 入口、Hero 入口、路由随插件卸载一起移除。
- **跨平台**：Windows/macOS/Linux；Git 调用参数数组直传、`windowsHide`。
- **性能**：清单文件通常 < 10 KiB；轮询只读 stat/解析，不做逐条事件订阅。

## 6. 技术方案（已核实的扩展点）

| 关注点 | 方案 | 依据 |
|---|---|---|
| 右侧栏页签 | `ctx.sidebarRightTabs.register({ id, kind, title, guide })` + `ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name, key, locale, inject }, Body))` | sidebar-right 包 README / `contract/slots.ts`；documentpreview 是官方「外部包注册页签」的实例 |
| 页签标题 | `sidebar.right.pane.tab.title` 同 key 注册，跟随 locale | 同上 |
| 新会话入口 | `conversation.hero.options`（list，session scope，仅在 Hero 行渲染） | ui-conversation `ConversationContent.tsx` L133 |
| Client→Host | `ctx.webServer.register({ kind:'exact', path, handler })` 同源 JSON 路由 | DSH 的 `@Remote` 命名空间构建期固定；既有插件 `dsh-vibecoding-preflight` 同样采用 |
| 会话目录 | `ctx.sessions.get(id)` → `ctx.workingDirectory.get(session)`，回退 `session.header.cwd` | Host Service 契约 |
| 发给 AI | `ctx.agents.get(sessionId).followup(createUserMessage(text))` | 既有插件验证过的 Agent 运行时接口 |
| 样式 | 仅 `--dsw-alias-*` token；页面圆角/间距参照侧栏现有列表 | `Theme.listTokens` 实测 13 个 token |

## 7. 风险与限制

- 文件是唯一事实来源：手动编辑格式错误（非任务行）不会丢数据，但不会被识别为待办。
- 不做逐项冲突合并：多人同时编辑同一文件时，后保存者覆盖前者；面板轮询能发现外部修改并重载，但不做三方合并。
- 不自动 commit：只做到 `git add`，提交信息与时机由用户决定（避免插件替用户写提交历史）。
- 右侧栏是浏览器本地布局：换设备不同步（页签是否存在由 DSH 自己管理），清单内容跟着 Git 文件走。
- 视觉/交互的最终确认需在浏览器中目视；本环境将用无头浏览器做尽可能的自动化验证。

## 8. 验收结果

验证方式：`node --test`（Host 22 项 + Client 7 项，全部通过）；安装到 desktop profile 后，用无头 Edge 通过 CDP 打开真实 Web GUI 逐项操作；Host 路由用真实 HTTP 请求探测。

- [x] 右侧栏 Guide 出现「待办清单」入口，打开后页面正常渲染（截图：Todo list 页签、计数、进度条、空状态、底部输入框与文件/Git 徽标）。
- [x] 新建 / 勾选（置灰 + 删除线）/ 行内修改 / 删除均可用；每一步都写回 `.todo.md` 并被后续读取确认。
- [x] 勾选后计算样式为 `text-decoration: line-through`、次要文字色 + 0.75 透明度；进度条 100%。
- [x] 保存后保留标题/注释，多余任务行被删除，空清单时保留插件标记。
- [x] Git 项目：Host 测试在真实临时仓库中验证首次保存执行 `git add`、`git ls-files` 可见文件；`.gitignore` 排除时报告 `ignored` 且不追踪（当前工作目录不是 Git 仓库，GUI 中显示「非 Git 项目」）。
- [x] 新会话 Hero 出现轻提示；有待办时显示「Todo 1/2」，无待办时显示「Complex task? Track it」；点击可打开页签；保存/外部变更后提示会刷新。
- [x] 「发送给 AI」在真实会话中生成一条用户消息（含完整清单、完成/未完成计数、四项分析要求），AI 随即开始分析；会话可停止并归档。
- [x] 外部修改文件后约 4 秒内面板自动重载（页签可见时轮询；后台页签暂停）。
- [x] 中英文文案、插件管理器标题/描述/图标均正常显示（英文界面实测；中文界面同名文案与截图一致）。
- [x] `Send to AI` 之外不写入任何会话事件；路由拒绝 GET、跨站、非 JSON 与超大 body。
- [ ] 卸载插件后的完整清理只做了静态确认（所有注册都在 `ctx.effect` 内，随 fiber 释放），未在 GUI 中实际卸载后目视复查。
- [ ] 深色主题、窄窗口（< 768px）下的外观未逐一目视验证。

## 9. 验证备注

- GUI 验证在无头 Edge 中进行：通过临时的一次性路由取得 DSH 的认证 URL（仅本机、验证后立即移除该临时插件并确认路由 404），未改动用户的持久配置。
- 测试用的 `.todo.md`（位于 `D:\dsharness`）与测试会话已清理：文件删除，会话停止并归档。

