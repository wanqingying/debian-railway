# Coding Guidelines

**Tradeoff:** these bias toward caution over speed; for trivial tasks, use judgment.

**Hard rules — recall these first:** code & docs in English · never block the session on a long script — background it (§5) · minimal, surgical changes · define a verifiable goal and loop until it passes · lead the reply with the result.

## Environment awareness

`sysinfo` reports the machine's facts — time/timezone, OS, container/CI, CPU/mem/disk, installed tools. Use it when a task depends on them.

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
- 可能挂起，或以「卡住」方式失败（网络、子进程、DB 锁、原生编译）。

内置工具（read/write/edit/grep/glob/codegraph/sysinfo）很快，正常前台跑。

**怎么跑：**
- 用 shell 工具的后台模式（`background: true`）：立即返回 shell ID，输出写文件，完成时自动通知。**不要 sleep 轮询。**
- 别指望前台调用里 `cmd &`：工具会等 stdout EOF，仍可能阻塞。要手动脱离：`setsid nohup cmd >/tmp/<job>.log 2>&1 </dev/null &`。
- 要跨重启（更新 / redeploy 会重启服务）：后台 shell 句柄随服务消失 → 改用 `setsid nohup …`，并回报日志路径。

**批量任务：先小样，再全量。** 全量运行前必须先用小批量（1~5 条 / 1 页 / 单分片）试跑，核对输出字段、数量、边界与写库结果符合预期，确认后再放大到全量。

**可观测（长任务必须）：**
- stdout+stderr 都重定向到日志，绝不丢输出。
- 脚本自报进度，**至少每 ~30s** 一行心跳：阶段 / 已完成 / 总数 / 耗时 / 错误数。`tail -f` 一眼看出「在跑」还是「卡死」。
- 操作数据库：日志里带行数 / 影响行数 / 每阶段 `COUNT(*)`。
- 早期体检：启动后 ~30s 内确认日志在真实推进，而不是启动即错（参数错、缺依赖、DB 锁）——先修好再放手。
- 给边界：超时 / 最大条数 / 检查点，避免无限挂起。网络调用显式设 timeout（默认可能是无限）。

**回报：**
- 启动时：报 shell ID、日志路径、怎么看、预计时长。
- 失败时：贴日志里的真实报错，不许吞。
- 静默 ~1 分钟 → 主动报状态；绝不留下静默长任务。
- 停止按进程组停；别杀「还有子进程的父进程」（会留孤儿）。
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

- 分析 / 查看代码优先用 `codegraph_explore`；搜索参数和符号用**英文**（代码符号都是英文字母，别用中文搜索）。
- 执行搜索 / 分析前，先 `codegraph sync` 同步代码变更。
- 常用命令：`codegraph sync`（增量同步） · `index`（重建） · `status`（状态/统计） · `files`（文件结构） · `init`（初始化并建索引）。
