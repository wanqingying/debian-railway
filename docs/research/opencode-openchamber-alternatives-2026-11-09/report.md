# opencode 与 OpenChamber 的替代方案：引擎层不必换，工作区层只有三个真对手

**问题：** 在这台自托管容器里，opencode（引擎）与 OpenChamber（工作区 UI）各自有哪些可用替代方案，哪个组合最值得换、什么时候换？
**日期：** 2026-11-09  **深度：** standard
**来源：** 33 个（32 个一手/官方 · 1 个第三方横评）· **引用准确率：** 100%（34/34 承重结论逐条回访）· **窗口内：** 12/12 有日期来源（100%）· **无日期：** 22（活跃项目文档，见"方法"）· **检索截止：** 2026-11-09

## TL;DR

- **必须分两层评估，否则会得出错误结论。** opencode 是**引擎**（agent 循环、会话、工具、插件、HTTP/ACP 接口），OpenChamber 是**工作区 UI**（多项目、worktree、多端）。换 UI 很便宜，换引擎很贵——本仓库的 magic-context、session_search、Feishu 问答桥全部绑在引擎层。
- **引擎层：唯一够格的新对手是 DeepSeek Harness。** 276,586 star、MIT、自带 `dsh web`、插件优先架构；但它自述 **developer preview，且"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"**，不能进一个靠钉版本活着的生产容器 [S8][S9]。其余热门项目要么只是 TUI/SDK（Pi、Codex CLI、Cline、Gemini CLI），要么是 opencode 的下游（Kilo）。
- **工作区层：真对手只有三个** —— Paseo（Apache-2.0，一个界面统管 7 种 agent，daemon + 桌面/手机/Web/CLI + relay）[S17][S18][S19]、OpenHands 的 **Agent Canvas**（92,982 star，自托管 agent 控制中心，可经 ACP 驱动 OpenCode）[S15]、CodeNomad（只做 OpenCode V2 的原生座舱，要求 2.2.3+、推荐 2.2.5，与本仓库的钉子完全对齐）[S20]。
- **一个被广泛误传的事实，本次实测推翻了：** opencode v2.2.5 的 `serve` 自己就提供**本地 Web UI**（隔离数据目录下 GET `/` 返回 200、9,571 字节 HTML；`/api/info` 正常要求鉴权），并不依赖 `app.opencode.ai` 托管页 [S3][S4]。所以 OpenChamber 的价值不再是"给 opencode 一个界面"，而是**工作流编排**。
- **最大不确定性：** 三个挑战者"驱动 OpenCode 的深度"（是否保留插件、会话库、权限语义）与它们的常驻内存，本次**都没有实测**；这恰好是换 UI 前唯一该测的东西。
- **推荐：** 现在**保留 opencode 2.2.5 + OpenChamber 2.6.0（fork）**，并立刻加一条零成本保险（opencode 自带 Web 作为降级入口）；OpenChamber 再出阻断级回归时，首选换 **CodeNomad**，其次 **Paseo**；引擎层给 dsh 设观察触发点，不动。

## 方法

- **调查节点：** N1 现状基线 / N2 引擎层候选 / N3 工作区层候选 / N4 本容器约束 / N5 迁移损失（`outline.json`）。
- **来源与通道：** GitHub REST API（star/许可/最后 push，T1）、官方仓库 README 与 LICENSE 原文（T1）、官方文档（dsh、Paseo、opencode v2，T1）——全部走公开 A 通道；一个 JS 渲染页用容器内 Chromium 读（B 通道，`access=render`）；四条结论来自**本机实测**（CLI help、隔离端口的 HTTP 探针、`ps`/cgroup 读数、ACP 子命令）。
- **纳入标准（先定后搜）：** ① 开源许可可自托管；② Linux 服务器可无 GUI 常驻；③ 支持自定义 OpenAI 兼容端点（本仓库用 `api.commandcode.ai` 网关）[S28]；④ 近 90 天有提交；⑤ 对工作区层额外要求：能驱动 opencode **或** 任意 ACP agent。
- **未纳入：** 闭源 SaaS（Claude Code、Cursor、Devin、Codex Cloud）——不满足①，未进一步核实；纯 IDE 扩展（Continue、Roo）——不满足②。
- **拿不到的东西：** 三个挑战者的真实部署体验（未安装）、各自内存占用（未测）、Paseo/CodeNomad 与 opencode 插件生态的实际兼容性（未测）。这三点在"不确定性"里显式降级。
- **花费：** 1 个上下文顺序执行（无并行 worker），33 个来源、42 条结论、约 25 分钟。

