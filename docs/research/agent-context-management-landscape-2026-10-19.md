# 开源 agent 上下文管理 / 压缩 / 总结方案全景 —— 与 magic-context 的定位对比

**Question:** 当前主流的、开源的 agent 上下文管理 / 压缩 / 总结方案有哪些？它们在机制上如何分层与取舍？我们正在用的 magic-context 处在什么位置、缺什么、要不要换或补？
**Date:** 2026-10-19 **Depth:** deep
**Sources:** 81（约 55 个 T1 一手来源；元数据取自 GitHub REST API，读取日 2026-10-19）· **Cutoff:** 代码/文档最新至 2026-10-19；论文含 2026-10 月新作

---

## TL;DR

- **这个领域不是一个赛道，而是分成若干层。** 把"上下文管理"混为一谈是选型出错的最大原因：服务层（KV cache）、宿主层（harness 自带 compaction）、**工具输出沙箱层**（context-mode 一类，从入口拦）、上下文整形层（分层摘要/折叠）、记忆层（跨会话长期知识）、检索结构层（RAPTOR/GraphRAG）、文本压缩层（LLMLingua）。各层解决不同问题，互相不能替代 [S73][S1][S29][S68][S49][S82]。
- **magic-context 是"上下文整形层 + 记忆层"的合体，而且是当前唯一把「不停机压缩」「缓存前缀稳定」「自动沉淀项目记忆」「agent 主动弃置」四件事同时做在一个插件里的方案**（对比 Claude Code/Gemini CLI 的 stop-the-world compaction 与 Cline 的手工 Memory Bank）[S28][S2][S12][S14]。它为此付出的代价是：只覆盖 OpenCode / Pi / OMP 三个宿主，且没有任何公开 benchmark。
- **决定成败的不是压缩率，是压缩发生的时机相对于提示词缓存前缀。** 停下来的全量重写（Claude Code `/compact`、Gemini `/compress`、Cline Auto Compact）会击穿前缀缓存；Manus 实测缓存价与非缓存价差 **10 倍**（$0.30 vs $3/MTok），magic-context 的 cache-stable / 延迟应用设计正是冲着这笔钱去的 [S2][S12][S14][S23][S28]。
- **压缩到底提升还是损害 agent 成功率，学界没有共识。** 一边是 AgentFold token 降 92%、ACON 峰值 token 降 26–54% 且成功率上升；另一边 SWE-agent 的消融显示"只保留最近 5 条观察"18.0 分 vs 全历史 15.0 分（有收益，但去掉示例反而 ≥ 折叠，说明收益不单调），GraphRAG-Bench 更指出结构化检索常被朴素 RAG 追平 [S61][S63][S67][S72]。
- **最大的不确定：几乎所有效果数字都是厂商/作者自报。** Mem0 的 92.5/94.4 明确声明只属于其托管平台而非开源 SDK；Zep、MemOS、MIRIX、Supermemory 同样没有独立复现 [S32][S33][S37][S40][S48]。

---

## Method

- **子问题：** ① magic-context 实际能力（本地实测）② 编码/通用 agent 宿主内置的上下文管理 ③ 独立 agent 记忆框架 ④ token/轨迹级压缩技术与研究 ⑤ 检索层层次化压缩 ⑥ KV-cache / 缓存感知层。
- **来源族：** 官方文档站（anthropic.com/engineering、docs.claude.com、platform.claude.com、opencode.ai、aider.chat、docs.cline.bot、zed.dev、docs.letta.com、redis.io）；项目 README 与仓库（GitHub REST API 取 stars/license/pushed_at）；arXiv 论文原文；工程博客一手页（Manus、Cognition、Chroma）；npm 包本地实例（magic-context 0.49.12）。
- **覆盖缺口（已补）：** 第一版按"历史怎么缩"找方案，漏掉了从**工具输出入口**下手的一类；`mksglu/context-mode` 指出后已补入 §2.5（含本地源码实测）。这说明按单一维度枚举会系统性漏掉正交层的方案 —— 若还有第 8 类（例如只在**模型侧**做窗口管理、或只在**提示词层**做去重），本报告未覆盖。
- **不可得 / 限制：** 容器内 arXiv export API 与 Semantic Scholar 全时段 429，引用量缺失，改为读 `arxiv.org/abs/*` 页面；Goose / Continue.dev / Kilo Code / Amp / Semantic Kernel 的文档站部分 404，这几项只拿到仓库元数据，未取到机制细节；Claude Code 的 auto-compact 阈值页不可达，只确认了"存在且可配置"；**没有任何一项效果数字有独立第三方复现**。
- **独立校验：** 20 条关键结论交由一个独立 worker 逐条重取原文核对。结果：**17 条 SUPPORTED**（其中 11 条是论文/官方文档的原文级确认），**3 条按原措辞不成立并已在下文修正** —— ① OpenCode 的 `compaction.prune` 在 v2 已被移除（本仓库用的就是 v2）；② Cline 的 Memory Bank 是需自行启用的官方方法论，不是内建功能；③ Letta"替换了内存块"说法过强（实为 legacy 共存）。另发现 Mem0 / Zep 的数字存在**可核查的复现反证**，见文末。

---

## Findings

### 0. 先分层：各层解决不同问题（本报告的分析框架）

| 层 | 问题 | 代表方案 | 是否改变 token 数 |
|---|---|---|---|
| **L0 服务/缓存层** | 同样的前缀能不能不重算 | vLLM APC、SGLang RadixAttention、LMCache/CacheBlend、Mooncake、GPTCache/Redis LangCache | 不变 token，改**成本与延迟** |
| **L1 宿主内置层** | 窗口满了怎么办 | Claude Code auto-compact、OpenCode compaction、Codex `/compact`、Gemini `/compress`、Cline Auto Compact+Memory Bank、Aider repo map、Zed auto_compact | 减（一次性、破坏性） |
| **L1.5 工具输出沙箱层** | 大块工具输出别进上下文 | **context-mode**（ctx_execute / ctx_index + FTS5 按需检索）、Anthropic 的 code execution + 渐进披露、claude-context、Serena | 减在**入口**（历史本身不变） |
| **L2 上下文整形层** | 老历史怎么持续缩、又不打断 | **magic-context**、Manus 的 restorable compression、AgentFold、ReSum、ACON、ACE、SWE-agent history processor | 减（持续、可逆） |
| **L3 记忆层** | 跨会话的知识放哪、怎么找回来 | Letta/MemGPT、Mem0、Zep/Graphiti、Cognee、MemOS、A-MEM、MemoryOS、MIRIX、HippoRAG、Basic Memory、MemU… | 增（按需注入） |
| **L4 检索结构层** | 大语料怎么按需取而不是全塞 | RAPTOR、GraphRAG、LightRAG、KAG | 减（取多少算多少） |
| **L5 文本压缩层** | 同一段文本怎么塞得更省 token | LLMLingua 家族、RECOMP、gist/AutoCompressor、xRAG、Provence | 减（有损、改写文本） |

**这个分层是本次调研最重要的结论**：选型时先问"我要解决的是哪一层的问题"。把 L5 的 LLMLingua 拿去管 agent 历史是错配（它会把历史改写成不可逆的文本，破坏前缀缓存）；把 L3 的 Mem0 当作上下文压缩机也是错配（它只负责把事实抽出来，不负责缩小窗口）[S49][S31][S1]。

