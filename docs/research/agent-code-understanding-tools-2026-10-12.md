# 让 Agent 理解代码的工具：全景选型与决策参考

**问题：** 调研"帮 AI agent 理解代码"这一整类工具——codegraph / GitNexus / codebase-memory-mcp / graphify / code-review-graph 等——按机制分类，给出 GitHub 状态、许可、社区评价与一份可决策的推荐。

**日期：** 2026-10-12  **深度：** standard（广度优先）
**覆盖：** 40+ 个仓库，其中 18 个做了一手体检  **时间窗：** 主要 2026-01 → 2026-10，GitHub/npm/PyPI 取当日实时值
**说明：** 本文扩写并取代同日早先的 `code-indexing-agent-tools-2026-10-12.md`（早先版本只覆盖了 codegraph 的直接竞品，范围过窄）。

---

## TL;DR

1. **这一类比想象的大得多，且头部全是 2026-01 之后诞生的新仓。** 按 star：**graphify 12.56 万** > codegraph 7.38 万 > **GitNexus 4.78 万** > codebase-memory-mcp 4.64 万 > code-review-graph 3.20 万 > Serena 3.02 万 > Repomix 2.88 万 > claude-context 1.26 万 > Graft 0.99 万 > repowise 0.75 万……后面还有几十个长尾 [S41–S44]。
2. **最关键的、也最容易被忽略的筛选维度是"许可"**——它直接把这些工具劈成两半：**GitNexus 是 PolyForm Noncommercial（禁止商用）**、**SocratiCode 与 repowise 是 AGPL-3.0**、**Serena 应用层是 GPL-3.0-or-later**、**aoci-code 是 FSL（两年后转 MIT）**；而 MIT/Apache 阵营是 codegraph、codebase-memory-mcp、code-review-graph、gortex、ripwire、Repomix、lat.md、code-context-engine、Graft 等 [S41][S42][S44]。
3. **机制上这是四个互补层，不是四个替代品**：结构图（谁调谁/影响面）、LSP（精确定义与**编辑**）、向量检索（**按意图模糊找**）、仓库打包（整仓入 prompt）。社区共识是**叠加使用**（图作结构真相源 + 向量做模糊召回 + LSP 做编辑）[S10][S16][S19]。
4. **对"零依赖 / 容器友好"最关键的一列**：codegraph、codebase-memory-mcp、gortex、ripwire、aoci-code、codedb 是**单二进制/自包含**；graphify、code-review-graph、repowise、SocratiCode、code-context-engine 是 **Python/pip**；GitNexus、Graft、Repomix、lat.md 是 **Node/npm** [S41–S44]。
5. **一个"star 数陷阱"**：star 与下载量并不等于适配。**claude-context 有 1.26 万 star 但月下载仅 2,739、且 2026-06 后近乎停更**；**graphify 虽 12.56 万 star，但它是 Claude Code 专属 skill 且依赖 Claude 视觉**，在本项目的 **opencode** harness 下属于"跑不起来"——star 高不等于能用 [S41][S44]。
6. **结论（一句话）**：本项目**结构层继续用 codegraph**（已有、MIT、零依赖、容器感知）；**只有当"跨仓"或"模糊语义"成为高频痛点**时，才叠加 **gortex（Apache-2.0、跨仓、257 语言）** 或 **code-context-engine / claude-context（语义）**；**需要精确重构**才叠加 **Serena**（注意 GPL）。**GitNexus 因非商用许可、SocratiCode/repowise 因 AGPL，在商业分发场景应排除。** 详见文末。

---

## 方法

