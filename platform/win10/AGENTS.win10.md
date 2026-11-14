# Coding Guidelines (Windows 10)

**Hard rules — recall these first:**

- **Run it before you call it done.** Report a change as working only after executing it; if you did not run it, say it is untested.
- **Read what you cite.** Every URL, number, version and quote comes from something you opened this session. If you did not read it, say you did not.
- **Review before delivering.** Re-read your own diff for correctness and for fit with the surrounding code, then report done.
- **Destructive → confirm first**, in one line: `rm -rf`, force-push, dropping a table, deleting a dataset.
- **Code, comments, docs, commit messages: English. Replies: Simplified Chinese.**
- **A long job never blocks the session** — background it (§5).
- **Minimal, surgical changes**; define a verifiable goal and loop until it passes; **lead the reply with the result**.
- **Model facts** (context window, output cap, price): models.dev, not memory. A reseller row is the upstream spec, not a promise it is enforced.

> Windows edition. The shared sections (0–6, the routing tables, codegraph) are copies of
> the container's `opencode-config/opencode/AGENTS.md`; the environment sections are this
> machine's own. `platform/win10/verify.ps1` warns when a shared section goes missing, so a
> rule added on `main` cannot silently skip this file.

## 项目、skill、文档、工具（列出部分常用的-并非全部）

**项目**

| 项目 | 路径 | 是什么 |
|---|---|---|
| 本机 checkout | `D:\gamedev\debian-railway` | 这份仓库：agent 配置、BD 版本锁、本 overlay 的来源 |
| Godot 游戏项目 | `D:\gamedev\<项目>` | 用 Godot 4.7 + godot-ai MCP 做的游戏；编辑器必须由人开着 |

容器那台机器上的项目（joops、飞书工作助手、我的世界 mod 等）在这里不存在——本文件是本机视角。

**skill**

| 什么时候用 | skill |
|---|---|
| 调研 / 研究 / 综述 / 选型对比 | `deep-research` skill |
| 功能或需求开发（"做个 X"） | `req-to-ship` skill |
| 交付或合并之前 | `code-review` skill |
| 飞书文档 · 知识库 · 授权 | `lark-doc` · `lark-wiki` · `lark-shared`（先 `lark-cli auth login`） |
| 浏览器操作、页面验证 | `PW_CDP` + `connectOverCDP`（见「浏览器」） |
| OpenCode 自身的问题 | `opencode` skill |

**文档**

| 你在做什么 | 先读 |
|---|---|
| 写/改提示词、skill、工具描述、`AGENTS.md` | `prompt-skill-tool-design.md` |
| 读需要登录的网站、Reddit | `agent-web-access.md` |
| 装环境、Godot、godot-ai、排错、从 `main` 同步 | 本仓库 `docs/win10-setup.md` |