---

### 1. magic-context 现在在做什么（基线，实测 0.49.12，MIT，`cortexkit/magic-context` 2352★，2026-03-26 创建，2026-10-18 仍在推送）[S28][S81]

它的自述是"给编码 agent 的海马体"，机制上横跨 L2 与 L3，且刻意避开 L1：

- **L2 · Historian 分舱（compartmentalization）**：后台 historian 把旧原始历史压成**分层摘要舱（tiered compartments）**，每舱带 importance 分数。LLM 调用是后台的，主 agent 不停机 —— 这是它与所有 `/compact` 类方案的根差别 [S28]。
- **L2 · Decay rendering（衰减渲染）**：按"距当前多久"用**确定性、无 LLM** 的规则决定每个舱渲染到多细，且会自适应模型的上下文窗口。确定性意味着同样的历史永远渲染成同样文本 —— 这是缓存可命中性的前提 [S28]。
- **L2 · 缓存稳定布局 + 延迟应用**：所有后台工作被组织成**不使提示词前缀失效**；agent 调 `ctx_reduce` 标记要丢的内容，丢弃是**排队 + 缓存感知**的，只在缓存安全点落地 [S28]。
- **可选 · caveman 文本压缩**：对最老的 user/assistant 文本按年龄分档做确定性压缩（默认关）—— 这是它唯一触及 L5 的地方 [S28]。
- **L3 · 记忆自动沉淀**：historian 在同一遍里顺手把决策/约束/约定/配置值抽成**项目记忆**（5 个类目：PROJECT_RULES / ARCHITECTURE / CONSTRAINTS / CONFIG_VALUES / NAMING）。"记忆是压缩的副产品"是这个设计最巧的一点 [S28]。
- **L3 · Dreamer 夜间整合**：7 个定时任务（map / verify / verify-broad / curate / classify / retrospective / evaluate-smart-notes），验证记忆对得上代码、合并重复、提升用户的 `<user-profile>` [S28]。实测配置见本仓库 `magic-context.jsonc`。
- **L3 · 召回面**：`ctx_search`（记忆 + 历史 + git commit + note + primer，embedding + 全文回退）、`ctx_expand`（把压缩区间**还原成原始 U:/A: 转写**）、`ctx_note`（带 surface_condition 的智能便签）、每轮自动注入 + auto_search 提示 [S28]。
- **工程成熟度信号（少见，值得记一笔）**：仓库自带 **mutation testing 目录**（故意破坏每个 guard，要求指定测试变红）、三个 sentinel 脚本（cache-bust / transform-latency / subagent-failure），其中 cache-bust sentinel 专门审计"不是由自身 fold/refresh/reduce 引起的"缓存击穿 [S28]。这说明"缓存稳定"对它是被度量的硬指标，不是营销词。
- **边界与代价**：只支持 OpenCode / Pi / OMP；安装时会**主动关掉宿主 compaction**并**与其他上下文管理插件互斥**（会自禁用，fail-safe）[S28]。无公开 benchmark。跨 harness 共享同一 `context.db`。

---

### 2. L1 宿主内置层：绝大多数方案是"停下来重写一遍"

| 方案 | 机制 | 触发 | 缓存影响 | 许可证 / 活跃度 |
|---|---|---|---|---|
| **Claude Code** | auto-compaction 总结历史；`/compact` 可带自定义指令（`/compact Focus on code samples`）；`/clear`；CLAUDE.md（建议 <200 行，`MEMORY.md` 前 200 行/25KB 每轮加载）；压缩后**重新读入最多 5 个最近修改的文件**并重新注入已调用的 skill。2026 版文档进一步给出可配置的 auto-compact 窗口、可用 `autoCompactEnabled:false` 关掉自动压缩而保留手动 `/compact`，且压缩是**分级级联**（先清旧 tool 输出 → … → 全量总结）[S2][S3][S4] | 接近窗口上限 | 一次性重写 → 击穿 | 闭源；生态事实标准 |
| **Anthropic API（服务端）** | `context-editing` beta（`clear_tool_uses_20250919`，按 input_tokens 阈值触发、保留最近 N 个 tool_use）；`memory_20250818` 文件式记忆工具（`/memories`）；**服务端 compaction**（beta `compact-2026-09-04`）[S5][S6][S7] | 按规则/阈值 | 规则化清理可保持前缀 | 闭源 API |
| **OpenAI Codex CLI** | `/compact` 压缩当前会话；`/init` 生成 AGENTS.md；实验性 `memories` 开关 [S11] | 手动/自动 | 一次性 | Apache-2.0，129.8k★ |
| **Gemini CLI** | `/compress` **把整个对话上下文替换成一份摘要**；`GEMINI.md` 层次化记忆；`/clear` 开新会话 [S12] | 手动/自动 | 全量替换 → 击穿 | Apache-2.0，107.4k★ |
| **OpenCode（我们的宿主）** | **v1**：`compaction.auto` / `compaction.prune`（删旧 tool 输出，默认 false）/ `reserved`。**v2（本仓库在用）已换 schema**：`compaction.auto`（默认 true）/ `compaction.keep.tokens`（15000）/ `compaction.buffer`（20000），**`prune` 已不存在** [S13] | 窗口满 | 一次性 | MIT，216.7k★ |
| **Cline** | **Auto Compact** 是内建功能（到限即总结；非 Anthropic 模型回退到规则截断）。**Memory Bank** 是官方**文档化的方法论**而非内建功能：需自己写进 custom instructions 或 `.clinerules`（projectbrief / productContext / activeContext / systemPatterns / techContext / progress）[S14] | 窗口满 / 手工 | 一次性 | Apache-2.0，70.5k★ |
| **Roo Code** | 同类 Memory Bank 模式，但**仓库已 archived（2026-05-15）**，社区接棒到 Kilo Code（MIT，27.6k★，活跃）[S81] | — | — | Apache-2.0，已归档 |
| **Aider** | 不压缩对话，而是压**代码上下文**：用 **graph ranking（PageRank 类）** 在"文件为节点、依赖为边"的图上算 repo map，按 `--map-tokens`（默认 1k）预算裁剪，`--map-refresh=auto`，`--map-multiplier-no-files`（默认 2）[S15] | 每次请求 | 前缀稳定（map 变化才失效） | Apache-2.0，49.6k★ |
| **Zed** | `agent.auto_compact` 阈值自动压缩 + 手动 `/compact`；小窗口模型走"摘要 + 新线程" [S16] | 阈值 | 一次性 | GPL/AGPL+，91.9k★ |
| **Crush (Charm)** | Agent Skills + `CRUSH.md`/`AGENTS.md` 全局上下文 + LSP/MCP [S27] | — | — | FSL-1.1-MIT，28.7k★ |
| **框架类** | OpenAI Agents SDK：Session + `OpenAIResponsesCompactionSession`（服务端 `responses.compact`）；Google ADK：`Session`/`State` 短期 + 可搜索 `MemoryService`（内存 / Vertex Memory Bank / RAG）；LangChain：checkpointer + `SummarizationMiddleware(trigger=("tokens",4000), keep=("messages",20))` + trim/delete/summarize；LlamaIndex：`ChatMemoryBuffer`（`token_limit` 30000、`chat_history_token_ratio` 0.7、`token_flush_size` 3000）/`ChatSummaryMemoryBuffer`；CrewAI：单一 `Memory` 类按 `semantic + recency + importance` 复合打分；AutoGen：`Memory` 协议（query/update_context/add/clear）[S17][S18][S19][S20][S21][S22] | 阈值 | 多为一次性 | 均开源 |