- **子问题：** ① 这一整类工具都有哪些、怎么按机制分类？② 头部各自是什么、现状如何？③ 许可与部署形态（决定能否进产品/进容器）？④ 社区共识与争议？⑤ 对本项目怎么选？
- **来源族：** 各项目官方 README、GitHub 检索 API 与 repos API（star/fork/issue/license/活跃度）、npm & PyPI 注册表与下载量、arXiv 预印本、独立评测博客、Hacker News / Reddit。
- **枚举方式：** 12 组 GitHub 检索（`code graph MCP`、`MCP code intelligence`、`knowledge graph codebase`、`codebase index MCP`、`code search MCP`、`code review graph`、`semantic code search local`、`call graph tree-sitter` 等）+ npm/PyPI 检索 + 已知项目点名校验。
- **本地验证：** 容器内实际运行 `codegraph 1.6.2` = `@colbymchenry/codegraph`，MCP 入口 `codegraph serve --mcp`；本仓 git 历史已有"裸 npm 包 `codegraph` 是 469B 空壳"的修复（commit `2ef8694`）。
- **不可得/降权：** tokenade.net / sverklo.com / heyclau.de 为厂商或联盟性质，仅作线索；GitHub star 无独立核验，按"声誉信号"而非质量证据处理。

---

## 发现

### 1. 分类学：这一类的六个机制层

| 层 | 它回答的问题 | 代表工具 |
|---|---|---|
| **A. 结构图 / AST 知识图（MCP）** | 谁调谁、改这个会炸什么、路由→handler、死代码 | codegraph、codebase-memory-mcp、GitNexus、gortex、code-review-graph、CodeGraphContext、code-graph-rag、codedb、codeseek、octocode、axon |
| **B. LSP / 编译器语义** | 精确的"转到定义/所有引用"、**符号级重命名与重构** | **Serena**、Sourcegraph（Cody / SCIP）、tree-sitter-analyzer |
| **C. 语义 / 向量检索** | "按意图模糊找代码"（不知道符号名时） | claude-context、**code-context-engine**、SeaGOAT、mcp-local-rag、coco-search、vgrep |
| **D. 仓库打包 / 上下文压缩** | 把整仓塞进一个 prompt / 降低读取量 | Repomix、**ripwire**、Graft、aider repo-map |
| **E. 文档化 / 领域知识图** | 人机共读的设计意图、领域知识、wiki | **graphify**、**lat.md**、repowise、DeepWiki、Graft |
| **F. 记忆层（相邻）** | 跨会话保留项目知识 | MegaMemory、okf-agent-memory、memtrace、marm-memory |

**基础件**：`tree-sitter`（27.2k★）是绝大多数 A 类的解析底座；`ast-grep`（16.2k★）是结构搜索/重写的补充件 [S6]。

### 2. 头部工具逐个（一手体检）

**graphify**（Graphify-Labs，12.56 万★，Apache-2.0，Python）——**star 数第一**，但形态特殊：它是 **Claude Code 的一个 skill**（`/graphify`），把代码 + PDF/图片/schema **多模态**喂给 **Claude 视觉**，产出 `graphify-out/`（interactive graph.html、Obsidian vault、wiki/、graph.json），宣称"71.5× 更少 token"。**限制**：**依赖 Claude Code + Claude**，产出物是"经过 LLM 提炼的图"而非确定性索引——对 opencode 用户不可直接用，且非确定性 [S43]。

**GitNexus**（abhigyanpatwari，4.78 万★，**PolyForm Noncommercial 1.0.0**，TypeScript）——"Zero-Server Code Intelligence Engine"，`npx gitnexus analyze` 建图 + `gitnexus setup` 自动写 Claude Code/Cursor/Codex 配置，附 Web UI、"like DeepWiki but deeper"。npm 月下载 **21.3 万**。**致命点：非商用许可** [S41][S44]。

**codebase-memory-mcp**（DeusData，4.64 万★，MIT，C）——162 语言、内置 Nomic 向量语义、17 工具、跨仓 `CROSS_*`、3D 图 UI、有 **arXiv 预印本 2603.27277**（自报 83% 质量 vs 92%、10× token、2.1× 工具调用）。**单二进制、零运行时**，opencode 在支持列表内。**代价**：636 open issue、自定义守护进程/协调模型、Defender 误报 [S7][S8][S44]。