## Findings

### N1 · 基线：两层各是什么，实测多少成本

opencode 官方仓库是 `anomalyco/opencode`，MIT，2026-11-09 时 225,545 star 且当天仍有提交 [S1]。v2 的官方定位是"终端、桌面、Web 三种界面共用同一引擎" [S2]；CLI 还提供 `acp` 子命令（Start an Agent Client Protocol server），意味着任何 ACP 客户端都能驱动同一引擎 [S32]；Web 入口用 `opencode pair` 发一次性链接（5 分钟过期）[S2]。

本机 v2.2.5 的 `opencode serve --help` 自述为 **"Start the v2 API and web server"** [S3]。为验证它到底是不是真的本地 UI（网上长期流传"opencode 的 Web UI 只是托管页"），我在**隔离的 `XDG_DATA_HOME`、端口 4999** 起了一个 22 秒的探针：`GET /` 返回 `200 text/html`、9,571 字节，HTML 里是带 `--v2-background` 变量的完整 SPA；`/api/info` 返回 `UnauthorizedError`，说明内置鉴权生效 [S4]。探针未触碰 4096 与线上会话库。

OpenChamber 自述为覆盖 desktop / web / VS Code / mobile 的开源工作区（MIT，12,718 star）[S5]，两个别家没有的能力：**Multi-run**（同一任务最多 5 个模型、各自会话、可选各自 worktree，再挑结果）[S5]，以及手机端**Private Relay**（一次性二维码配对、不开端口、端到端加密、可吊销）[S5]。

资源面（本机 `ps` + cgroup 实测）：opencode serve **790 MB**、OpenChamber server **439 MB**、magic-context 侧栏服务 61 MB；容器 cgroup 上限 14.90 GB，已用 7.52 GB [S6][S27]。也就是说**工作区层的边际成本约 0.4–0.5 GB**，占剩余内存的 ~7%。

本仓库钉的是 opencode 2.2.5 + OpenChamber 2.6.0（fork 构建，含 worktree 分组补丁）+ magic-context 0.49.34 [S7]。

### N2 · 引擎层：热闹，但都不满足"常驻服务 + 钉版本"

**DeepSeek Harness（dsh）** 是唯一在架构上同级的对手：MIT、276,586 star、everything-is-a-plugin（Cordis 运行时）、`dsh web` 直接起 Web UI（默认 3080），支持自定义 OpenAI 兼容端点且改配置不用重启 [S8][S9]。它的短板是成熟度：README 明写 developer preview 与破坏性变更 [S8]。

其余一线项目按"能不能当引擎服务"分三类：

- **只有 TUI/SDK，缺常驻 Web 工作区：** Pi（120,871 star，MIT，包清单只有 CLI/TUI/SDK）[S10]、Codex CLI（Apache-2.0，133,869 star，官方形态 CLI+IDE+Cloud）[S11]、Cline（SDK/IDE/CLI）[S13]、Gemini CLI（绑 Gemini 生态）[S12]。
- **opencode 的下游：** Kilo Code（MIT，27,911 star，all-in-one 平台；"CLI 建在 opencode 之上"只见于第三方横评，未独立核实）[S14]。
- **已停更或边缘：** Aider 最后 push 2026-05-22，按 90 天门槛排除 [S16]。

**引擎层的完整横评**（18 个新增候选、按「能否承接常驻服务/ACP/插件/自定义端点」四项判据）见同目录 `engine-alternatives.md`；本节结论不变，但范围更窄。

**结论（推论）：** 引擎层的门槛不是"agent 能不能写代码"，而是**能不能被一个外部 UI 长期驱动**——稳定的 HTTP/ACP 接口、会话与权限模型、插件钩子。opencode 在 v2 里恰好三样都有（`serve`、`acp`、插件），而多数替代品是"给人用的 TUI"，不是"给程序用的引擎"。

### N3 · 工作区层：三个真对手，三种产品逻辑