**这一层的共同形状**：等到窗口满 → 停下来 → 重写一遍 → 知识**有损丢弃**。

#### 2.5 L1.5 —— 工具输出沙箱层：context-mode（本报告第一版漏掉的一类）

**覆盖缺口说明**：第一版只按"历史怎么缩"找方案，漏掉了从**入口**下手的这一类 —— 直到被 `mksglu/context-mode`（30,876★ / 2,297 fork / 2026-02-23 创建 / 最后推送 2026-10-19，**ELv2 许可证**，本地实测 v1.0.169）指出。它自述"The other half of the context problem"，抓的确实是我漏掉的那一半。

| 维度 | **magic-context** | **context-mode** |
|---|---|---|
| 攻击面 | **历史侧**（已进入上下文的内容） | **入口侧**（工具输出根本不让进去） |
| 支柱 | 后台 historian 分舱摘要 + 衰减渲染 + 缓存稳定；记忆自动沉淀 + dreamer 整合 | ① 沙箱执行（只回 stdout）② 会话状态连续性（SQLite 事件 + FTS5/BM25 检索）③ "think in code"（让模型写脚本而不是读 50 个文件）④ **不**约束模型的文风 |
| 生效机制 | 后台 LLM（historian/dreamer）+ 5 个 `ctx_*` 工具 | 钩子强制路由（`tool.execute.before` 可**拦截/拒绝** Bash、Read、Grep、WebFetch）+ 11 个 `ctx_*` 工具 |
| 压缩对象 | 对话历史（LLM 摘要，**可 `ctx_expand` 还原原文**） | 工具输出（确定性地丢弃原文；>5KB 且有 intent 时索引进 FTS5 只回相关片段） |
| 是否动宿主的 compaction | **关掉它**（接管上下文管理） | **依赖它**（在 PreCompact 钩子里生成 resume 快照） |
| 跨会话知识 | 有：项目记忆（5 类目）+ primer + note + git 索引 + `<user-profile>` | **无**：只保"工作状态"（改过哪些文件、任务、错误、决策），不沉淀可复用知识。它读 `~/.claude/projects/<proj>/memory/*.md` 只为**统计**，不自己写记忆 |
| 平台覆盖 | 3（OpenCode / Pi / OMP） | 17（Claude Code、Gemini CLI、Codex、Cursor、Copilot 系、Kimi、Qwen、Kiro、Zed、Antigravity、OpenCode、KiloCode、OpenClaw、Pi、OMP…） |
| 缓存前缀 | 硬约束：确定性渲染 + 丢弃排队到缓存安全点，还写了 cache-bust sentinel 去度量 | **不保证**：每个会话首发注入 routing block，且每 N 次工具调用重新注入一次引导（`CONTEXT_MODE_EXTERNAL_MCP_NUDGE_EVERY` 默认 10，"最激进时每次 +~250 token"）—— 这会改动 system prompt |
| 许可证 | MIT | **Elastic License 2.0（source-available）**：可自用/改/分发，但**不得做成托管服务**、不得移除许可声明 [S84] |
| 依赖 / 运行时 | 无原生依赖（纯 TS 插件） | Node ≥ 22.5（或 Bun），`better-sqlite3` 原生模块（Linux+Node≥22.5 自动改用 `node:sqlite`） |
| 自报效果 | 无公开 benchmark | 21 个场景总节约 **96%**（376 KB → 16.5 KB）；单场景 95–100%；"会话时长 ~30 分钟 → ~3 小时"；宣称 ~98% 合规（有钩子）/ ~60%（无钩子）。均为自己的 fixture 实测 |
| 隐私 | 全本地 `context.db` | 源码内**无自动外传**（仅 npm registry 版本检查、GitHub 升级、打开 `context-mode.com/insight`）；但它内置的是一个**托管 B2B 分析产品**的 rollup schema（"per-engineer productive rate / retry waste / blocker detection"，角色视图面向 CTO/EM/CISO/FinOps），且仓库里 `stats.json` 直接公布用户数（696k+/npm 640.9k+） |

**两者不是竞品，是互补的两半** —— 但有**两处真实摩擦**，安装前必须验证：

1. **工具名撞车。** 两边都注册 `ctx_search`（magic-context：`ctx_reduce`/`ctx_search`/`ctx_memory`/`ctx_note`/`ctx_expand`；context-mode：11 个含 `ctx_search`）。两个 OpenCode 插件都通过 `plugin` 的 `tool` 映射注册，同名工具的归属由加载顺序决定，未做冲突检测（context-mode 代码里搜不到任何针对 magic-context/DCP 的互斥检查）。**需实测**：装上后确认 `ctx_search` 落到哪一个、另一个是否静默失效。
2. **设计上互斥的那一点：compaction。** magic-context 会**关掉**宿主 compaction；context-mode 的会话连续性主要靠 `PreCompact` 钩子生成快照。关掉 compaction 后 `experimental.session.compacting` 不再触发，context-mode 退化为只能靠 resume 路径恢复工作状态 —— 它的"工作状态连续性"支柱会打折。

**结论**：context-mode 值得加进候选池，尤其它覆盖 17 个平台、能强制约束"别把 56 KB 的 Playwright 快照灌进上下文"，这是 magic-context 完全不管的一侧。但在我们这个容器里，两者同时上的收益要**减去**上面两条摩擦的成本；如果只允许一个，我们对"长期单会话 + 缓存成本"的诉求仍然更匹配 magic-context。Anthropic 自己最新的工程结论是"compaction 还不够"，需要 initializer agent + 增量 coding agent + 进度文件 [S9]；Anthropic 把长时程策略归纳为 **compaction / structured note-taking / sub-agent** 三招 [S1]。而 Cognition 的立场相反，明确反对多 agent fan-out，主张"共享完整轨迹 + 用压缩模型处理历史" [S24]。**两家 T1 在这点上直接冲突，未被调和**，见 Confidence 节。

---

### 3. L3 独立记忆框架：热闹、可组合、也最容易装了没用

