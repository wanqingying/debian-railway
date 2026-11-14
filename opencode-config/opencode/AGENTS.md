# Coding Guidelines

**Hard rules — recall these first:**

- **Run it before you call it done.** Report a change as working only after executing it; if you did not run it, say it is untested.
- **Read what you cite.** Every URL, number, version and quote comes from something you opened this session. If you did not read it, say you did not.
- **Review before delivering.** Re-read your own diff for correctness and for fit with the surrounding code, then report done.
- **Destructive → confirm first**, in one line: `rm -rf`, force-push, dropping a table, deleting a dataset.
- **Code, comments, docs, commit messages: English. Replies: Simplified Chinese.**
- **A long job never blocks the session** — background it (§5).
- **Minimal, surgical changes**; define a verifiable goal and loop until it passes; **lead the reply with the result**.
- **Model facts** (context window, output cap, price): models.dev, not memory. A reseller row is the upstream spec, not a promise it is enforced.

## 参考手册

**任务 → skill**

| Task | Use |
|---|---|
| 调研 / 研究 / 综述 / 选型对比 | `deep-research` skill |
| 功能或需求开发（"做个 X"） | `req-to-ship` skill |
| 交付或合并之前 | `code-review` skill |
| 飞书文档 · 知识库 · 授权 | `lark-doc` · `lark-wiki` · `lark-shared` |
| 浏览器操作、页面验证 | `pw <cmd>`（见「浏览器」） |
| 部署上线 / CI 红了 | `deploy-to-vercel` · `gh-fix-ci` |
| OpenCode 自身的问题 | `opencode` skill |

This is the default when a task fits one of these shapes, not the full skill list — check the descriptions when a task fits none of them.

**问题 → 文档**（机器级，路径前缀 `$XDG_CONFIG_HOME/opencode/docs/`，即 `/workspace/.opencode/config/opencode/docs/`；随镜像烘焙，跨 redeploy 存活）

| 你在做什么 | 先读 |
|---|---|
| 写/改提示词、skill、工具描述、`AGENTS.md` | `prompt-skill-tool-design.md` |
| 调研 / 选型 / 技术对比（**仅 debian-railway 项目内**） | 项目 `docs/research/` 存档（`<主题>-<日期>.md`）——**先查有没有同主题的旧结论，别重复调研** |
| 跑 railway CLI | `railway-cli.md`——查过再下命令，别猜参数 |
| worktree 出错、会话目录丢失 | `worktrees.md` |
| 浏览器卡住、要自检或恢复 | `browser-self-check.md`（自检）· `interactive-browser.md`（完整 runbook） |
| 读需要登录的网站、Reddit | `agent-web-access.md` · `reddit-data-access.md` |
| 算成本、挑模型、查额度与用量归因 | `ai-model-pricing.md`（选型成本，规格仍以 models.dev 为准）· `go-allowance.md`（实际额度） |
| a6api 网关：模型白名单、日志、配额 | `a6api.md` |
| "我的世界"游戏：查 mod/整合包数据集的结构与字段（**仅该项目内**） | 项目 `docs/mcmod-db.md` · `docs/xhh-db.md`（采集流程见 `docs/mcmod-stats.md`） |

**工具**（本仓库自定义的插件工具，不是内置工具，见 `opencode-config/opencode/plugins/`）

| 什么时候用 | 工具 |
|---|---|
| 回忆以前哪个会话做过什么、某件事之前怎么定的 | `session_search` |
| 要时间/时区、容器起止与配额（cgroup，不是宿主机 48 核）、磁盘、端口内外分布、Railway 端点、已装工具版本 | `sysinfo` |
| 生成图片、改图 | `image_generate` |

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

**后台（`background: true`）：** 自己写的脚本、抓取/构建/测试/迁移、预计 >10s、耗时未知、可能以「卡住」方式失败（网络、子进程、DB 锁、原生编译）。返回 shell ID 后**继续做别的**——完成事件会以 `<shell id=… state="completed">` 自己回来，不必结束本轮、不必等。内置工具（read/write/edit/grep/glob）、codegraph、sysinfo 仍前台跑。