**code-review-graph**（tirth8205，3.20 万★，MIT，Python）——**面向 code review**：tree-sitter 建结构图，只重解析"改动文件 + 其依赖者"，Claude 查询后只读相关文件。宣称 httpx 26.2× / FastAPI 8.1× / Next.js 6.0× 更少 token，review 质量 8.8 vs 7.2。PyPI 2.3.9 [S42][S44]。

**Serena**（oraios，3.02 万★，**应用 GPL-3.0-or-later / SolidLSP MIT**，Python）——**层 B 的标杆**：LSP 驱动，40+ 语言的精确导航 + **符号级编辑/重命名/move + 项目记忆**；官方列出经 opencode 在内的多客户端。**它是 codegraph 的补集而非竞品**（图回答"结构"，Serena 回答"精确地改"）[S5][S44]。

**Repomix**（yamadashy，2.88 万★，MIT，TS）——**层 D**：把整个仓库打包成单个 AI 友好文件（token 计数、`.gitignore` 感知）。npm 月下载 **43.4 万**。它不是"索引"，是"喂上下文"的另一种流派 [S41][S44]。

**Graft**（trailhq / npm `@nanonets/graft`，0.99 万★，MIT）——图 + **自动维护 CLAUDE.md/AGENTS.md**（"你的每次纠正变成一条 agent 会保留的规则"），宣称 4× 更便宜、3× 更快，附 SWE-bench Verified 结果；`graft grep` / `graft map` / `graft viz` [S51]。

**repowise**（**7,544★**，**AGPL-3.0 或商业授权**，Python）——主张"砍 token 不是目标，理解才是"，Graph/风险/健康/测试/死代码**零 LLM 调用**；宣称 dotnet/runtime 58,924 文件一次索引（120 min，11.7 GiB）、−31.6% agent 输出 [S51][S44]。

**SocratiCode**（giancarloerra，3,335★，**AGPL-3.0**，TS）——"企业级、4,000 万行、零配置、全本地"，混合检索 + 跨项目 + 多语言依赖图 + 符号级影响分析 + HTML 图浏览器 [S51][S44]。

**ripwire**（**redhat-et**，2,435★，Apache-2.0，C++23）——"AI context 界的 ripgrep"，零依赖单二进制 + MCP，**确定性排序调用图**：该碰哪些、会炸什么、该跑哪些测试；编辑后给 blast radius、读写的字段、漏掉的 co-change。有一份"1,500 文件 C++/Metal 多 agent 实战"现场报告 [S51][S44]。

**lat.md**（**vercel-labs**，2,021★，MIT，TS）——主张"**`AGENTS.md` 不 scale**"，把领域知识压成 `lat.md/` 目录里的**互联 markdown 图**（`[[wiki links]]` + 源码双向链接），`lat check` 强制不漂移。轻量、人机共读 [S51][S44]。

**gortex**（zzet，1,892★，Apache-2.0，Go）——**257 语言**、单静态二进制、**默认跨仓**、175 个（可配置）MCP 工具、19 个 agent（**含 OpenCode**）、宣称最多 50× 更少 token、有可复现基准 [S49][S44]。

**code-context-engine**（elara-labs，428★，MIT，Python）——**层 C**：`uvx ... cce init` 一条命令建索引，94% token 节省；有 Ollama 时用本地 `nomic-embed-text`，否则 `[local]` 内置 embedding [S51][S44]。