| 项目 | 架构 | 许可证 / ★ / 最近推送 | 与编码 agent 的对接 | 自报效果 |
|---|---|---|---|---|
| **Letta（原 MemGPT）** | 主力已转向 **MemFS**：agent 自己编辑的、git 版本化的记忆文件系统，记忆根下的文件每轮进 system prompt，其余只暴露文件树（`system/` 目录是**较旧的**布局）；旧的内存块仍在但已被标记 legacy，不是删除 [S30]。原始 OS 式虚拟上下文管理见 MemGPT 论文 [S29] | Apache-2.0（`letta-ai/letta` 25.2k★ / 活跃源码 `letta-code` 3.7k★）/ 2026-10-18 | SDK + CLI + **MCP/ACP**；`letta-code` 本身是 harness | 当前 harness 无公开 benchmark |
| **Mem0** | 抽取→合并→检索会话事实；`Mem0ᵍ` 加图 | Apache-2.0，67.4k★ / 2026-10-17 | Python/TS SDK + **Agent Skills**（明列 Claude Code / Codex / Cursor / Windsurf / **OpenCode**）| 论文：LOCOMO 上 LLM-as-Judge 相对 OpenAI +26%，p95 延迟 −91%，token −>90% [S31]。**README 明确声明 92.5/94.4 是托管平台数字，开源 SDK 达不到** [S32] |
| **Zep + Graphiti** | **双时间（bi-temporal）知识图谱**：每条事实带 validity window，episode 作为溯源，社区摘要 | Apache-2.0，Graphiti 32.0k★ / 2026-10-19 | Python/TS SDK + **MCP**；无编码 agent 专属插件 | 论文：DMR 94.8% vs MemGPT 93.4%，LongMemEval 最高 +18.5%，延迟 −90% [S33][S34]。**厂商自著，无独立复现** |
| **Cognee** | ECL 管线把文档/代码/对话灌成知识图谱；1.0 起整套记忆层（图+向量+关系）跑在单个 Postgres 上 | Apache-2.0，32.5k★ / 2026-10-18 | 官方 **Claude Code memory plugin** + MCP（Cursor/Cline）[S35] | 只有 BEAM 报告文件，README 未给单一分数 |
| **MemOS** | "记忆操作系统"，MemCube 作为可跟踪/融合/迁移的记忆单元；L1 轨迹 / L2 策略 / L3 世界模型 | Apache-2.0，11.9k★ / 2026-10-17 | SDK + **MCP** + OpenClaw / Hermes 官方插件 [S36][S37] | 自报 LoCoMo 88.83、LongMemEval 89.20、OpenClaw 任务完成率 36.63%→50.87%、token 省 35.24% |
| **A-MEM** | Zettelkasten 式：动态索引 + 链接，新记忆**可以反过来改写旧记忆的上下文表示** | MIT，1.2k★，**最后推送 2025-12-12（已停滞）** [S38] | 无 MCP、无插件 | NeurIPS 2025，"优于现有 SOTA"，摘要无绝对表 |
| **MemoryOS** | OS 式三层（短/中/长期个人记忆），短→中按对话链 FIFO，中→长按分段页整理 | Apache-2.0，1.6k★ / 2026-07-07 | **MemoryOS-MCP** [S39] | EMNLP 2025 Oral：LoCoMo 上 F1 +49.11%、BLEU-1 +46.18% |
| **MIRIX** | 六类记忆（Core/Episodic/Semantic/Procedural/Resource/Knowledge Vault）+ 多 agent 协调，面向屏幕录制助手 | Apache-2.0，3.5k★ / 2026-10-08 | `pip install mirix-client`；无 MCP | ScreenshotVQA +35% 准确率、存储 −99.9%；LoCoMo 85.4% [S40] |
| **HippoRAG / 2** | 海马体索引：LLM + 开放 KG + **Personalized PageRank** 做单步多跳检索 | MIT，4.1k★ / 2026-10-06 | 研究库，无 MCP | NeurIPS 2024 / ICML 2025：单步检索媲美 IRCoT 而**便宜 10–30×、快 6–13×**；HippoRAG 2 关联记忆 +7% [S41] |
| **Basic Memory** | Markdown/Obsidian 文件即知识库，wikilink 形成知识图谱 + 语义搜索 | AGPL-3.0，4.3k★ / 2026-10-18 | **MCP 原生**（几乎所有客户端）[S43] | 无 benchmark；优势是人可读、可 git |
| **Serena** | 语义代码检索/编辑/重构工具 + 项目记忆（不是会话记忆库） | GPL-3.0-or-later（SPDX 未标），30.4k★ / 2026-10-15 | **MCP**，支持 Claude Code / Codex / **OpenCode** / Gemini CLI [S44] | — |
| **claude-context (Zilliz)** | 把代码库存向量库，只把相关代码送进上下文 | MIT，12.6k★ / 2026-07-14 | **MCP** 插件 [S45] | — |
| **MCP 官方 memory server** | 本地知识图谱（entities/relations/observations），observation 要求原子化 | 在 `modelcontextprotocol/servers`，91.4k★ | MCP [S46] | 玩具级参考实现 |
| **MemU / Supermemory / ByteRover(原 Cipher) / Engram / Memobase / Memary / LightMem / Nemori** | 多数走"读宿主 session 原始日志 → 写回 agent 原生文件（CLAUDE.md / AGENTS.md）"或 SQLite+FTS5+MCP | MemU 14.6k★、Supermemory 31.3k★（MIT）、ByteRover 5.0k★ **已归档**、Engram 7.4k★（Go）、Memobase 2.9k★（**2026-01 起闲置**）、Memary **2024-10 起休眠**、LightMem 1.2k★、Nemori 213★ [S47][S48][S42][S81] | MCP / 文件回写 | Supermemory 自称"所有主流记忆 benchmark 第一"，未验证 |

**关键观察**：这一层有 30+ 个项目，但**真正与编码 agent 咬合的是两类**——(a) 文件回写型（MemU、Basic Memory、ByteRover），把记忆变成人可读的 Markdown；(b) MCP 服务型（Mem0、Zep、Cognee、Serena、claude-context），通过 MCP 挂到任意客户端。**注意 `mem0ai/openmemory` 已改做"会话跨工具搬运 CLI"，不再是 Mem0 的 MCP 服务** [S81]。

---

### 4. L5 文本压缩 + L2 轨迹折叠研究

**(A) token 级压缩（有损、改写文本）**

| 方案 | 机制 | 压缩率 / 效果（论文自报） | 开源 |
|---|---|---|---|
| **LLMLingua** | 粗到细的困惑度驱动 token 裁剪 | 最高 **20×** 压缩，性能损失很小 [S49] | MIT，6.8k★ |
| **LongLLMLingua** | 针对长上下文 QA 的压缩 | NaturalQuestions **+21.4%** 且 token 少约 4×；LooGLE **成本 −94%**；10k 提示压 2–6× 时端到端延迟 **1.4–2.6×** [S50] | 同上 |
| **LLMLingua-2** | 重构成 token 分类（XLM-R / mBERT 级），比 LLMLingua **快 3–6×**，跨域更稳 | 3×–6× faster [S51] | 同上 |
| **RECOMP** | 把检索文档压成抽取式/抽象式摘要，无关时**返回空串** | 压缩率低至 **6%** 且损失极小 [S52] | MIT（`carriex/recomp`） |
| **Gist tokens / AutoCompressor / ICAE** | 软提示蒸馏：把 prompt 压成可缓存的 gist / 摘要向量 | gist 最高 **26×**、FLOPs −40%；ICAE 约 1% 额外参数达 **4×**；AutoCompressor 支持 30,720 token 训练 [S53][S54][S55] | 均有代码，但 **AutoCompressors / xRAG 无 license 文件** |
| **xRAG / 500xCompressor / Provence** | 用检索器 embedding 当"一个 token"代表整篇文档；或把剪枝建成序列标注 | xRAG 六任务平均 **+10%**、FLOPs −3.53×；500xCompressor **6×–480×** 但只保留 **62.26–72.89%** 能力；Provence 剪枝近乎无损 [S56][S57][S58] | 多为研究代码 |
| 综述 | 硬提示 vs 软提示二分；2025 上位综述把"上下文管理/压缩"列为 Context Engineering 三大组件之一（覆盖 1400+ 论文） | [S59][S60] | — |

