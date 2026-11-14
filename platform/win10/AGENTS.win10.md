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
> machine's own, measured on it — change a path or command here only after checking it.
> `platform/win10/verify.ps1` warns when a shared section goes missing, so a rule added on
> `main` cannot silently skip this file.

## 本机（实测）

- Windows 10 专业版 19045 / `DESKTOP-VH235CC`；i5-12490F（6 核 12 线程）/ 32 GB / RX 6650 XT；一块 2 TB SSD 分两个区：**C: 系统盘（空闲 ~78 GB）**、**E: 数据盘（空闲 ~617 GB）**。**没有 D: 盘**，旧文档里的 `D:\gamedev\...` 全部作废。
- 时区、端口、已装工具版本等现况直接调 `sysinfo`，别靠记忆。
- 终端是 Alacritty + PowerShell 7（`pwsh` 7.6.9）。**命令一律用 `pwsh` 跑。**

## 终端与 Node 版本

- Node 只有一个来源：**fnm 的 v24.22.2**。两个 profile（`pwsh` 7 和 Windows PowerShell 5.1）都装了 fnm 钩子，哪个窗口打开都是 `node v24.22.2` + `opencode v2.2.6`。
- 2026-11-14 清掉了两处抢在前面的旧版本：机器 PATH 上的 `E:\Program Files\nodejs`（`node.exe` 报 23.9.0，winget 记录却是 `OpenJS.NodeJS.22` 22.13.0）已整体卸载，`%APPDATA%\npm` 里残留的 `opencode-ai@1.1.45`（v1）也删了——v1 会去开 v2 的 `opencode.db`，那正是"每轮回复都被中断"的来源。卸载前的机器/用户 PATH 备份在 `~\.config\opencode\backup\`。
- 代价：**没有 profile 的进程**（`-NoProfile`、cmd、部分 IDE 任务）现在找不到 `node`/`npm`/`opencode`。跑 Node 一律用 `pwsh`；真要裸环境，把 fnm 的安装目录 `%APPDATA%\fnm\node-versions\v24.22.2\installation` 加进机器 PATH——它会自动成为那台 npm 的全局 prefix，装的还是 BD 那套。
- `platform\win10\verify.ps1` 的 `node >= 24.14` / `BD pins installed` 两行只在带 profile 的窗口里有意义。
- BD-004 的全局包都装在 fnm 的 v24.22.2 下：`@opencode/cli` 2.2.6、`@openchamber/web` 2.7.0（fork，dist 里有 `groupRootWorktrees`）、`@colbymchenry/codegraph` 1.6.2、`playwright` 1.65.0、`@larksuite/cli` 1.0.99。`npm root -g` 指向 `%LOCALAPPDATA%\fnm_multishells\<id>\node_modules`，每个 shell 的 `<id>` 都不同——别把那个路径写进脚本，用 `npm root -g` 现算。
- `openchamber` 在 `127.0.0.1:3000`，内嵌 opencode v2.2.6。`pnpm`/`bun` 没装，本机用 npm。

## 项目、skill、文档、工具（列出部分常用的-并非全部）

**项目**

| 项目 | 路径 | 是什么 |
|---|---|---|
| 本机 checkout | `E:\code\github\debian-railway` | 这份仓库（分支 `win10-compat` = `main` + `platform\win10\` overlay）：agent 配置、BD 版本锁 |
| 其他仓库 | `E:\code\github\<repo>` | 同一个 checkout 根下的其它项目 |
| worktree | `E:\code\github\worktrees` | 已写进 `opencode.jsonc` 的 `worktree.directory`；OpenChamber 的 New worktree 也落这里 |
| Godot 游戏项目 | `E:\APPS\godot\projects\<项目>` | Godot 4.7.2 便携版已装；godot-ai MCP 还没接，见「Godot 项目约定」 |

容器那台机器上的项目（joops、飞书工作助手、我的世界 mod 等）在这里不存在——本文件是本机视角。

**skill**

| 什么时候用 | skill |
|---|---|
| 调研 / 研究 / 综述 / 选型对比 | `deep-research` skill |
| 功能或需求开发（"做个 X"） | `req-to-ship` skill |
| 交付或合并之前 | `code-review` skill |
| 飞书文档 · 知识库 · 授权 | `lark-doc` · `lark-wiki` · `lark-shared`（先 `lark-cli config init --new` + `auth login`，见「飞书」） |
| 浏览器操作、页面验证 | `connectOverCDP("http://127.0.0.1:9222", …)`（见「浏览器」） |
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

## Git：用前缀区分兼容改动与通用改动

目的是维护和合并时一眼分得清：哪些是只为这台 Windows 机器打的补丁（合并时可以整条丢掉），哪些是两边共享的通用改动（必须回流 `main`）。所以一条提交只做一件事，不要混。

- **兼容改动**：只对 Windows 有意义的东西（`platform\win10\`、本文件、`docs\win10-setup.md`、`worktree.directory` 这类为这台机器改写的一个值），commit message 用 **`win10:`** 开头，例如 `win10: point worktrees at E:\code\github\worktrees`。
- **通用改动**：`opencode-config\`、`scripts\`、`versions\`、skill、文档等两边都受益的，**不加 `win10:`**，沿用 `feat(scope):` / `fix(scope):`，并且先在 `main` 落地再 merge 下来。
- 需要同时动两边时，提交两次：先通用那次（回流 `main`），再 `win10:` 那次（本机适配）。
- 合并/排查时这样看：`git log --oneline main..win10-compat` 里带 `win10:` 的是本机私有部分，其余是还没回流 `main` 的通用改动；`git log --oneline win10-compat..main` 是 `main` 上还没同步下来的。
- push 前确认在 `win10-compat` 分支上。

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

- 仓库放**本地固定盘**：`E:\code\github\<repo>`，worktree 放旁边 `E:\code\github\worktrees\<branch>`（`git worktree add E:\code\github\worktrees\<branch> -b <branch>`）。绝不放 `C:\Users\<you>\OneDrive`，别放 `%TEMP%`（一次性）。
- C: 是系统盘，只剩 ~78 GB：代码、模型、构建产物一律放 E:（空闲 ~617 GB）。
- 临时文件（日志、探针脚本、构建输出）可以放 `%TEMP%`——按定义就是一次性的。以后要再找到的东西放项目目录下。
- 不要把仓库克隆到 WSL 路径（`\\wsl.localhost\...`）再让 Godot 去读：9p 文件系统会把导入和 `git status` 拖慢好几倍。

## Windows：密钥与环境变量

密钥放在 `%USERPROFILE%\.config\opencode\.env`（`setup.ps1` 创建，之后不再覆盖），由它写进两个 PowerShell profile 的 loader 载入，所以每个新终端都有，`opencode` 和 `openchamber serve` 直接继承——不用 `setx`，也不进机器级环境变量。

- 现在里面只有 `EMBEDDING_API_KEY`、`A6API_API_KEY`；`PW_CDP` / `NODE_PATH` / `PW_PKG` 没设（见「浏览器」）。
- 改完 `.env` 要**开新终端**；已经在跑的 `openchamber serve` 用 `openchamber restart` 才能拿到新值。
- 供应商 key 也可以 `opencode auth login` 存进 `auth.json`，那样 `.env` 里留空即可。**`opencode-go` 订阅还没登录**（本机没有 `auth.json`），而 `opencode.jsonc` 的默认 model 是 `opencode-go/deepseek-v4.1-flash`：用默认 model 前先登录，否则 401。当前可用的路径是 a6api（走 `.env` 的 key）。
- 这个文件是机器本地的，**不要复制进仓库**，也不要提交。

## 附：codegraph（分析代码的首选）

- 分析 / 查看代码优先用 `codegraph_explore`；搜索参数和符号用**英文**（代码符号都是英文字母，别用中文搜索）。
- 执行搜索 / 分析前先 `codegraph sync` 同步代码变更。常用：`sync`（增量） · `index`（重建） · `status` · `files`。
- **没有 `.codegraph/` 的项目不要自己 `codegraph init`** —— 建索引是用户的决定；告知用户该目录未建索引，然后用 grep/glob 继续。本仓库 `E:\code\github\debian-railway` 目前就没建。

## 浏览器

本机浏览器就是日常用的 Chrome（137），加一个专用调试端口。扫码、验证码、OAuth 回调这类步骤由人在这同一个窗口里完成，agent 之后接同一个会话。

- 启动：`& "E:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="E:\chrome-debug"`（独立 profile，避免和日常窗口抢锁；登录一次就能长期复用）。现在 9222 已在监听。
- 接同一个实例：`connectOverCDP('http://127.0.0.1:9222', { noDefaults: true, isLocal: true })`。别用 `playwright cli open`（会导航走你当前标签页）。
- `.env` 里没有 `PW_CDP`：要用就在脚本里写字面量，或把 `PW_CDP=http://127.0.0.1:9222` 加进 `.env`。
- 不要另起浏览器：不 `--headless`、不换 profile / 端口、不删 `SingletonLock` —— 会顶掉你正在操作的窗口。
- 不要为了看一眼页面去截图再读图：优先读 DOM，只在必须判断视觉效果时才截图。