**aoci-code**（1,488★，**FSL-1.1（两年后转 MIT）**，Go）——"**由 agent 编写、Git 版本化的整仓地图**"，一行一文件、由模型从源码写出；面向"多达 50 万行"的既有系统接管，MCP 自动检测变更并派发待更新条目，支持 Codex/Claude Code/Cursor/**OpenCode** [S51][S44]。

### 3. 长尾（按机制归位，摘要级）

- **结构图**：CodeGraphContext（4.26k★，MIT，Neo4j 图）、vitali87/code-graph-rag（5.24k★，MIT，monorepo RAG，645 issue）、codedb（1.39k★，BSD-3，Zig）、codeseek（771★，MIT，Rust，**2026-08 后停更**）、octocode（507★，Apache-2.0，Rust）、axon（814★，**无许可**）、codegraph-ai/CodeGraph（119★，同名不同物）。
- **向量/语义**：claude-context（12.6k★，MIT，**月下载仅 2,739、2026-06 后停更**）、SeaGOAT（1.31k★，MIT，本地语义搜索）、coco-search（37★）、vgrep、mcp-local-rag（414★）。
- **打包/压缩**：aider repo-map（Apache-2.0，仅 aider 内置）。
- **记忆层**：MegaMemory（723★）、okf-agent-memory（763★）、memtrace（489★）、marm-memory（419★）。
- **健康/复杂度**：fallow（5.04k★，MIT，TS/JS 代码健康与复杂度热点）。

### 4. 许可矩阵（决定"能不能用"，最容易被忽略）

| 许可 | 工具 | 商业分发 |
|---|---|---|
| **MIT / Apache-2.0 / BSD** | codegraph、codebase-memory-mcp、code-review-graph、gortex、ripwire、Repomix、lat.md、code-context-engine、Graft、SeaGOAT、codedb、ast-grep、tree-sitter | ✅ 自由 |
| **FSL-1.1（两年后转 MIT）** | aoci-code | ⚠️ 源码可见，非 OSI，两年后 MIT |
| **GPL-3.0-or-later（应用层）** | Serena（SolidLSP 部分 MIT） | ⚠️ 分发需合规 |
| **AGPL-3.0** | SocratiCode、repowise | ⚠️ 网络服务也触发开源义务 |
| **PolyForm Noncommercial 1.0.0** | **GitNexus** | ❌ **禁止商用** |
| Apache-2.0 但**依赖 Claude Code** | graphify | ⚠️ 许可宽松但形态受限 |

### 5. 跨工具的共识与争议

- **共识（多源一致）**：四层互补、常见叠加；图类赢结构问题、向量赢模糊召回、LSP 赢编辑 [S10][S16][S19]。
- **共识的风险**：**"预建索引会漂移"**是整类通病——codegraph 的增量同步丢边（issue #1240/#773/#933/#766/#455，均已修但反复）、codebase-memory-mcp 的 636 个 open issue、code-graph-rag 的 645 个 open issue 都指向同一问题。**"看起来完整实则缺失"（宏/元编程/代码生成/DI）**是共同信任边界 [S4][S12]。
- **争议（未裁决）**：**成本节省口径不一**——codegraph 官方 −44%、作者又自认"常驻上下文 +80%"，独立复现称"工具调用省、成本不省" [S2][S12]；codebase-memory-mcp 的自报预印本承认**质量低于纯探索（83% vs 92%）** [S8]。
- **社区情绪**：Hacker News 对"图工具"整体**存在明显怀疑**（"知识来自亲手做，不是被喂"、"100s 条意大利面图是我想避免的"），positive 主要集中在"安装零摩擦 + 结构问题精确" [S15]。

---

## 对比（一手体检的头部工具）

> star/issue 为 2026-10-12 实时值 [S41][S42][S44]。**粗体** = 对本项目（opencode + 容器）适配要点。

| 工具 | 层 | 机制/引擎 | 语言 | 部署依赖 | 许可 | opencode | star | 活跃(push) | 适配评注 |
|---|---|---|---|---|---|---|---|---|---|
| **graphify** | E | 多模态 LLM 知识图（Claude 视觉） | 任意 | **需 Claude Code**+Claude | Apache-2.0 | ❌ | 125.6k | 10-11 | star 最高，**形态不匹配 opencode** |
| **codegraph** | A | AST 图 + FTS5，单工具 MCP | 20 | **零依赖自包含** | MIT | ✅ | 73.8k | 10-11 | 本仓已用；容器感知；bus factor 1 |
| **GitNexus** | A | 图 + Web UI | 多 | Node/npm | **PolyForm NC** | 部分 | 47.8k | 10-11 | **禁止商用**，排除 |
| **codebase-memory-mcp** | A | AST 图 + 内置向量 + Hybrid LSP | 162 | **C 单二进制** | MIT | ✅ | 46.4k | 10-12 | 跨仓+语义；636 issue、Defender 误报 |
| **code-review-graph** | A/E | tree-sitter 图，review 定向 | 12 | Python/pip | MIT | 可(MCP) | 32.0k | 10-06 | 面向 review 的增量重解析 |
| **Serena** | B | LSP（或 JetBrains） | 40+ | `uv`+各语言 LSP | **GPL-3.0+**/MIT | ✅ | 30.2k | 10-09 | **编辑/重构**的补集；许可需评估 |
| **Repomix** | D | 整仓打包成单文件 | 任意 | Node/npm | MIT | 是(CLI) | 28.8k | 10-11 | 非索引，另一种上下文流派 |
| **claude-context** | C | BM25+向量 | 广 | **需 Milvus+embedding key** | MIT | 是 | 12.6k | **07-14 停** | 月下载仅 2,739，近乎停更 |
| **Graft** | D/E | 图 + 自动维护 AGENTS.md | 多 | Node/npm | MIT | MCP | 9.9k | 10-10 | "纠正变规则"+SWE-bench |
| **repowise** | A/E | 图/风险/健康（零 LLM） | 多 | Python | **AGPL-3.0** | MCP | 7.5k | 10-12 | 大仓强，许可受限 |
| **code-graph-rag** | A | RAG 图，monorepo | 多 | Python + 图数据库 | MIT | 是 | 5.2k | 10-12 | 强大但 **645 issue** |
| **SocratiCode** | A/C/E | 混合检索+依赖图 | 多 | Node/npm | **AGPL-3.0** | MCP | 3.3k | 10-10 | 企业级 4,000 万行 |
| **ripwire** | D | 确定性调用图（零依赖） | 多 | **C++ 单二进制** | Apache-2.0 | MCP | 2.4k | 10-11 | Red Hat ET；多 agent 实战报告 |
| **lat.md** | E | markdown 互联知识图 | 任意 | Node/npm | MIT | 是 | 2.0k | 10-09 | Vercel Labs；轻、`lat check` 防漂移 |
| **gortex** | A | 编译级解析图 | **257** | **Go 单二进制** | Apache-2.0 | ✅ | 1.9k | 10-11 | **跨仓默认**、50× token 宣传 |
| **code-context-engine** | C | tree-sitter+embedding | 多 | Python(`uvx`) | MIT | 是 | 0.43k | 08-23 | 一条命令、94% 节省；Ollama 可选 |
| **aoci-code** | E | **Git 版本化的 agent 手写地图** | 任意 | Go | FSL-1.1 | ✅ | 1.5k | 10-09 | "接管既有系统"；Opus 常驻 ~300K token |