**(B) L2 轨迹级折叠（更贴近 agent 真实场景，也是 magic-context 所在的层）**

| 方案 | 机制 | 结果（论文自报） | 开源实现 |
|---|---|---|---|
| **AgentFold** | agent **主动折叠**自己的轨迹（细粒度凝练 ↔ 深度整合），上下文近亚线性增长 | 第 100 轮上下文比 ReAct 小 **84k token（92%）**；BrowseComp 36.2% / BrowseComp-ZH 47.3% [S61] | **无官方仓库** |
| **ReSum** | 可插拔外部工具**周期性**把交互历史压成摘要；GRPO 版做长程信用分配 | 免训练 +4.5%，ReSum-GRPO 再 +8.2%，仅用 1K 训练样本 [S62] | **无官方仓库** |
| **ACON（微软）** | 在自然语言空间**优化压缩准则**，不改参数，可蒸馏到小模型 | 峰值 token **−26–54%** 且成功率高于既有压缩基线；让小模型当长时程 agent 最高 **+46%** [S63] | **MIT，`microsoft/acon` 126★（2025-10 后停更）** |
| **ACE** | 把上下文当作**演进的 playbook** 增量维护，避免"简报偏差"与上下文坍塌 | agents +10.6%、finance +8.6%；AppWorld 榜追平生产级 agent [S64] | **无官方仓库** |
| **Dynamic Cheatsheet** | 自策展一份持续演化的速查表（策略/代码片段），而非整段转写 | Game of 24 从 10% → **99%**；GPQA-Diamond +9% [S65] | 无 |
| **ReFold** | 免训练的**可逆渲染层**：底层历史保留，只压缩渲染出来的上下文，错删可恢复 | token 最多 −2.5×，KV 内存减半，受限预算下避免 92% 的强制压缩 [S66] | 无 |
| **SWE-agent** | history processor：最近 5 条观察之前的历史折叠成一行 | SWE-bench dev 消融：折叠 **18.0** vs 全历史 15.0 vs 去示例 16.3；SWE-bench 全测试集 pass@1 12.47% [S67] | MIT，20.6k★ |
| **Manus（工程实践）** | 前缀稳定优先、文件系统当可恢复上下文、recite 目标（todo.md）、**故意保留错误轨迹**、压缩必须可恢复 | 缓存价差 10×；强调"压缩策略始终设计成可恢复" [S23] | 闭源 |
| **Anthropic（工程实践）** | compaction + structured note-taking + sub-agent；tool 响应默认限制 25,000 token；用 code execution + 渐进披露把 MCP 工具定义从 150k token 压到 2k（**省 98.7%**）[S1][S8] | [S1][S8][S9] | 闭源 |

**这组数字最有价值的一条**：AgentFold / ReSum / ACE 这三项**机制有、可复用实现缺**（无官方仓库）。如果你要的是"agent 自己折叠上下文"的能力，目前在开源里没有可以直接拿来用的东西 —— 只有 ACON 有（且已停更）。

**(C) L4 检索结构层**

| 方案 | 机制 | 结果 | 成本 |
|---|---|---|---|
| **RAPTOR** | 自底向上递归"嵌入-聚类-摘要"建树 | QuALITY 绝对准确率 **+20%** [S68] | 仓库最后推送 2024-09，停滞 |
| **GraphRAG（微软）** | 实体 KG + 预生成**社区摘要**，local/global 两种查询 | 全局性问题上相对朴素 RAG comprehensiveness 胜率 **72–83%**（p<.001）[S69] | 索引 token 成本极高（见下） |
| **LightRAG** | 图结构 + 双层检索，支持低成本增量更新 | Legal 数据集上 NaiveRAG 16.4% vs LightRAG 83.6%；检索阶段 token 成本 GraphRAG 610× vs 本方案 **<100×** [S70] | MIT，40.2k★ |
| **KAG** | 逻辑形式引导的混合推理 | 2wiki F1 +19.6%、HotpotQA +33.5% [S71] | Apache-2.0，9.1k★ |
| **GraphRAG-Bench（负结果）** | 什么时候图上真的有用 | **"简单事实检索任务上，基础 RAG 追平 GraphRAG"**；多跳 +4.5% 但延迟 2.3×；需实时知识更新的问题准确率 **−16.6%** [S72] | MIT，511★ |

---

### 5. L0 服务 / 缓存层：决定"压缩"到底值多少钱

| 方案 | 机制 | 效果 |
|---|---|---|
| **vLLM Automatic Prefix Caching** | 按 block 哈希前缀复用 KV block；v0.11 起默认 sha256；`cache_salt` 做多租户隔离 | "几乎白拿"的优化，不改输出 [S73] |
| **SGLang RadixAttention** | **radix tree** 管理 KV 复用 + LRU 淘汰 + cache-aware 调度 | 兼容连续批处理与 paged attention [S74] |
| **LMCache + CacheBlend** | 不只复用前缀：**任意重复文本块**的 KV 都可复用，块边界只选择性重算少量 token | CacheBlend（EuroSys'25 最佳论文）：TTFT **−2.2–3.3×**、吞吐 **+2.8–5×**，质量几乎无损；RAG 场景命中率近 100% [S75][S76] |
| **Mooncake（Kimi）** | KVCache 为中心的**分离式**架构（prefill/decode 分离 + CPU/DRAM/SSD 池化），Conductor 全局调度 | 模拟场景吞吐最高 **+525%**；真实负载下 Kimi 多承接 **75%** 请求；FAST'25 最佳论文 [S77] |
| **KV cache 压缩（正交技术）** | StreamingLLM（attention sink + 滑窗）、H2O（heavy hitter 累积注意力）、SnapKV（观察窗投票）、KNorm、R-KV、PyramidKV、DynamicKV | 有综述 [S78]。**同时有明确负面结果**：压缩会依赖策略与模型、并导致 **system prompt 泄漏** 与指令遵循退化 [S78] |
| **语义缓存** | GPTCache（embedding 相似度命中，命中时响应快 **2–10×**）；Redis LangCache / RedisVL `SemanticCache`（距离阈值 0.1） | 省的是**整个 LLM 调用**，不是 token [S79][S80] |

**为什么这一层对上层重要**：SaaS 供应商（Anthropic / OpenAI / DeepSeek / Moonshot）的前缀缓存是**自动**的，缓存价差在 **10×** 量级 [S23][S73]。这直接把"缓存前缀稳不稳定"从工程洁癖变成账单问题 —— 也解释了为什么 magic-context 把 cache-stable 当作硬约束、并写了 cache-bust sentinel 去度量 [S28]。

---

## Comparison —— 定位决策表

把"上下文管理"最常见的五种诉求拿去套各方案（●=主要能力，○=有但弱/需自建，—=无）：