**Paseo** —— 产品逻辑是"多 agent 指挥台"。一个界面统管 Claude Code、Codex、Copilot、OpenCode、Pi、Antigravity、Muse Code 七种 agent [S17]；架构是 daemon + 多客户端（桌面/手机/Web/CLI）[S17]，`--host` 可经 relay 驱动另一台机器上的 daemon 而**不暴露端口** [S22]；Apache-2.0（GitHub 显示 NOASSERTION 只是复合 LICENSE 文本所致）[S18]；还有插件、SDK、定时任务。23,549 star。

**OpenHands / Agent Canvas** —— 产品逻辑是"常开的工程团队"。已从单一 agent 平台重定位为**自托管的 coding agent 控制中心**，可跑 OpenHands、Claude Code、Codex、Gemini、Pi、OpenCode 或任意 ACP agent [S15]；单容器自托管（`ghcr.io/openhands/agent-canvas:1.37.0`，映射 `127.0.0.1:8000`，项目挂 `/projects`）[S15]；自带 Slack/GitHub/Linear/Notion 自动化 [S15]。92,982 star，MIT。

**CodeNomad** —— 产品逻辑是"只做 OpenCode 的座舱"。桌面/浏览器工作区，项目标签、嵌套会话、worktree、MCP/插件管理；server 模式默认绑 `127.0.0.1`，`--host 0.0.0.0` + 密码 + 自签 HTTPS 即可远程访问，还能配对手机做 Remote Control [S20]。要求 OpenCode V2 **≥2.2.3、推荐 2.2.5**——与本仓库的钉子完全一致 [S20]。2,663 star，MIT。

**opencode 自带 Web** 是最容易被忽略的第四个选项：与引擎同进程，**零额外内存**，`serve` 即可用 [S3][S4]；产品逻辑是"会话管理器"：v2 引擎**本身内置 worktree 策略**（二进制里可读到 `@opencode/Worktree`、`WorktreeStrategies` 等模块）[S33]，它缺的是工作区级的编排、分组、多模型并行与手机 relay，而不是 worktree 这种底层能力。

其余按排除理由归档：Vibe Kanban（Apache-2.0，28,625 star，看板式编排，产品逻辑是"卡片→agent"而非工作区；另有横评称其母公司 Bloop 已关停、转社区维护，单来源未核实）[S21][S25]；Termic（AGPL，329 star，桌面 GUI）[S22]；Happy（手机遥控，最后 push 2026-02-14）[S23]；Omnara（偏 hosted agent 平台）[S24]；Conductor（macOS 独占、闭源，按纳入标准排除）；Crystal/Sculptor（已停更或容器隔离路线，仅见于第三方横评）[S25]。

## Comparison

### 表 A · 引擎层（能不能当"被 UI 驱动的长期引擎"）

| 候选 | 形态 | 许可 | 常驻服务 / Web UI | 自定义 OpenAI 端点 | 插件/记忆生态 | 近 90 天活跃 | 本容器可落地 |
|---|---|---|---|---|---|---|---|
| **opencode**（现状） | TUI + desktop + web + HTTP + ACP [S32] | MIT [S1] | ✅ 同进程 `serve` [S3][S4] | ✅ providers.baseURL [S28] | ✅ 插件（magic-context 等）[S26] | ✅ [S1] | ✅ 已跑通 |
| **DeepSeek Harness** | CLI + Web UI（3080） | MIT [S8] | ✅ `dsh web` [S9] | ✅ [S9] | ✅ 插件优先（Cordis） | ✅ [S8] | ⚠️ preview + 破坏性变更 [S8] |
| Pi | CLI/TUI/SDK | MIT [S10] | ❌ 无常驻服务 | ✅（多 provider SDK） | ✅ extensions/skills | ✅ | ⚠️ 需自配 UI 层 |
| Codex CLI | CLI + IDE + 云 | Apache-2.0 [S11] | ❌ 自托管工作区 | ⚠️ 有限 | ⚠️ | ✅ | ❌ 绑定 OpenAI 形态 |
| Gemini CLI | CLI | Apache-2.0 [S12] | ❌ | ❌ 绑 Gemini | ⚠️ | ✅ | ❌ |
| Cline | SDK/IDE/CLI | Apache-2.0 [S13] | ❌ | ✅ | ⚠️ | ✅ | ❌ 无工作区服务 |
| Kilo Code | 平台（CLI+IDE+云） | MIT [S14] | ⚠️ 云为主 | ✅ | ⚠️ | ✅ | ⚠️ opencode 下游 |
| Agent Canvas（OpenHands） | 自托管控制中心 | MIT [S15] | ✅ Docker :8000 [S15] | ✅ [S15] | ⚠️ 自有插件体系 | ✅ | ⚠️ 会再起一套 agent 进程 |
| Aider | CLI | Apache-2.0 [S16] | ❌ | ✅ | ❌ | ❌ 2026-05 停更 [S16] | ❌ |