**用量信号（月下载）**：codegraph 55.2 万、Repomix 43.4 万、GitNexus 21.3 万、claude-context 仅 0.27 万 [S41][S44]。**注意 claude-context 与 Repomix 的反差**：star 不能当用量。

---

## 分析（以下为解读，非事实）

1. **这个类别现在是"红海 + 长尾"，但真正可用的头部很窄。** 把许可、部署形态（是否单二进制、是否要外部 DB/API key）、opencode 兼容性、维护活跃度四条一过，125.6 万 star 的庞大名单会塌缩到十来个候选；其中**MIT/Apache + 零/低依赖 + 支持 opencode** 的只有 **codegraph、codebase-memory-mcp、gortex、ripwire、code-review-graph、lat.md、code-context-engine、aoci-code** 一小撮 [S41][S44]。
2. **star 排名与适配度几乎正交。** graphify 靠"多模态 + Claude skill"拿到第一，但**它绑定 Claude Code**；`claude-context` 有 1.26 万 star 却月下载 2,739、已停更。**对"选型"而言，star 是最弱信号，许可与部署形态才是强信号** [S41][S44]。
3. **许可差异不是细节，是分水岭。** 一个商用产品/容器**不能**打包 GitNexus（非商用）；AGPL 的 SocratiCode/repowise 一旦以网络服务形式提供就要开源**整个服务端**——这常常直接否决。**Serena 的 GPL 是"应用层"，若只是内部工具使用通常没问题，但它换来了别处没有的编辑/重构能力** [S41][S51]。
4. **"结构图"这一层已经同质化，差异化在交互与部署。** codegraph 的单工具 `explore` + 自动同步 + 陈旧横幅；codebase-memory-mcp 的 17 工具 + 内置向量 + 跨仓；gortex 的 257 语言 + 跨仓默认 + 单二进制；ripwire 的确定性调用图 + 编辑后校验。**选哪一个，取决于你要的是"最省心的单仓结构问答"（codegraph）还是"跨仓/多语言广度"（gortex / cbm）** [S2][S7][S49]。
5. **一个被低估的低成本流派**：**lat.md / aoci-code** 不做重型索引，而是让 agent **维护一份人在环可读、Git 版本化的知识资产**（markdown 图 / 一行一文件的 map）。它们的 token 常驻可能不小（aoci 提到 Opus 下 ~300K token 的索引），但**零基础设施、跨会话跨 agent 稳定、且能被 review**——对"人手多、agent 换来换去"的团队，往往比再装一个 MCP 更划算 [S51]。
6. **"漂移"是这一类的共性风险，应当写进工作流而非寄望于某个工具解决。** 无论 codegraph 还是 cbm，都有静默漂移史；**"图是缓存、源码是真相" + 周期性全量重建**是跨工具的卫生习惯 [S4][S12]。