| 诉求 → | 不停机压缩 | 缓存前缀稳定 | 跨会话记忆 | 语义检索召回 | 可还原原文 |
|---|---|---|---|---|---|
| **magic-context** | ● | ●（含 sentinel 度量） | ●（自动沉淀） | ●（记忆/历史/git/note/primer） | ●（`ctx_expand`） |
| Claude Code / Codex / Gemini CLI | —（停下来重写） | — | ○（CLAUDE.md / AGENTS.md / GEMINI.md） | ○ | — |
| Cline / Kilo Memory Bank | — | — | ○（手工维护 md） | — | — |
| Aider | —（压的是代码上下文） | ●（repo map 变化才失效） | — | ○（repo map 即检索） | — |
| Letta / MemGPT | ○（agent 自管，需自建循环） | ○ | ●（MemFS / 记忆块） | ● | ●（文件） |
| Mem0 / Zep / Cognee | —（只管记忆，不管窗口） | — | ● | ● | — |
| LLMLingua 家族 | ●（但改写文本） | —（改写即失效） | — | — | — |
| RAPTOR / GraphRAG / LightRAG | —（压的是检索语料） | — | — | ● | ●（源文档仍在） |
| vLLM APC / LMCache / Mooncake | — | ●（服务侧） | — | — | — |

**读法**：magic-context 是这张表里唯一同时有前三格的；但它的前三格只在 OpenCode/Pi/OMP 上成立。要跨到 Claude Code/Codex，只能落到 L3（Mem0/Cognee/Basic Memory 这类 MCP 或文件回写型），且必然丢掉"不停机 + 缓存稳定"。

---

## Analysis（以下是解读，不是事实）

1. **"上下文管理"的胜负手已经从"压多少"转向"什么时候压"。** 2024 年的主流是 compaction（停下来重写），2025–2026 年的前沿是"把压缩挪到后台 + 保持前缀稳定 + 保持可还原"（Manus、Anthropic harness、magic-context 同向）。经济动机很直接：缓存价 10× 差 [S23]，且 Chroma 的 Context Rot 显示长输入下模型表现非均匀退化 —— 塞满不但贵，还更笨 [S25][S26]。
2. **纯 token 压缩（L5）在 agent 历史这个场景上大概率是错配。** LLMLingua 的重损压缩会改写字节，而 agent 的每一轮请求都要复用上一轮的前缀 —— 改写即击穿缓存。它的正确位置是"把检索到的文档塞进上下文之前压一遍"（RECOMP 的"无关则返回空串"才是这个场景的杀手特性）[S49][S52]。
3. **记忆层（L3）的真实瓶颈不是存储，是"装了没人用"。** 30+ 个项目里，能自动写入且不打断工作流的是少数；MemU / Basic Memory / ByteRover 选择"写回 agent 原生文件（CLAUDE.md/AGENTS.md）"，Mem0 / Zep / Cognee / Serena 选择 MCP。magic-context 的差异在于**记忆是压缩的副产品**——不需要 agent 额外做任何事，这解释了它为什么能在我们的 OpenCode 工作流里真的攒下东西（见 §1）。
4. **学界对"压缩是否提升 agent 成功率"的分歧，本质上是在争"压缩损失了什么"。** AgentFold/ACON 压的是**冗余动作轨迹**（同一页面反复看），SWE-agent 的 18.0 vs 15.0 说明"最近 5 条观察"抓住的是信息密度最高的窗口；而 GraphRAG-Bench 的负结果说明**结构化本身不产生信息**。可推断的判据是：**压缩必须保留"决策与约束"（Manus 的 restorable、Cognition 的 compression model 都是这个意思），丢失原始动作的细节是可接受的，丢失为什么这么决定的线索不可接受** [S23][S24][S61][S63][S67][S72]。（推断）
5. **host 的封闭策略正在把"跨宿主记忆"变成真正的护城河。** Anthropic 一边给 API 层加 memory tool / context editing / server-side compaction，一边把 Claude Code 的 compaction 留在客户端 [S5][S6][S7][S1]；magic-context 反其道而行，做跨 OpenCode/Pi/OMP 的共享 `context.db` [S28]。如果未来要同时用 Claude Code，这一层没有开源平替。

---

## Confidence, gaps & disagreements

- **高置信（≥2 个独立 T1）：** 各宿主 compaction 机制与配置项 [S2][S3][S11][S12][S13][S14][S16][S19]；Anthropic 的三招长时程策略 [S1][S9]；Aider repo map 的图排序机制 [S15]；缓存价差 10× 的量级（Manus 自述 + vLLM 文档承认前缀缓存被 OpenAI/Anthropic 广泛使用）[S23][S73]；KV cache 复用技术（vLLM/SGLang/LMCache/Mooncake 各自 T1）[S73][S74][S75][S77]；各类记忆框架的架构与许可证/活跃度（GitHub API 直读）[S81]。
- **单源 / 需谨慎：** 所有自报效果数字 —— Mem0 的 +26%/91%/−90%、Zep 的 94.8% vs 93.4%、MemOS 的 88.83/89.20、MIRIX 的 85.4%、Supermemory 的"第一"、MemoryOS 的 +49.11% F1 [S31][S33][S37][S39][S40][S48]。**没有一项有独立第三方复现**，且 Mem0 已自我声明其公开数字不适用于开源 SDK [S32]。跨论文比较 benchmark 分数是无效的（不同数据集/指标/基数）。
- **已找到复现反证（应据此下调这两个数字的权重）：** Mem0 自己的 issue 区有复现失败报告（`Unable to reproduce locomo eval scores locally` #2800、`Failed to reproduce the accuracy on LOCOMO via Mem0 platform` #3944 等），第三方重跑给出的 LOCOMO 总分约 66.9，明显低于厂商口径；社区同时指出"每家记忆厂商都用自己偏宽松的 judge 评 LOCOMO"。Zep 的 84% LoCoMo 说法也被人以 `getzep/zep-papers#5` 形式质疑。另：Mem0 README 的"New Memory Algorithm (April 2026)"已用**另一套算法**取代论文时期的口径 —— 论文的 26%/91%/90% 属历史数字。
- **矛盾未调和（两家 T1 直接对立）：** 多 agent 是否该用于上下文扩展 —— Anthropic 把 sub-agent 架构列为长时程三招之一 [S1]，Cognition 明确主张"不要建多 agent"、要求共享完整轨迹 [S24]。另：Anthropic 工程博客强调客户端 compaction，而其平台文档称"多数场景服务端 compaction 才是主策略" [S7][S9]。
- **未确立：** ① Claude Code auto-compact 的确切默认阈值（文档页不可达）；② Goose / Continue.dev / Kilo Code / Amp / Semantic Kernel 的机制细节（文档站 404，只有仓库元数据）；③ 任何方案的**长期**（数月级）会话成本与缓存命中率的公开实测 —— 只有 Manus 与 magic-context 各自的内部度量，公式不同、不可比；④ magic-context 没有任何第三方评测或 benchmark 可引用。
- **重要负面结果（应当影响选型）：** 简单事实检索上基础 RAG 追平 GraphRAG，实时知识更新类问题准确率 −16.6% [S72]；KV cache 压缩会导致 system prompt 泄漏与指令遵循退化 [S78]；Roo Code 已归档 [S81]；A-MEM / Memary / Memobase / ByteRover 已停滞或归档 [S81]。