### 表 B · 工作区层（替代 OpenChamber）

| 候选 | 驱动对象 | 形态 | 远程/多端 | worktree | 独有能力 | 许可 | star | 结论 |
|---|---|---|---|---|---|---|---|---|
| **OpenChamber**（现状） | opencode | web + desktop + VS Code | ✅ 手机 + relay [S5] | ✅ + 分组补丁 | Multi-run 5 模型、relay 配对 [S5] | MIT [S5] | 12.7k | 保留 |
| **CodeNomad** | **仅 OpenCode V2** | web + desktop | ✅ 密码 + HTTPS + 手机配对 [S20] | ✅ | 项目标签、嵌套会话、MCP/插件管理 [S20] | MIT [S20] | 2.7k | 换 UI 首选 |
| **Paseo** | 7 种 agent（含 opencode） | daemon + 全端 | ✅ relay、`--host` [S22] | ✅ | 多 harness 编排、插件、SDK、定时 [S17] | Apache-2.0 [S18] | 23.5k | 换范式首选 |
| **Agent Canvas** | ACP（含 OpenCode） | 自托管 Web | ✅ 单容器 :8000 [S15] | ⚠️ 未核实 | Slack/GitHub/Linear 自动化、多 backend [S15] | MIT [S15] | 93k | 观察 |
| **opencode 自带 Web** | opencode | 引擎同进程 | ⚠️ 一次性链接 [S2] | ✅ 引擎内置 [S33] | 零额外进程/内存 [S3][S4] | MIT | — | 降级保险 |
| Vibe Kanban | 10+ CLI | 本地 Web 看板 | ⚠️ | ✅ | 看板式任务编排 [S21] | Apache-2.0 | 28.6k | 不选（范式不同） |
| Termic | Claude/Gemini/Codex | 桌面 GUI | ❌ | ✅ | 真 PTY + 内联评论 [S22] | AGPL-3.0 | 0.3k | 不选（无服务器） |
| Happy | Claude/Codex | 手机中继 + CLI | ✅ E2E | ❌ | 手机遥控 | — | 0.6k | 不选（停更） [S23] |
| Omnara | 多 agent | Web/手机 | ✅ | ❌ | hosted 平台 | Apache-2.0 | 3.4k | 不选 [S24] |
| Conductor | Claude/Codex/Cursor/opencode | macOS 原生 | ❌ | ✅ | diff 审阅体验 | 闭源 | — | 不选（平台） [S25] |

### 表 C · 四个直接对手的逐项对比

| 判据 | OpenChamber | CodeNomad | Paseo | Agent Canvas |
|---|---|---|---|---|
| 与 opencode 的贴合 | 原生（自建 server + 嵌入引擎）[S5] | 原生（连 opencode 共享后台服务）[S20] | 外部（把 opencode 当 provider 之一）[S17] | 外部（ACP）[S15] |
| opencode 专属功能（multi-run、插件面板） | ✅ [S5] | ⚠️ 部分 | ❌ 不保证 | ❌ 不保证 |
| 多 agent 混跑 | ❌ | ❌ | ✅ 7 种 [S17] | ✅ ACP 全家桶 [S15] |
| 手机端 | ✅ 自有 + relay [S5] | ✅ 配对 [S20] | ✅ 原生 iOS/Android [S17] | ⚠️ Web 响应式 |
| 自动化/触发器 | ⚠️ 弱 | ⚠️ 弱 | ✅ 定时 + Hub [S17] | ✅ Slack/GitHub/Linear [S15] |
| 部署复杂度（本容器） | 已就绪 | 低（单进程 + 密码） | 中（daemon + 可选 relay） | 高（另一套 agent server） |
| 失败半径 | 中（UI 挂了引擎还在） | 中 | 中 | **大（自带引擎/沙箱）** |
| 维护面 | 大（fork 补丁 + 快速迭代） | 小 | 中 | 中 |
| 社区规模 | 12.7k [S5] | 2.7k [S20] | 23.5k [S17] | 93k [S15] |