**禁止 `sleep N` 轮询。** 等外部状态（CI、部署、别人跑的任务）用一次有上限的等待：`timeout 900 gh pr checks <n> --watch`，或把等待放后台；拿不到就先结束本轮并说清「约 N 分钟后回来看」。这是本文件最常被违反的一条：实测 600 次前台 `sleep` ≥60s，纯等待 25.7 小时，单会话最高 229 分钟 / 87 次。

**跨重启（redeploy 会重启服务）：** 后台 shell 句柄随服务消失，改用 `setsid nohup cmd >/tmp/<job>.log 2>&1 </dev/null &`，并回报日志路径。

**可观测：** stdout+stderr 都写日志；脚本至少每 ~30s 一行心跳（阶段/已完成/总数/错误数），操作数据库的带行数；网络调用显式 timeout；启动 ~30s 内确认日志在真推进。启动时回报 shell ID、日志路径与预计时长；失败贴真实报错；静默约 1 分钟主动报状态；停止按进程组停。

**批量：先小样（1~5 条 / 1 页 / 1 分片）核对字段、数量与写库，再全量。** 扫描限定项目内。

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

## Filesystem: only `/workspace` survives a redeploy

- **Only `/workspace` is a mounted volume.** `/tmp`, `/var/tmp`, `/root`, `/run`, `/usr` are rebuilt from the image on every redeploy. Create worktrees **only** with `wt new <branch> [base-ref]` → `$WORKTREE_ROOT/<branch>` (default `/workspace/worktrees`); `wt list` / `wt remove` / `wt prune` for the rest. Never `git worktree add /tmp/...` and never `session_move` into such a path: a worktree on the root filesystem disappears and its session then dies with `Directory not found` — this has already cost one session 13 hours. Scratch files (logs, probe scripts, build output) may live in `/tmp`; anything a later session must find again — including a repository checkout whose work must outlive the deploy — goes under `/workspace`, because a clone in `/tmp` loses its own history too.

## 附：codegraph（分析代码的首选）

- 分析 / 查看代码优先用 `codegraph_explore`；搜索参数和符号用**英文**（代码符号都是英文字母，别用中文搜索）。
- 执行搜索 / 分析前先 `codegraph sync` 同步代码变更。常用：`sync`（增量） · `index`（重建） · `status` · `files`。
- **没有 `.codegraph/` 的项目不要自己 `codegraph init`** —— 建索引是用户的决定；告知用户该目录未建索引，然后用 grep/glob 继续。

## 浏览器

本容器只有一个浏览器：窗口化 Chromium（`DISPLAY=:1`，VNC `8444` 经 SSH 隧道给人看和操作；CDP `127.0.0.1:9222` 给 agent 用）。扫码、验证码、OAuth 回调这类步骤让用户在 VNC 里完成。

- 接同一个实例：`pw <子命令>`，或 `connectOverCDP("http://127.0.0.1:9222", {noDefaults:true,isLocal:true})`。别用 `playwright cli open`（会导航走用户当前标签页）。
- 不要另起浏览器：不 `--headless`、不换 profile / 端口、不删 `SingletonLock` —— 会顶掉可视浏览器。卡住先按 `$XDG_CONFIG_HOME/opencode/docs/browser-self-check.md` 自检，重启用 `/scripts/start-browser.sh`。

## 飞书 / Lark

容器里装了官方 `lark-cli` 且已授权（`lark-cli auth status` 能看到 user / bot 双身份），读写飞书文档、消息、表格、日历一律用它，不要自己拼开放平台 HTTP 请求。
命令、凭证路径与重新授权步骤见 `$XDG_CONFIG_HOME/opencode/docs/lark-cli.md`。