---

## Recommendations

按"产品逻辑 + 交互质量"排序（**不以"技术上最省事"为择优标准**）：

1. **主控层保持 magic-context 不动。** 在我们当前的工作形态（OpenCode 单会话长期跑一个项目）下，它是唯一同时满足"不打断""缓存前缀稳定""记忆自动沉淀"的方案 [S28]；换任何 L1 方案都会失去其中至少两项（对照上面的定位表）。要继续拿住它给的收益，需要留意它的已知运维面：boot 时清理 opencode npm 插件缓存以让 `@latest` 生效（本仓库已有对应处理）。旧版还需要在 boot 时跑 `doctor --fix` 清理 dreamer/historian 子会话，**该问题已由上游闭环**（MC 要求 OpenCode ≥ 2.0.22，运行结束即通过原生会话 API 删除子会话），本仓库 2026-10-19 起已移除这次调用。
2. **要补的是"跨宿主可携带性"，不是"更强的压缩"。** 如果将来要同时用 Claude Code / Codex，选**文件回写型**（Basic Memory：Markdown + wikilink + MCP，AGPL-3.0 [S43]）或 **Letta MemFS**（git 版本化、agent 自己编辑、Apache-2.0 [S30]）作为跨工具的记忆载体；**不选** Mem0 托管平台——它的公开分数不属于开源 SDK，且 `openmemory` 已改做别的用途 [S32][S81]。
3. **压缩率/成本是首要目标时，动 L4 而不是 L5。** 具体顺序：先把检索结构从"塞全文"换成 **LightRAG**（增量更新 + token 成本比 GraphRAG 低一个数量级 [S70]）；只在**多跳/全局概括**类问题上才值得引入图结构，并用 GraphRAG-Bench 的负结果作为准入判据（简单事实检索别上图）[S72]。**不要把 LLMLingua 用在 agent 历史上**（改写文本会击穿前缀缓存），它的正确位置是"检索文档入上下文前压一遍"，优先看 RECOMP 的"无关即空串" [S49][S52]。
4. **自托管推理时，L0 的收益远大于任何文本压缩。** vLLM APC 基本白拿 [S73]；跨文档场景上 LMCache + CacheBlend（TTFT −2.2–3.3×、吞吐 +2.8–5× [S75]）；多机长上下文再考虑 Mooncake [S77]。**但对 SaaS 供应商这条自动生效**，我们能做的只是别破坏前缀 —— 也就是第 1 条的 cache-stable 约束。
5. **不要做 / 不要买：** 同时装两个上下文管理器（magic-context 会自禁用，且双份压缩会 thrash 缓存 [S28]）；直接上"agent 自折叠"的开源实现——AgentFold / ReSum / ACE 都**没有官方仓库**，唯一有实现的 ACON 已停更 [S61][S62][S63][S64]；把 MIRIX / MIRIX 类屏幕录制记忆塞进编码 agent（定位不同）[S40]。

---

## Sources

