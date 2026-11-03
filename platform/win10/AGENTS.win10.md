# Coding Guidelines (Windows 10)

**Tradeoff:** these bias toward caution over speed; for trivial tasks, use judgment.

**Hard rules — recall these first:** code & docs in English · never block the session on a long script — background it (§5) · minimal, surgical changes · define a verifiable goal and loop until it passes · lead the reply with the result.

> Windows edition. Sections 0–6 are identical to the container's copy; only the
> environment-specific sections differ (worktrees, browser, long tasks). Keep the
> heading set in sync — `platform/win10/verify.ps1` reports drift.

## Environment awareness

`sysinfo` (provided by the local `plugins/sysinfo/` plugin, not a built-in) reports the machine's facts — time/timezone, OS, shell, CPU/memory/disk, listening ports and installed tools. On Windows the container and cgroup sections are absent by design: there is no quota to report and no Railway endpoint. Use it when a task depends on the machine's actual state rather than assumptions.

## Environment: worktrees belong on the volume

A worktree is a session's working directory. On Windows there is no ephemeral root filesystem, but there is a worse failure mode: **OneDrive, Dropbox and network drives**. A synced folder rewrites files underneath a running Godot import or `git` operation, which corrupts `.godot/` caches and occasionally the index.

- Keep repositories on a **local fixed disk** (`D:\gamedev\...`), never under `C:\Users\<you>\OneDrive`.
- Worktrees go beside the repo: `git worktree add D:\gamedev\worktrees\<branch> -b <branch>`. Do not put them in `%TEMP%`.
- Scratch files (logs, probe scripts, build output) may live in `%TEMP%` — throwaway by definition. Anything a later session must find again goes under the project directory.
- Do not clone a repo onto a WSL path (`\\wsl.localhost\...`) and drive Godot against it: the 9p filesystem makes import and `git status` several times slower.

## 0. Language: English only

All code comments and documentation (README, docs, commit messages, PR descriptions) are written in **English**. Keep existing content in its current language unless asked to translate.

## 1. Think before coding

**Don't assume, don't hide confusion; surface tradeoffs.**
- State assumptions; if uncertain, ask.
- Multiple interpretations → present them, don't pick silently.
- A simpler approach exists → say so; push back when warranted.
- Anything unclear → stop, name it, ask.

## 2. Simplicity first

**Minimum code that solves the problem; nothing speculative.**
- No features beyond the ask, no single-use abstractions, no unrequested configurability.
- No error handling for impossible cases.
- 200 lines that could be 50 → rewrite.
- Test: "Would a senior engineer call this overcomplicated?"

## 3. Surgical changes

**Touch only what you must; clean up only your own mess.**
- Don't improve adjacent code/comments/formatting; don't refactor what isn't broken; match existing style.
- Unrelated dead code → mention it, don't delete it.
- Remove only the imports/vars/functions your change orphaned.
- Test: every changed line traces to the request.

## 4. Goal-driven execution

**Define success criteria; loop until verified.**
- Turn tasks into verifiable goals ("fix bug" → "reproduce with a failing test, then make it pass").
- Multi-step: state a plan `1. step → verify: check; …`.
- Strong criteria → work independently; weak criteria → ask.

## 5. 长任务：不要阻塞会话

**默认：所有脚本都在后台跑。** 长命令前台运行会占住整轮，「还在跑」与「卡死/报错」无法区分。

**必须后台（命中任一）：**
- 自己临时写的脚本、仓库业务脚本（抓取 / 构建 / 测试 / 迁移 / 批处理）；
- 预计 > ~10s；
- 耗时未知；
- 可能挂起，或以「卡住」方式失败（网络、子进程、文件锁）。

内置工具（read/write/edit/grep/glob）、MCP 的 codegraph、本地插件提供的 sysinfo 都很快，正常前台跑。

**怎么跑（Windows）：**
- 用 shell 工具的后台模式（`background: true`）：立即返回 shell ID，输出写文件，完成时自动通知。**不要 sleep 轮询。**
- 手动脱离：`Start-Process pwsh -ArgumentList '-NoProfile','-File','.\job.ps1' -RedirectStandardOutput .\job.log -RedirectStandardError .\job.err -WindowStyle Hidden`，或 `Start-Job`。**不要**用 `Start-Process ... -Wait`，那就等于前台。
- 要跨会话存活：`schtasks /create` 或注册一个计划任务；普通后台进程在用户注销时会被结束。

**批量任务：先小样，再全量。** 全量运行前必须先用小批量（1~5 条 / 1 页 / 单分片）试跑，核对输出字段、数量、边界与写库结果符合预期，确认后再放大到全量。