> 表 C 中未标 `[S#]` 的 ✅/⚠️/❌ 是按各项目 README 功能清单做的**推断**，不是逐项实测。

## Analysis

**（以下为推论，不是来源事实。）**

**1. 为什么"换 UI"和"换引擎"是两个数量级的事。** 本仓库有四个 opencode 专属资产：magic-context（钉在 `plugins` 里，跑在引擎进程内）[S26]、session_search（直读 `opencode.db`）[S31]、Feishu 问答桥（依赖 opencode 的 `/api/info` 与会话接口）[S30]、以及 BD 版本门禁（OpenChamber 与 opencode 的兼容矩阵）[S7]。换 UI 只动第一层——引擎、会话库、插件、桥全部原样；换引擎则四个全废。**这就是为什么"引擎层最该激进"其实反了：引擎层才是锁死的地方。**

**2. OpenChamber 的护城河已经从"有 UI"迁到"工作流"。** 实测证明 opencode 自带可自托管的 Web [S4]，且 v2 引擎本身就有 worktree 策略 [S33]，所以"OpenChamber 提供界面"和"OpenChamber 提供 worktree"这两个理由都已过期。它现在真正难被替代的是三件事：worktree 分组（上游 #5669 至今未修，我们靠 fork 补丁）、Multi-run 多模型对撞、手机 relay 配对 [S5]。反过来说，**如果这三件事对你都不重要，那 CodeNomad 甚至 opencode 自带 Web 就够了**——这是本次调研最直接的取舍。

**3. 两个挑战者其实在卖不同的东西。** Paseo 卖"我不再被 opencode 绑定"：今天用 opencode，明天想试 Codex 就切 provider，UI 不变 [S17]。Agent Canvas 卖"把你的 agent 变成一个常开的团队"：Slack/GitHub 触发、多 backend、自动化 [S15]。这两个价值都真实，但**都不是当前这台的痛点**——当前的痛点是 OpenChamber 自身的回归（问答表单、git 探测风暴）和 fork 维护成本 [S7]。

**4. Agent Canvas 在本容器有一个结构性风险。** 它经 ACP 驱动 OpenCode [S15]，意味着它会**再拉起一套 opencode 进程**。本容器的铁律是"只允许 OpenChamber 管理的那一个 opencode 实例"，两个实例会争同一个 `opencode.db`、同一套插件与端口 [S26]。所以它的迁移成本不是"装个容器"，而是"重构整个启动拓扑"——这也是它排在观察位而非推荐位的原因。

**5. 成本归一化（同一单位：每月新增支出 + 容器常驻内存 + 维护面）。** 所有候选许可费都是 **$0**；token 成本由引擎与模型决定，换 UI 完全不变。差异只在：OpenChamber **+439 MB**（实测）[S6]；opencode 自带 Web **+0 MB**（同进程）[S4]；CodeNomad / Paseo / Agent Canvas **未实测**（这是换之前必须先量的一项，Agent Canvas 还要额外算"第二套引擎"的 ~0.8 GB 量级）。维护面上，OpenChamber 是唯一需要**自己维护 fork 补丁**的选项。

## Confidence, gaps & disagreements

- **高置信（多来源或一手实测）：** opencode 的形态与许可 [S1][S2]；`serve` 本地提供 Web UI（本机探针）[S3][S4]；OpenChamber 的能力与许可 [S5]；Paseo 的多 agent/daemon/relay/许可 [S17][S18][S19]；CodeNomad 的版本要求与 server 模式 [S20]；Agent Canvas 的重定位与 ACP/单容器 [S15]。
- **单来源 / 待定：** Vibe Kanban 母公司关停转社区（第三方横评，未核实）[S25]；Kilo CLI 建于 opencode 之上（第三方横评）[S14]。
- **未建立：** 三个挑战者的真实内存占用；Paseo/CodeNomad/Agent Canvas 驱动 opencode 时 magic-context 是否照常工作；OpenChamber 2.6.x 的 #6131/#6084 是否已修（只在仓库 BD 文档里有记录，本次未回访上游 issue）。
- **不矛盾但需澄清：** 网上仍流传"opencode Web UI 是托管页"——那是 v1 时代的行为；v2.2.5 实测为本地服务 [S4]。**读者若看到相反说法，以本机复跑为准。**