文档在 `%USERPROFILE%\.config\opencode\docs\`。容器专用的几篇（`railway-cli`、`browser-self-check`、`interactive-browser`、`worktrees`、`go-allowance`、`a6api`、`gptge`）随配置一起拷过来，但只描述 Linux 那台机器。

**工具**

| 什么时候用 | 工具 |
|---|---|
| 回忆以前哪个会话做过什么、某件事之前怎么定的 | `session_search` |
| 要本机时间/时区、OS、CPU/内存/磁盘、端口、已装工具版本 | `sysinfo`（Windows 上没有 cgroup 与 Railway 段） |
| 生成图片、改图 | `image_generate`（需 `A6API_API_KEY`） |

## 0. Language

All code comments and documentation (README, docs, commit messages, PR descriptions) in **English**; keep existing content in its current language unless asked to translate. Replies in Simplified Chinese.

## 1. Think before coding

**Surface tradeoffs; never pick silently.**
- **Ask only when the choice is irreversible or expensive** — a schema, a data migration, a public interface, a deletion. Otherwise state the assumption in one line and proceed.
- Several valid interpretations → name them briefly, take the most likely, continue.
- A simpler approach exists → say so before building the complex one.
- **改，而不是只给建议。** "加一下""改一下""push"就是要立刻执行；只有方案本身还没定时才先讨论。

## 2. Simplicity first

**Minimum code that solves the problem; nothing speculative.**
- Build only what the ask requires: no single-use abstractions, no unrequested configurability.
- Handle only errors that can actually happen.
- 200 lines that could be 50 → rewrite.
- Test: "Would a senior engineer call this overcomplicated?"

## 3. Surgical changes

**Touch only what you must; clean up only your own mess.**
- Leave adjacent code, comments and formatting as you found them, and match the existing style; refactor only what your change breaks.
- Unrelated dead code → mention it, don't delete it.
- Remove only the imports/vars/functions your change orphaned.
- Test: every changed line traces to the request.

## 4. Goal-driven execution

**Define success criteria; loop until verified.**
- Turn tasks into verifiable goals ("fix bug" → "reproduce with a failing test, then make it pass").
- Multi-step: state a plan `1. step → verify: check; …`.
- Strong criteria → work independently; weak criteria → ask.

## 5. 长任务：后台跑，不要睡等

**后台（`background: true`）：** 自己写的脚本、抓取/构建/测试/迁移、预计 >10s、耗时未知、可能以「卡住」方式失败（网络、子进程、文件锁）。返回 shell ID 后**继续做别的**——完成事件会自己回来，不必结束本轮、不必等。内置工具（read/write/edit/grep/glob）、codegraph、sysinfo 仍前台跑。

**禁止 `sleep N` 轮询。** 等外部状态（构建产物、别人跑的任务、下载完成）用一次有上限的等待，或把等待放后台；拿不到就先结束本轮并说清「约 N 分钟后回来看」。

**Windows 上怎么脱离（不用 setsid）：** `Start-Process pwsh -ArgumentList '-NoProfile','-File','.\job.ps1' -RedirectStandardOutput .\job.log -RedirectStandardError .\job.err -WindowStyle Hidden`，或 `Start-Job`。**不要**用 `Start-Process ... -Wait`，那等于前台。要跨会话/注销存活就登记计划任务（`schtasks /create`）。

**可观测：** stdout+stderr 都写日志；脚本至少每 ~30s 一行心跳（阶段/已完成/总数/错误数），操作数据库的带行数（`COUNT(*)`）；网络调用显式 timeout（`Invoke-RestMethod -TimeoutSec`，`HttpClient` 默认 100s——别依赖默认值）；启动 ~30s 内用 `Get-Content -Wait` 确认日志在真推进。启动时回报 shell ID、日志路径与预计时长；失败贴真实报错；静默约 1 分钟主动报状态；停止按进程树停（`taskkill /T /F /PID <pid>`，只杀父进程会留孤儿）。

**批量：先小样（1~5 条 / 1 页 / 1 分片）核对字段、数量与写库，再全量。** 扫描限定项目内，不做整盘遍历。

## 6. 输出风格（先结论，可执行，精简）

目标：回复能直接照着做。以下为参考，任务本身优先。

- **先给结论。** 第一句就是答案或状态（"已完成 / 未完成+原因"），或用户能直接做的下一步。不写开场白（"好的，我来…"）、不复述工具调用、结尾不做总结回放。
- **简单问题 1–3 句**；长度由内容决定，不由风格决定。成段的解释用段落，不拆成一串碎点；表格留给真正需要并列比较的内容。
- **多步任务用编号列表**：每步一个动作（"打开 X → 替换 Y → 运行 Z"）。
- **拆分而非堆叠**：有第二个问题时先解决当前，再单独问"要不要我处理 X？"。
- **跨轮次重述进度**："第 N 步已完成，下一步是 X"。
- **让成果可见**：说清现在能做什么，时间给具体估计（"约 15 分钟"）。
- **错误就事论事**：直接说原因与修法。
- **区分已验证与推断**：没跑过、没读过的，明说是推断。

**以下情况写全长，不要压缩：** 用户要的解释；报错原文与失败的测试输出；安全警告；破坏性操作前的确认；长任务的进度（§5）。

> 例外：连续三轮失败时停止改代码，先质疑假设。

## Windows：磁盘与 worktree

Windows 没有会重建的根文件系统，但有更坏的失效方式：**OneDrive / Dropbox / 网络盘**。同步目录会在 Godot 导入或 `git` 操作底下改文件，毁掉 `.godot/` 缓存、偶尔毁掉 index。

- 仓库放**本地固定盘**（`D:\gamedev\...`），绝不放 `C:\Users\<you>\OneDrive`。
- worktree 放在仓库旁边：`git worktree add D:\gamedev\worktrees\<branch> -b <branch>`，别放 `%TEMP%`。`setup.ps1` 已把 `opencode.jsonc` 的 `worktree.directory` 改成这个根目录（容器那份是 `/workspace/worktrees`），所以 OpenChamber 的「New worktree」也落在同一处。
- 临时文件（日志、探针脚本、构建产物）可以放 `%TEMP%`——按定义就是一次性的。以后要再找到的东西放项目目录下。
- 不要把仓库克隆到 WSL 路径（`\\wsl.localhost\...`）再让 Godot 去读：9p 文件系统会把导入和 `git status` 拖慢好几倍。

## 附：codegraph（分析代码的首选）

- 分析 / 查看代码优先用 `codegraph_explore`；搜索参数和符号用**英文**（代码符号都是英文字母，别用中文搜索）。
- 执行搜索 / 分析前先 `codegraph sync` 同步代码变更。常用：`sync`（增量） · `index`（重建） · `status` · `files`。
- **没有 `.codegraph/` 的项目不要自己 `codegraph init`** —— 建索引是用户的决定；告知用户该目录未建索引，然后用 grep/glob 继续。

## 浏览器

本机浏览器就是你日常用的 Chrome 或 Edge，加一个专用调试端口。扫码、验证码、OAuth 回调这类步骤由人在这同一个窗口里完成，agent 之后接同一个会话。

- 启动：`chrome.exe --remote-debugging-port=9222 --user-data-dir=D:\gamedev\.chrome-agent`（独立 profile，避免和日常窗口抢锁；登录一次就能长期复用）。
- 接同一个实例：设置 `PW_CDP=http://127.0.0.1:9222`，脚本里用 `connectOverCDP(url, { noDefaults: true, isLocal: true })`。别用 `playwright cli open`（会导航走你当前标签页）。
- 不要另起浏览器：不 `--headless`、不换端口、不删 `SingletonLock` —— 会顶掉你正在操作的窗口。
- 不要为了看一眼页面去截图再读图：优先读 DOM，只在必须判断视觉效果时才截图。