---

## 置信度、缺口与分歧

- **高置信（GitHub/注册表一手直读）：** 各工具的 star/fork/issue/license/活跃度；许可分类；npm/PyPI 下载量 [S41][S42][S44]。
- **中置信（官方自报，含营销色彩）：** 各家的 token/成本/质量数字（codegraph、cbm、code-review-graph、repowise、gortex、ripwire 均为**自报**，方法论各异、口径不可直接比较）[S2][S7][S8][S42]。
- **分歧（未裁决）：** "省 token 是否等省成本"——官方 vs 独立复现结论相反 [S2][S12]。
- **缺口：** ① 多数工具**没有第三方独立复现**其基准；② graphify / GitNexus 的实际质量在**非 Claude 环境**（如 opencode）下无公开数据；③ 长尾 20+ 工具有相当比例是 2026 年新生的低维护项目，**可持续性未知**（star 高、issue 0、长期未 push 者尤其可疑，如 codeseek）。
- **可信度警示：** 对比类榜单（tokenade/sverklo/heyclau）多与厂商有利益关联；社区帖子（HN/Reddit）反映情绪而非事实，两者均只作方向参考。

---

## 建议（针对本项目：debian-railway 容器 + opencode）

**总原则：结构层不动、按痛点做"最小叠加"，并且先过许可这一关。**

**优先级 1 ——【默认，保持】结构层继续用 `@colbymchenry/codegraph`。**
- 理由：已生产验证、MIT、**零依赖自包含**、按 cgroup 真实核数调度（对本容器 8 核 vs 主机 48 核的核数错觉天然免疫，见项目记忆 #343 同类坑）、单工具交互减少误用、原生支持 opencode。换到同类只是搬家。
- 动作：① agent 指令里保留"图是缓存、源码是真相"，不写"别用 grep 复核"；② 关键仓加**周期性 `codegraph index --force`** 基线，对冲增量同步漂移。

**优先级 2 ——【仅当出现"跨仓"或"按意图模糊找"的刚性痛点】二选一叠加：**
- **跨仓 / 多语言广度** → **gortex**（Apache-2.0、Go 单二进制、257 语言、**默认跨仓**、支持 OpenCode、175 工具可裁剪）或 **codebase-memory-mcp**（MIT、162 语言、内置向量、跨仓；但 636 issue + 自定义守护进程）。
- **模糊语义召回** → **code-context-engine**（MIT、`uvx` 一条命令、可用 Ollama 本地 embedding）或 **claude-context**（MIT，但**已停更**，不建议新引入）。
- **注意**：这两层与 codegraph 是**互补**，可并存，不必替换。