## Recommendations

**方案 1（默认，现在执行）：不换，但加一条零成本保险。**
保留 opencode 2.2.5 + OpenChamber 2.6.0 fork。理由是它仍然是唯一同时给到 worktree 分组、多模型对撞、手机 relay、VS Code 的组合，且已经在跑、已钉版本 [S5][S7]。**立刻做的一件事：把 `opencode` 自带 Web 记为降级入口**（引擎同进程、零额外内存 [S4]）——OpenChamber 更新炸了或端口被占时，不用重装任何东西就能继续干活。成本：$0、0 MB。
触发重评：OpenChamber 出现"会话发不出/表单提交不了"级别的回归，或 fork 补丁与上游冲突到无法 rebase。

**方案 2（真要换 UI 时的第一顺位）：CodeNomad。**
同一个引擎、同一个版本要求（2.2.5 正好是它推荐的版本 [S20]）、自带密码 + HTTPS + 手机配对，概念迁移成本最低，magic-context 等插件全部保留（引擎没动）。代价：2.7k star 的团队规模，功能面比 OpenChamber 窄。**换之前只需量一件事：它在你机器上的 RSS。**

**方案 3（换范式才选）：Paseo。**
只有当你确实想"一个界面同时指挥 Claude Code / Codex / opencode"时才值 [S17]；它的 relay 与多端覆盖是四个里最完整的（据其文档）[S19][S17]。代价是放弃 opencode 专属工作流（multi-run、插件面板），并把运维面从"一个 web 进程"扩到"daemon + 可选 relay + 客户端"。

**观察位（不推荐现在动）：Agent Canvas。** 它的产品逻辑最先进（自动化 + 多 backend + ACP），但会引入第二套 agent 运行时，与"单实例 opencode"的铁律冲突 [S15][S26]。等它明确支持"接管已有 opencode 服务"而非自起一套时再评估。

**明确不选：** Vibe Kanban（看板范式，且疑似易主）[S21][S25]、Conductor（macOS）[S25]、Happy（停更）[S23]、Termic（桌面）、以及所有只有 TUI 的引擎（Pi/Codex/Cline/Gemini）——它们缺的不是能力，是"被 UI 长期驱动"的接口 [S10][S11][S13][S12]。

**下一步（按性价比排序，每步 ≤30 分钟）：**
1. 在 4096 之外的端口，用隔离数据目录起一次 `opencode serve`，确认自带 Web 在**你的配置下**（含 magic-context）能正常开会话——这就把"降级入口"从文档变成可执行预案。
2. 用同样方式起一次 CodeNomad（`--host 127.0.0.1` + 密码），量 RSS，看它能否读到现有会话。
3. 只有在第 2 步不满意时，再测 Paseo daemon。

---

## Sources