## Godot 项目约定

- **版本固定**：Godot 4.7.x 便携版放在 `D:\gamedev\tools\godot-4.7.2\`，不安装、不进 PATH。换版本就是换目录，`project.godot` 里不写绝对路径。
- **编辑器必须由人开着**：`godot-ai` 是编辑器插件，agent 的所有场景/节点操作都经过它；没有编辑器就没有 undo 栈，也没有截图和输入注入。
- **MCP 走 dock 的 Configure**：不要手抄 `uvx` 命令——v4 客户端必须通过 `godot-ai attach` 连接，手写的 URL 无法鉴权。
- **只开需要的域**：`--exclude-domains` 或 dock 里的勾选，先开 editor / scene / node / script / game / project 六个，其余按需。
- **不要让 agent 直接改 `.tscn` 文本**：走 MCP 或编辑器，手改容易破坏 `uid` 与资源引用。
- **`.gitattributes` 必须有** `*.tscn *.tres *.gd text eol=lf`：Windows 的 CRLF 会把场景文件搅成全文件 diff。

## 飞书 / Lark

`setup.ps1` 装官方 `@larksuite/cli`（BD-004 钉 1.0.99），凭证是**每台机器各自登录**的：先 `lark-cli auth login`，`lark-cli auth status` 能看到身份再用 `lark-doc` / `lark-wiki` / `lark-shared`。不要自己拼开放平台 HTTP 请求；命令细节见 `docs/lark-cli.md`。装的时候用了 `-SkipLark` 的话，这三个 skill 在盘上但跑不起来。
