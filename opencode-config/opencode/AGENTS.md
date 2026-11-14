# Coding Guidelines

**Tradeoff:** these bias toward caution over speed; for trivial tasks, use judgment.

**Hard rules — recall these first:** code & docs in English · model facts: models.dev · never block the session on a long script — background it (§5) · minimal, surgical changes · define a verifiable goal and loop until it passes · lead the reply with the result.

## Environment awareness

`sysinfo` (provided by the local `plugins/sysinfo/` plugin, not a built-in) reports the machine's facts — time/timezone, OS, container/CI, the container's own start time and uptime, the CPU/memory/pids quota it actually gets (cgroup, not the host's core count), disk, listening ports (externally reachable vs loopback) and Railway's public endpoints, installed tools. Use it when a task depends on them.

## Model facts

Context window, output cap, price: models.dev, not memory. A reseller row is the upstream spec, not a promise it is enforced.

## Environment: worktrees belong on the volume

`/workspace` is the only mounted volume. **Everything else is rebuilt from the image on every redeploy** — `/tmp`, `/var/tmp`, `/root`, `/run`, `/usr`. A worktree is a session's working directory, so a worktree created on the root filesystem disappears, and the session pointing at it then dies with `Directory not found: <path>` and cannot be resumed (this has already cost a session 13 hours of work).

- Create worktrees **only** with `wt new <branch> [base-ref]` → `$WORKTREE_ROOT/<branch>` (default `/workspace/worktrees`). `wt list` / `wt remove <branch>` / `wt prune` for the rest.
- Never `git worktree add /tmp/...` (or `/root/...`, `/var/tmp/...`), and never `session_move` into such a path. `wt` refuses a root outside `/workspace` for exactly this reason.
- Scratch files (logs, probe scripts, build output) may live in `/tmp` — they are throwaway by definition. Anything a later session must find again goes under `/workspace`.
- Clone/copy a repository onto the volume too when the work has to outlive the deploy: a repo checked out in `/tmp` loses its own history as well.

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

## 5. 长任务：后台跑，不要睡等

**后台（`background: true`）：** 自己写的脚本、抓取/构建/测试/迁移、预计 >10s、耗时未知、可能以「卡住」方式失败（网络、子进程、DB 锁、原生编译）。返回 shell ID 后**继续做别的**——完成事件会以 `<shell id=… state="completed">` 自己回来，不必结束本轮、不必等。内置工具（read/write/edit/grep/glob）、codegraph、sysinfo 仍前台跑。

**禁止 `sleep N` 轮询。** 等外部状态（CI、部署、别人跑的任务）用一次有上限的等待：`timeout 900 gh pr checks <n> --watch`，或把等待放后台；拿不到就先结束本轮并说清「约 N 分钟后回来看」。这是本文件最常被违反的一条：实测 600 次前台 `sleep` ≥60s，纯等待 25.7 小时，单会话最高 229 分钟 / 87 次。

**跨重启（redeploy 会重启服务）：** 后台 shell 句柄随服务消失，改用 `setsid nohup cmd >/tmp/<job>.log 2>&1 </dev/null &`，并回报日志路径。

**可观测：** stdout+stderr 都写日志；脚本至少每 ~30s 一行心跳（阶段/已完成/总数/错误数），操作数据库的带行数；网络调用显式 timeout；启动 ~30s 内确认日志在真推进。启动时回报 shell ID、日志路径与预计时长；失败贴真实报错；静默约 1 分钟主动报状态；停止按进程组停。

**批量：先小样（1~5 条 / 1 页 / 1 分片）核对字段、数量与写库，再全量。** 扫描限定项目内。

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

本容器只有一个浏览器：窗口化 Chromium（`DISPLAY=:1`，VNC `8444` 经 SSH 隧道给人看和操作；CDP `127.0.0.1:9222` 给 agent 用）。扫码、验证码、OAuth 回调这类步骤让用户在 VNC 里完成。

- 接同一个实例：`pw <子命令>`，或 `connectOverCDP("http://127.0.0.1:9222", {noDefaults:true,isLocal:true})`。别用 `playwright cli open`（会导航走用户当前标签页）。
- 不要另起浏览器：不 `--headless`、不换 profile / 端口、不删 `SingletonLock` —— 会顶掉可视浏览器。卡住先按 `/workspace/debian-railway/docs/browser-self-check.md` 自检，重启用 `/scripts/start-browser.sh`。

## 飞书 / Lark

容器里装了官方 `lark-cli` 且已授权（`lark-cli auth status` 能看到 user / bot 双身份），读写飞书文档、消息、表格、日历一律用它，不要自己拼开放平台 HTTP 请求。
命令、凭证路径与重新授权步骤见 `/workspace/debian-railway/docs/lark-cli.md`。