**可观测（长任务必须）：**
- stdout+stderr 都重定向到日志，绝不丢输出。
- 脚本自报进度，**至少每 ~30s** 一行心跳：阶段 / 已完成 / 总数 / 耗时 / 错误数。`Get-Content -Wait` 一眼看出「在跑」还是「卡死」。
- 操作数据库：日志里带行数 / 影响行数 / 每阶段 `COUNT(*)`。
- 早期体检：启动后 ~30s 内确认日志在真实推进，而不是启动即错（参数错、缺依赖、DB 锁）——先修好再放手。
- 给边界：超时 / 最大条数 / 检查点，避免无限挂起。网络调用显式设 timeout（`Invoke-RestMethod -TimeoutSec` 默认不是无限的，但 `HttpClient` 默认是 100s，别依赖默认值）。

**汇报：**
- 启动时：报 shell ID、日志路径、怎么看、预计时长。
- 失败时：贴日志里的真实报错，不许吞。
- 静默 ~1 分钟 → 主动报状态；绝不留下静默长任务。
- 停止按进程树停：`taskkill /T /F /PID <pid>`；只杀父进程会留孤儿子进程。
- 扫描限定在项目内，不做整盘 / 超范围遍历，除非明确要求。

## 6. 输出风格（友好、可执行、精简）

目标：让回复适合快速阅读和执行。以下为**参考**，规则冲突时以任务本身为准。

- **先给结论/下一步动作**，再给上下文。首个句子是用户能直接做的事。
- **多步任务用编号列表**：每步一个明确动作（"打开 X → 替换 Y → 运行 Z"）；末尾给一件两分钟内能做的下一步。
- **拆分而非堆叠**：有第二个问题时先解决当前，再单独问"要不要我处理 X？"。
- **跨轮次重述进度**：接续任务时先报"第 N 步已完成，下一步是 X"，不假设对方记得上下文。
- **具体时间估计**："约 15 分钟"优于"有点工作量"。
- **让成果可见**：完成时用具体描述说明现在能做什么（"登录现在支持 magic link：`npm run dev` 打开 /login 试试"）。
- **错误就事论事**：直接说原因与修法，不用"哎呀/好像出问题了"。
- **请我做事时先报告结果**：先说"已完成"或"未完成+原因"，再展开细节。

> 例外：用户明确要"解释/带我过一遍"时可完整展开；涉及破坏性操作（rm -rf、强推、删表）先确认；连续三轮失败时停止改代码，先质疑假设。

## 附：codegraph（分析代码的首选）

- **所有代码项目都必须用 codegraph 索引代码**：分析前确认目标项目已建索引（有 `.codegraph/`）；若没有，先 `codegraph init` 初始化，再分析。
- 分析 / 查看代码优先用 `codegraph_explore`；搜索参数和符号用**英文**（代码符号都是英文字母，别用中文搜索）。
- 执行搜索 / 分析前，先 `codegraph sync` 同步代码变更。
- 常用命令：`codegraph sync`（增量同步） · `index`（重建） · `status`（状态/统计） · `files`（文件结构） · `init`（初始化并建索引）。

## 浏览器

本机浏览器就是唯一的浏览器：**你自己日常用的 Chrome 或 Edge**，加一个专用的调试端口。扫码、验证码、OAuth 回调这类步骤由人在这同一个窗口里完成，agent 之后接同一个会话。

- 启动：`chrome.exe --remote-debugging-port=9222 --user-data-dir=D:\gamedev\.chrome-agent`（独立 profile，避免和你日常窗口抢锁；登录一次就能长期复用）。
- 接同一个实例：设置 `PW_CDP=http://127.0.0.1:9222`，脚本里用 `connectOverCDP(url, { noDefaults: true, isLocal: true })`。别用 `playwright cli open`（会导航走用户当前标签页）。
- 不要另起浏览器：不 `--headless`、不换端口、不删 `SingletonLock` —— 会顶掉你正在操作的窗口。保存为登录态后再让 agent 接管。
- 不要为了看一眼页面去截图再读图：优先 `connectOverCDP` 读 DOM（`pw snapshot` 等价操作），只在必须判断视觉效果时才截图。

## Godot 项目约定

- **版本固定**：Godot 4.7.x 便携版放在 `D:\gamedev\tools\godot-4.7.2\`，不安装、不进 PATH。换版本就是换目录，`project.godot` 里不写绝对路径。
- **编辑器必须由人开着**：`godot-ai` 是编辑器插件，agent 的所有场景/节点操作都经过它；没有编辑器就没有 undo 栈，也没有截图和输入注入。
- **MCP 走 dock 的 Configure**：不要手抄 `uvx` 命令——v4 客户端必须通过 `godot-ai attach` 连接，手写的 URL 无法鉴权。
- **只开需要的域**：`--exclude-domains` 或 dock 里的勾选，先开 editor / scene / node / script / game / project 六个，其余按需。
- **不要让 agent 直接改 `.tscn` 文本**：走 MCP 或编辑器，手改容易破坏 `uid` 与资源引用。
- **`.gitattributes` 必须有** `*.tscn *.tres *.gd text eol=lf`：Windows 的 CRLF 会把场景文件搅成全文件 diff。