## Godot 项目约定

Godot 目前**没装**（`D:\gamedev` 在本机不存在，也没有 Godot 目录），所以 godot-ai 的 MCP 条目缺失，`verify.ps1` 的 `godot-ai mcp entry` 会一直 FAIL 到装好并 Configure 为止。

- **版本固定**：Godot 4.7.x 便携版放 `E:\APPS\godot-4.7.2\`，不安装、不进 PATH。换版本就是换目录，`project.godot` 里不写绝对路径。
- **编辑器必须由人开着**：`godot-ai` 是编辑器插件，agent 的所有场景/节点操作都经过它；没有编辑器就没有 undo 栈，也没有截图和输入注入。
- **MCP 走 dock 的 Configure**：不要手抄 `uvx` 命令——v4 客户端必须通过 `godot-ai attach` 连接，手写的 URL 无法鉴权。
- **只开需要的域**：`--exclude-domains` 或 dock 里的勾选，先开 editor / scene / node / script / game / project 六个，其余按需。
- **不要让 agent 直接改 `.tscn` 文本**：走 MCP 或编辑器，手改容易破坏 `uid` 与资源引用。
- **`.gitattributes` 必须有** `*.tscn *.tres *.gd text eol=lf`：Windows 的 CRLF 会把场景文件搅成全文件 diff。

## 飞书 / Lark

官方 `@larksuite/cli` 已装（BD-004 钉 1.0.99），但**还没配置**：`lark-cli auth status` 返回 `not_configured`。首次使用先在后台跑 `lark-cli config init --new`，从输出里取验证 URL 在浏览器里完成，再 `lark-cli auth login`；`auth status` 能看到身份后才用 `lark-doc` / `lark-wiki` / `lark-shared`。不要自己拼开放平台 HTTP 请求；命令细节见 `docs/lark-cli.md`。