| ID | Source | Tier | Retrieved |
|---|---|---|---|
| S1 | Anthropic — Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents | T1 | 2026-10-19 |
| S2 | Claude Code — Manage costs (auto-compaction) — https://docs.claude.com/en/docs/claude-code/costs | T1 | 2026-10-19 |
| S3 | Claude Code — How Claude remembers your project — https://docs.claude.com/en/docs/claude-code/memory | T1 | 2026-10-19 |
| S4 | Claude Code — Explore the context window — https://code.claude.com/docs/en/context-window | T1 | 2026-10-19 |
| S5 | Anthropic — Context editing (beta) — https://platform.claude.com/docs/en/build-with-claude/context-editing | T1 | 2026-10-19 |
| S6 | Anthropic — Memory tool — https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool | T1 | 2026-10-19 |
| S7 | Anthropic — Compaction (beta) — https://platform.claude.com/docs/en/build-with-claude/compaction | T1 | 2026-10-19 |
| S8 | Anthropic — Writing effective tools for agents / Code execution with MCP — https://www.anthropic.com/engineering/writing-tools-for-agents | T1 | 2026-10-19 |
| S9 | Anthropic — Effective harnesses for long-running agents — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | T1 | 2026-10-19 |
| S10 | Anthropic — Building effective agents — https://www.anthropic.com/engineering/building-effective-agents | T1 | 2026-10-19 |
| S11 | OpenAI — Codex slash commands / config — https://developers.openai.com/codex/reference/slash-commands | T1 | 2026-10-19 |
| S12 | Gemini CLI — Commands reference — https://geminicli.com/docs/reference/commands | T1 | 2026-10-19 |
| S13 | OpenCode — Config（v1: https://opencode.ai/docs/config ；**v2: https://opencode.ai/v2/docs/config**，本仓库在用 —— 校验发现 `compaction.prune` 在 v2 已移除） | T1 | 2026-10-19 |
| S14 | Cline — Auto Compact / Memory Bank — https://docs.cline.bot/features/auto-compact · https://docs.cline.bot/prompting/cline-memory-bank | T1 | 2026-10-19 |
| S15 | Aider — Repository map / Options — https://aider.chat/docs/repomap.html | T1 | 2026-10-19 |
| S16 | Zed — Agent Panel — https://zed.dev/docs/ai/agent-panel | T1 | 2026-10-19 |
| S17 | OpenAI Agents SDK — Sessions — https://openai.github.io/openai-agents-python/sessions/ | T1 | 2026-10-19 |
| S18 | Google ADK — Memory: MemoryService — https://google.github.io/adk-docs/sessions/memory/ | T1 | 2026-10-19 |
| S19 | LangChain — Short-term memory — https://docs.langchain.com/oss/python/langchain/short-term-memory | T1 | 2026-10-19 |
| S20 | LlamaIndex — Memory — https://docs.llamaindex.ai/en/stable/module_guides/deploying/agents/memory/ | T1 | 2026-10-19 |
| S21 | CrewAI — Memory — https://docs.crewai.com/en/concepts/memory | T1 | 2026-10-19 |
| S22 | AutoGen — Memory and RAG — https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/memory.html | T1 | 2026-10-19 |
| S23 | Manus — Context Engineering for AI Agents: Lessons from Building Manus — https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus | T1 | 2026-10-19 |
| S24 | Cognition — Don't Build Multi-Agents — https://cognition.ai/blog/dont-build-multi-agents | T1 | 2026-10-19 |
| S25 | Chroma — Context Rot — https://research.trychroma.com/context-rot | T1 | 2026-10-19 |
| S26 | Drew Breunig — How Long Contexts Fail — https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html | T3 | 2026-10-19 |
| S27 | Crush (Charmbracelet) — README — https://github.com/charmbracelet/crush | T1 | 2026-10-19 |
| S28 | Magic Context — README（本地 npm `@cortexkit/opencode-magic-context@0.49.12`）· https://github.com/cortexkit/magic-context | T1 | 2026-10-19 |
| S29 | MemGPT — arXiv:2310.08560 — https://arxiv.org/abs/2310.08560 | T3 | 2026-10-19 |
| S30 | Letta — Memory (MemFS) — https://docs.letta.com/agent-sdk/memory/index.md | T1 | 2026-10-19 |
| S31 | Mem0 — arXiv:2504.19413 — https://arxiv.org/abs/2504.19413 | T3 | 2026-10-19 |
| S32 | Mem0 — README — https://github.com/mem0ai/mem0 | T1 | 2026-10-19 |
| S33 | Zep — arXiv:2501.13956 — https://arxiv.org/abs/2501.13956 | T3 | 2026-10-19 |
| S34 | Graphiti — README — https://github.com/getzep/graphiti | T1 | 2026-10-19 |
| S35 | Cognee — README — https://github.com/topoteretes/cognee | T1 | 2026-10-19 |
| S36 | MemOS — arXiv:2505.22101 — https://arxiv.org/abs/2505.22101 | T3 | 2026-10-19 |
| S37 | MemOS — README — https://github.com/MemTensor/MemOS | T1 | 2026-10-19 |
| S38 | A-MEM — arXiv:2502.12110 — https://arxiv.org/abs/2502.12110 | T2 | 2026-10-19 |
| S39 | MemoryOS — arXiv:2506.06326 · https://github.com/BAI-LAB/MemoryOS | T2 | 2026-10-19 |
| S40 | MIRIX — arXiv:2507.07957 — https://arxiv.org/abs/2507.07957 | T3 | 2026-10-19 |
| S41 | HippoRAG — arXiv:2405.14831 / arXiv:2502.14802 | T2 | 2026-10-19 |
| S42 | ByteRover（原 Cipher）— https://github.com/campfirein/byterover-cli（**已归档**） | T1 | 2026-10-19 |
| S43 | Basic Memory — https://github.com/basicmachines-co/basic-memory | T1 | 2026-10-19 |
| S44 | Serena — https://github.com/oraios/serena | T1 | 2026-10-19 |
| S45 | claude-context (Zilliz) — https://github.com/zilliztech/claude-context | T1 | 2026-10-19 |
| S46 | MCP servers — memory server — https://github.com/modelcontextprotocol/servers | T1 | 2026-10-19 |
| S47 | MemU — https://github.com/NevaMind-AI/memU | T1 | 2026-10-19 |
| S48 | Supermemory — https://github.com/supermemoryai/supermemory | T1 | 2026-10-19 |
| S49 | LLMLingua — arXiv:2310.05736 — https://arxiv.org/abs/2310.05736 | T1 | 2026-10-19 |
| S50 | LongLLMLingua — arXiv:2310.06839 | T1 | 2026-10-19 |
| S51 | LLMLingua-2 — arXiv:2403.12968 | T1 | 2026-10-19 |
| S52 | RECOMP — arXiv:2310.04408 | T1 | 2026-10-19 |
| S53 | Gist tokens — arXiv:2304.08467 | T1 | 2026-10-19 |
| S54 | AutoCompressor — arXiv:2305.14788 | T1 | 2026-10-19 |
| S55 | ICAE — arXiv:2307.06945 | T1 | 2026-10-19 |
| S56 | xRAG — arXiv:2405.13792 | T1 | 2026-10-19 |
| S57 | 500xCompressor — arXiv:2408.03094 | T1 | 2026-10-19 |
| S58 | Provence — arXiv:2501.16214 | T1 | 2026-10-19 |
| S59 | Prompt Compression for LLMs: A Survey — arXiv:2410.12388 | T3 | 2026-10-19 |
| S60 | A Survey of Context Engineering for LLMs — arXiv:2507.13334 | T3 | 2026-10-19 |
| S61 | AgentFold — arXiv:2510.24699（无官方仓库） | T1 | 2026-10-19 |
| S62 | ReSum — arXiv:2509.13313（无官方仓库） | T1 | 2026-10-19 |
| S63 | ACON — arXiv:2510.00615 · https://github.com/microsoft/acon | T1 | 2026-10-19 |
| S64 | ACE — arXiv:2510.04618（无官方仓库） | T1 | 2026-10-19 |
| S65 | Dynamic Cheatsheet — arXiv:2504.07952 | T1 | 2026-10-19 |
| S66 | ReFold — arXiv:2610.07863（无官方仓库） | T3 | 2026-10-19 |
| S67 | SWE-agent — arXiv:2405.15793 | T1 | 2026-10-19 |
| S68 | RAPTOR — arXiv:2401.18059 | T1 | 2026-10-19 |
| S69 | GraphRAG — arXiv:2404.16130 | T1 | 2026-10-19 |
| S70 | LightRAG — arXiv:2410.05779 · https://github.com/HKUDS/LightRAG | T1 | 2026-10-19 |
| S71 | KAG — arXiv:2409.13731 | T1 | 2026-10-19 |
| S72 | GraphRAG-Bench (When to use Graphs in RAG) — arXiv:2506.05690 | T1 | 2026-10-19 |
| S73 | vLLM — Automatic Prefix Caching — https://docs.vllm.ai/en/stable/design/prefix_caching/ | T1 | 2026-10-19 |
| S74 | SGLang / RadixAttention — arXiv:2312.07104 | T1 | 2026-10-19 |
| S75 | CacheBlend — arXiv:2405.16444 | T1 | 2026-10-19 |
| S76 | LMCache — https://github.com/LMCache/LMCache · https://docs.lmcache.ai/kv_cache_optimizations/cacheblend.html | T1 | 2026-10-19 |
| S77 | Mooncake — arXiv:2407.00079 | T1 | 2026-10-19 |
| S78 | KV cache compression review — arXiv:2508.06297 · The Pitfalls of KV Cache Compression — https://starai.cs.ucla.edu/papers/ChenArxiv25.pdf | T2 | 2026-10-19 |
| S79 | GPTCache — https://aclanthology.org/2023.nlposs-1.24.pdf | T2 | 2026-10-19 |
| S80 | Redis LangCache / RedisVL SemanticCache — https://redis.io/docs/latest/develop/ai/redisvl/api/cache/ | T1 | 2026-10-19 |
| S81 | GitHub REST API `/repos/{owner}/{repo}`（stars / license / pushed_at / archived，读取日 2026-10-19） | T1 | 2026-10-19 |
| S82 | Context Mode（mksglu/context-mode）— README · https://github.com/mksglu/context-mode （**ELv2**，30,876★，最后推送 2026-10-19） | T1 | 2026-10-19 |
| S83 | Context Mode — BENCHMARK.md（21 场景，376 KB → 16.5 KB）与 `stats.json`（自报用户数） | T1 | 2026-10-19 |
| S84 | Elastic License 2.0 全文 — https://github.com/mksglu/context-mode/blob/main/LICENSE （"may not provide the software to third parties as a hosted or managed service"） | T1 | 2026-10-19 |
| S85 | Context Mode 源码本地克隆实测（v1.0.169，`/tmp/opencode/cm/context-mode`）：`src/adapters/opencode/plugin.ts` 注册 `tool` 映射（含 `ctx_search`）、`tool.execute.before` 可 throw 拦截、`experimental.session.compacting` 生成 resume 快照；`src/server.ts:4814` `INSIGHT_URL`；`src/session/analytics.ts:723` `memoryRoot` 默认 `~/.claude/projects`；`package.json` `license: "Elastic-2.0"`、`engines.node >= 22.5` | T1 | 2026-10-19 |