| ID | Source | Tier | Access | Published | Retrieved |
|---|---|---|---|---|---|
| S1 | [GitHub API — anomalyco/opencode](https://api.github.com/repos/anomalyco/opencode) | T1 | public | undated | 2026-11-09 |
| S2 | [OpenCode v2 docs — Intro](https://opencode.ai/v2/docs) | T1 | public | undated | 2026-11-09 |
| S3 | [本容器 opencode serve --help (v2.2.5)](local://opencode-serve-help) | T1 | public | 2026-11-09 | 2026-11-09 |
| S4 | [本容器探针（XDG_DATA_HOME 隔离，端口 4999）](local://127.0.0.1:4999) | T1 | public | 2026-11-09 | 2026-11-09 |
| S5 | [OpenChamber README](https://github.com/openchamber/openchamber) | T1 | public | undated | 2026-11-09 |
| S6 | [本容器 ps + /sys/fs/cgroup 实测](local://ps) | T1 | public | 2026-11-09 | 2026-11-09 |
| S7 | [debian-railway versions/BD-INDEX.md](repo://versions/BD-INDEX.md) | T1 | public | 2026-11-03 | 2026-11-09 |
| S8 | [DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness) | T1 | public | undated | 2026-11-09 |
| S9 | [DeepSeek Harness docs — 使用 Web UI](https://deepseek-harness.github.io/deepseek-harness/guide/quickstart.md) | T1 | public | undated | 2026-11-09 |
| S10 | [Pi README — Packages](https://raw.githubusercontent.com/earendil-works/pi/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S11 | [GitHub API — openai/codex](https://api.github.com/repos/openai/codex) | T1 | public | undated | 2026-11-09 |
| S12 | [GitHub API — google-gemini/gemini-cli](https://api.github.com/repos/google-gemini/gemini-cli) | T1 | public | undated | 2026-11-09 |
| S13 | [GitHub API — cline/cline](https://api.github.com/repos/cline/cline) | T1 | public | undated | 2026-11-09 |
| S14 | [GitHub API — Kilo-Org/kilocode](https://api.github.com/repos/Kilo-Org/kilocode) | T1 | public | undated | 2026-11-09 |
| S15 | [GitHub API — OpenHands/OpenHands](https://raw.githubusercontent.com/OpenHands/OpenHands/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S16 | [GitHub API — Aider-AI/aider](https://api.github.com/repos/Aider-AI/aider) | T1 | public | undated | 2026-11-09 |
| S17 | [Paseo README](https://github.com/getpaseo/paseo) | T1 | public | undated | 2026-11-09 |
| S18 | [Paseo LICENSE](https://raw.githubusercontent.com/getpaseo/paseo/HEAD/LICENSE) | T1 | public | undated | 2026-11-09 |
| S19 | [Paseo docs — CLI reference / daemon](https://raw.githubusercontent.com/getpaseo/paseo/HEAD/public-docs/cli.md) | T1 | public | undated | 2026-11-09 |
| S20 | [CodeNomad README / requirements](https://github.com/NeuralNomadsAI/CodeNomad) | T1 | public | undated | 2026-11-09 |
| S21 | [Vibe Kanban README](https://github.com/BloopAI/vibe-kanban) | T1 | public | undated | 2026-11-09 |
| S22 | [GitHub API — simion/termic](https://api.github.com/repos/simion/termic) | T1 | public | undated | 2026-11-09 |
| S23 | [GitHub API — slopus/happy-cli](https://api.github.com/repos/slopus/happy-cli) | T1 | public | undated | 2026-11-09 |
| S24 | [GitHub API — omnara-ai/omnara](https://api.github.com/repos/omnara-ai/omnara) | T1 | public | undated | 2026-11-09 |
| S25 | [agentsroom.dev — Best Tools to Run Multiple Coding Agents (2026)](https://agentsroom.dev/blog/best-multi-agent-coding-tools) | T3 | public | undated | 2026-11-09 |
| S26 | [debian-railway AGENTS.md — Architecture](repo://AGENTS.md) | T1 | public | 2026-11-05 | 2026-11-09 |
| S27 | [本容器 /sys/fs/cgroup 实测](local://cgroup) | T1 | public | 2026-11-09 | 2026-11-09 |
| S28 | [debian-railway opencode-config/opencode/opencode.jsonc](repo://opencode-config/opencode/opencode.jsonc) | T1 | public | 2026-10-26 | 2026-11-09 |
| S29 | [Paseo docs — Docker / Web UI](https://paseo.sh/docs/docker) | T1 | public | undated | 2026-11-09 |
| S30 | [debian-railway scripts/start-feishu-bridge.sh + AGENTS.md](repo://scripts/start-feishu-bridge.sh) | T1 | public | 2026-11-05 | 2026-11-09 |
| S31 | [debian-railway opencode-config/.../session-search](repo://opencode-config/opencode/lib/session-search.js) | T1 | public | 2026-10-28 | 2026-11-09 |
| S32 | [本容器 opencode --help (v2.2.5)](local://opencode-cli-help) | T1 | public | 2026-11-09 | 2026-11-09 |
| S33 | [本容器 /usr/bin/opencode 字符串探针 (v2.2.5)](local://opencode-binary-strings) | T1 | public | 2026-11-09 | 2026-11-09 |