**优先级 3 ——【仅当需要精确重构/重命名】叠加 Serena（LSP 后端）。** 它是补集不是替代；先确认两件事：容器里 `uv` + 各语言 LSP 的运维成本；以及 **GPL-3.0-or-later 应用层**在你的分发场景下是否可接受。

**明确排除（就本项目而言）：**
- **GitNexus** —— PolyForm **Noncommercial**，商业分发不可用（即使 star 4.78 万）。
- **SocratiCode / repowise** —— **AGPL-3.0**，除非能接受网络服务的开源义务。
- **graphify** —— 形态绑定 Claude Code + Claude 视觉，**在 opencode 下跑不起来**（star 最高也枉然）。

**值得"轻量试错"的低成本选项**（若想给 agent 一份人可 review 的知识资产）：
- **lat.md**（MIT，Vercel Labs，`lat check` 防漂移）或 **aoci-code**（Go，Git 版本化、支持 OpenCode）——零重型基础设施，适合多 agent/多会话长期协作。

**两分钟可做的下一步**：在容器里跑 `codegraph status` + 一个结构问题，确认现状够用；若"跨仓"在你的真实工作里出现频率 ≥ 每周，再把 **gortex** 作为结构层候选做一次实测对比（`gortex` 支持 OpenCode 且 Apache-2.0，是唯一能与你现有结构层正面比拼又无许可负担的选项）。

---

## 来源

| ID | 来源 | 层级 | 取回日 |
|---|---|---|---|
| S41 | GitHub 检索 API（`code graph MCP` / `MCP code intelligence` / `code search MCP` 等组）+ repos API | T1 | 2026-10-12 |
| S42 | GitHub 检索 API（`knowledge graph codebase` / `codebase index MCP` / `code review graph` 等组） | T1 | 2026-10-12 |
| S43 | `Graphify-Labs/graphify` README（skill 形态、产出物、PyPI `graphifyy`） | T1 | 2026-10-12 |
| S44 | GitHub repos API 一手体检（star/fork/issue/license/created/pushed，40+ 仓）+ npm & PyPI 注册表与下载量 | T1 | 2026-10-12 |
| S45 | `colbymchenry/codegraph` README + issues（漂移/丢边史） | T1 | 2026-10-12 |
| S46 | `abhigyanpatwari/GitNexus` README + LICENSE（PolyForm Noncommercial 1.0.0） | T1 | 2026-10-12 |
| S47 | `tirth8205/code-review-graph` README（tree-sitter、增量、基准） | T1 | 2026-10-12 |
| S48 | `zzet/gortex` README（257 语言、跨仓、单二进制、OpenCode 支持） | T1 | 2026-10-12 |
| S49 | `DeusData/codebase-memory-mcp` README + arXiv:2603.27277 | T1/T2 | 2026-10-12 |
| S50 | `oraios/serena` README + LICENSE（GPL-3.0-or-later 应用 / MIT SolidLSP） | T1 | 2026-10-12 |
| S51 | 逐仓 README 体检：SocratiCode、ripwire(redhat-et)、lat.md(vercel-labs)、repowise、code-context-engine、Graft、aoci-code | T1 | 2026-10-12 |
| S52 | andrew.ooo《CodeGraph Review》(2026-05-28) | T3 | 2026-10-12 |
| S53 | Harrisonsec《Agent Retrieval Above the Crossover》+ Hono 实测姊妹篇 (2026-06-08) | T3 | 2026-10-12 |
| S54 | Ry Walker Research《Code Intelligence Tools for AI Agents Compared》2026-09 | T3 | 2026-10-12 |
| S55 | Hacker News 讨论（codegraph / code-review-graph / 图工具批评） | T4 | 2026-10-12 |
| S56 | 厂商/联盟对比站：tokenade.net、sverklo.com、heyclau.de（**降权**） | T4 | 2026-10-12 |
| S57 | baeseokjae.github.io《AI Coding Agent Code Index MCP Comparison 2026》(2026-07-06) | T3 | 2026-10-12 |
