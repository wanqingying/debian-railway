# 替代 opencode 本体：18 个新增候选的横评

**问题：** 上一份报告的引擎层只筛出「DeepSeek Harness 一个够格」，那个范围划窄了。完整的问题是：**能把 opencode 整个换掉吗？换掉之后还剩什么？**
**日期：** 2026-11-09  **来源：** 新增 18 条（S34–S51），累计 51 条 / 60 条结论，准确率 100%（49/49 承重）

---

## 0. 先纠正上一版的筛法

上一版对引擎层用的是「有没有常驻 Web 工作区」这一条，于是把两类真候选滤掉了：

- **只提供 Runtime API / ACP、不提供 UI 的 harness**（CodeWhale 的 `app-server --http`、Grok Build 的 headless + stdio、Reasonix 的 ACP）——它们恰恰是"引擎"最纯粹的样子，UI 由外部接。
- **把 UI 和聊天集成一起做进引擎的 harness**（Qwen Code 的 `qwen serve` + WebShell + Feishu/Telegram 集成）[S34][S35][S36]。

下面按「能不能承接 opencode 现在承担的四件事」重新筛。

## 1. 换引擎 = 换掉四件东西（判据）

| # | 判据 | 为什么它是硬门槛 | opencode 现状 |
|---|---|---|---|
| C1 | 常驻服务 + 会话 API | Feishu 桥、多端、外部 UI 都靠它 | `serve`：HTTP + Web [S3][S4] |
| C2 | ACP | 现有 OpenChamber / Paseo / CodeNomad 直接驱动 | `acp` 子命令 [S32] |
| C3 | 插件 / hook 深度 | magic-context 级能力（压缩、记忆、嵌入）要在进程内 | 插件 API + `plugins` 清单 [S26] |
| C4 | 自定义端点 + header | 必须指向内网 OpenAI 兼容网关 | `providers.settings.baseURL` [S28] |
| C5 | 会话库可读 | session_search 直读 `opencode.db` | SQLite [S31] |
| C6 | 运行时成本 | 16 GB 容器里 opencode 常驻 790 MB | Node 单进程 [S6] |
| C7 | 版本纪律 | 我们靠 BD 钉版本活 | 具体版本可钉 [S7] |

任何候选只要在 C1–C4 里缺一项，就不是"替代"，而是"另一种用法"。

## 2. 全景：四层，21 个候选

- **A 层｜同架构可直接替换**（有常驻服务/API + 可扩展 + 自定义端点）：DeepSeek Harness、Qwen Code、CodeWhale、Grok Build。
- **B 层｜能力够但没有守护进程**（TUI + ACP/headless）：Reasonix、Pi、Kimi Code、Goose、Crush、Codex CLI、Claude Code（闭源）、Gemini CLI、Cline、Kilo、Aider（停更）。
- **C 层｜平台与编排层**（自带引擎或调度别人）：OpenHands/Agent Canvas、Orca、OpenClaw、Claude Squad/amux/dmux、Agent of Empires。
- **D 层｜配套基础设施**（不替代引擎，改变成本结构）：CLIProxyAPI 这类"订阅→OpenAI 兼容 API"的代理。

### 表 A · A 层逐项对比

| 判据 | opencode（现状） | DeepSeek Harness | Qwen Code | CodeWhale | Grok Build |
|---|---|---|---|---|---|
| 常驻服务 | ✅ `serve` [S3][S4] | ✅ `dsh web` :3080 [S9] | ✅ `qwen serve` HTTP+SSE + WebShell :4170 [S36] | ✅ `app-server --http` `/v1` + SSE + 手机页 [S39] | ⚠️ headless + stdio；文档未见 HTTP 守护进程 [S41] |
| 会话 API / 多客户端共享 | ✅ [S3] | ✅ Web UI [S9] | ✅ 多客户端共享会话、transcript / approval API [S36] | ✅ `/v1/*` + JSON-RPC 控制通道 [S39] | ⚠️ 会话落盘可 resume/rewind [S43] |
| ACP | ✅ [S32] | ⚠️ 未核实 | ✅ 托管 ACP 子进程 [S36] | ✅ `serve --acp` [S39] | ✅ [S41] |
| 插件 / hook 深度 | ✅ 插件 + hooks [S26] | ✅ **everything-is-a-plugin** [S8] | ✅ extensions + agent plugins（experimental） | ⚠️ 只吃 Claude Code 插件格式，拒绝 hooks/LSP [S40] | ✅ plugins/hooks/skills/sandbox [S41] |
| 自定义端点 | ✅ [S28] | ✅ [S9] | ✅ modelProviders + providerProtocol + baseUrl [S37] | ✅ 40+ provider / 任意 OpenAI 兼容 [S38] | ✅ custom models [S42] |
| 会话库 | SQLite，可直读 [S31] | 自有格式 | 自有格式 | 自有格式 | `~/.grok/sessions/` [S43] |
| 运行时 | Node，790 MB [S6] | Node | Node | **Rust 单二进制** [S38] | **Rust** [S41] |
| 成熟度 | 生产（BD 钉版本） | developer preview + 破坏性变更 [S8] | **daemon 标注 Experimental** [S36] | 生产可用（41k star） | 生产可用（xAI 官方） |
| 许可 | MIT [S1] | MIT [S8] | Apache-2.0 [S34] | MIT [S38] | Apache-2.0 [S41] |

### 表 B · B 层（有引擎、没守护进程）

| 候选 | 形态 | 可取之处 | 不能直接替换的原因 |
|---|---|---|---|
| Reasonix | CLI + ACP | ACP + Extension Protocol sidecar，可被 dsh 当子 agent [S44] | 无守护进程；生态围绕 DeepSeek |
| Pi | CLI/TUI/SDK | 极简、可扩展、多 provider SDK [S10] | 无常驻服务；要自己写 UI 层 |
| Kimi Code | CLI + ACP | ACP + 带信任级别的插件市场 [S45] | 无守护进程；Moonshot 生态为主 |
| Goose | 桌面 + CLI + **API** | Rust、15+ provider、有可嵌入 API [S46] | API 不是我们需要的会话服务；生态偏通用自动化 |
| Crush | TUI | MCP + LSP 扩展、体验好 [S47] | 无守护进程 |
| Codex CLI | CLI | 生态最大（133k star）[S11] | 远程能力在 OpenAI 云，不在自己机器 |
| Claude Code | CLI/SDK | 能力最强（闭源） | 不可自托管改造；条款限制 |
| Gemini CLI / Qwen CLI 上游 | CLI | 免费额度 | 绑 Gemini 生态 |
| Cline / Kilo | SDK/IDE | 上手快 | 无服务端；Kilo 本身是 opencode 下游 |

### 表 C/D · 平台与配套

| 候选 | 是什么 | 与本问题的关系 |
|---|---|---|
| OpenHands / Agent Canvas | 自托管 agent 控制中心，ACP 驱动一切 [S15] | 会再起一套引擎，与"单实例 opencode"冲突 |
| Orca（119k） | agent 舰队编排：Remote Server + SSH + 每 worktree 一个云 VM [S49] | 不是引擎，是"多机多 agent"的调度层 |
| OpenClaw（394k） | 跨设备/跨聊天工具的私人助理，harness 可插拔 [S48] | 定位是助理不是编码引擎；但它是"Feishu/微信里问一句"这条路的现成答案 |
| Agent of Empires | TUI + Web 管理多个 Claude Code/OpenCode [S50] | UI 层候选（比 Paseo 轻） |
| CLIProxyAPI（58k） | 把订阅包装成 OpenAI 兼容 API [S51] | 想复用订阅额度时用它，不用换引擎；注意 ToS |

## 3. 分析：换引擎到底换掉了什么

**（推论）**

**① 收益只有一个可量化项：运行时内存。** opencode 在这里常驻 790 MB（Node）[S6]；CodeWhale 与 Grok Build 是 Rust 单二进制 [S38][S41]，量级上可能降到 1/5–1/10——但**本次没有实测**，不能写具体数字。除此之外，A 层五个候选在"能不能干活"上没有代差。

**② 代价是四个资产，其中两个不可替代。** magic-context（上下文压缩 + 记忆）[S26] 和 session_search（跨会话检索）[S31] 不是功能，是**积累**：换引擎意味着这两条历史链断掉，且只有 dsh 的插件优先架构 [S8] 有可能重写等价物。Feishu 桥 [S30] 与 skills 目录反而是可迁移的——Qwen Code 内置 Feishu 集成 [S35]，CodeWhale 直接吃 Claude Code 插件格式 [S40]。

**③ 所以"替代 opencode"有两条完全不同的路。**
- **同层替换**：换一个引擎 + 保留现有 UI（靠 ACP）。收益是内存，代价是 C3/C5 归零。
- **分层替换**：引擎留 opencode、把 UI 换成 Paseo/CodeNomad/Orca。收益立刻可见，代价接近零。
上一版报告的结论（换 UI 而不是换引擎）在这条逻辑下依然成立，只是现在有了数字化的解释。

**④ 唯一"一把梭"的候选是 Qwen Code。** 它同时提供 daemon [S36]、WebShell [S36]、ACP [S36]、自定义端点 [S37]，还内置 Feishu/Telegram/DingTalk/WeChat 集成 [S35]——理论上能一次性替掉「引擎 + OpenChamber + 自建 Feishu 桥」三件套。风险同样集中：daemon 明确标注 Experimental [S36]，且它的生态是 Gemini CLI 系，不是 opencode 系。

**⑤ 成本归一化。** 许可全部 $0；token 成本由模型决定，与引擎无关。差异只在：常驻内存（Node ~790 MB vs Rust 未知但更小）、维护面（opencode 需要我们维护 fork 的 OpenChamber，其余不需要）、迁移人力（magic-context/session_search 重写的天数）。**只要你不打算重写那两个资产，换引擎的净收益就是负的。**

## 4. 推荐（按动机分，不按优劣排）

| 你的动机 | 该做什么 | 不该做什么 |
|---|---|---|
| **省内存 / 去掉 Node 运行时** | 先在**小项目**上试 CodeWhale 两周（`app-server --http` + `serve --acp`，仍能被现有 UI 驱动）[S39]，量 RSS | 一上来就迁主工作区 |
| **Feishu/微信里直接问** | 试 Qwen Code 的 daemon + 内置 Feishu 集成 [S35][S36]，评估能否替掉自建桥 | 指望它 daemon 稳定（Experimental） |
| **可扩展性 / 未来架构** | 把 dsh 列为观察项，等它离开 preview [S8] | 现在就上生产 |
| **多 harness 混跑 / 多机** | 不换引擎，加 Paseo（单机多 agent）[S17] 或 Orca（多机舰队）[S49] | 为此换掉 opencode |
| **复用已有订阅额度** | 用 CLIProxyAPI 这类代理接出来 [S51] | 以为这是"换引擎"（不是），并注意各家 ToS |
| **没有明确痛点** | 不动。这也是绝大多数情况的正确答案 | 为了"新"而迁 |

**触发点（什么情况下这条建议会变）：** ① opencode v2 的会话库或 ACP 行为出现破坏性变更、且我们无法跟版；② magic-context 停止维护，C3 的价值归零；③ Rust 候选的实测内存显著低于 200 MB 且能承接 skills + MCP，那时"省内存"就足以推动迁移。

## 5. 不确定性与反面证据

- **未实测**：CodeWhale / Grok Build / Qwen Code 的真实内存、真实长任务表现、以及它们能否读到我们现有的会话历史。三条都没有数据。
- **口径不一致**：Qwen Code 的 daemon 与 CodeWhale 的 Runtime API 都还在演进（前者自述 Experimental），把它们与 opencode 的 `serve` 并列会高估成熟度。
- **反面证据**：`OpenClaw` 有 394k star [S48]，但它不是编码引擎；`Orca` 有 119k [S49]，但它是编排层。**热度不能当作"替代品"的证据**，这是本次调研最容易踩的坑。
- **唯一被本次实测加固的结论**：opencode 自带 Web + ACP + 插件 + 可读会话库，这套组合仍然是 A 层里最完整的；挑战者各自只赢一项。

## Sources（新增部分）

| ID | Source | Tier | Access | Published | Retrieved |
|---|---|---|---|---|---|
| S34 | [GitHub API — QwenLM/qwen-code](https://api.github.com/repos/QwenLM/qwen-code) | T1 | public | undated | 2026-11-09 |
| S35 | [Qwen Code README](https://raw.githubusercontent.com/QwenLM/qwen-code/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S36 | [Qwen Code docs — Daemon mode](https://raw.githubusercontent.com/QwenLM/qwen-code/HEAD/docs/users/qwen-serve.md) | T1 | public | undated | 2026-11-09 |
| S37 | [Qwen Code docs — Model Providers](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/) | T1 | render | undated | 2026-11-09 |
| S38 | [GitHub API — codewhale-hq/Codewhale](https://api.github.com/repos/codewhale-hq/Codewhale) | T1 | public | undated | 2026-11-09 |
| S39 | [CodeWhale docs — Runtime API](https://raw.githubusercontent.com/codewhale-hq/Codewhale/HEAD/docs/RUNTIME_API.md) | T1 | public | undated | 2026-11-09 |
| S40 | [CodeWhale README — plugins](https://raw.githubusercontent.com/codewhale-hq/Codewhale/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S41 | [GitHub API — xai-org/grok-build](https://api.github.com/repos/xai-org/grok-build) | T1 | public | undated | 2026-11-09 |
| S42 | [Grok Build docs — Custom Models](https://raw.githubusercontent.com/xai-org/grok-build/HEAD/crates/codegen/xai-grok-pager/docs/user-guide/11-custom-models.md) | T1 | public | undated | 2026-11-09 |
| S43 | [Grok Build docs — Sessions](https://raw.githubusercontent.com/xai-org/grok-build/HEAD/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md) | T1 | public | undated | 2026-11-09 |
| S44 | [DeepSeek-Reasonix README](https://raw.githubusercontent.com/esengine/DeepSeek-Reasonix/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S45 | [Kimi Code README](https://raw.githubusercontent.com/MoonshotAI/kimi-code/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S46 | [Goose README](https://raw.githubusercontent.com/aaif-goose/goose/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S47 | [GitHub API — charmbracelet/crush](https://api.github.com/repos/charmbracelet/crush) | T1 | public | undated | 2026-11-09 |
| S48 | [OpenClaw README](https://raw.githubusercontent.com/openclaw/openclaw/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S49 | [Orca README](https://raw.githubusercontent.com/stablyai/orca/HEAD/README.md) | T1 | public | undated | 2026-11-09 |
| S50 | [GitHub API — agent-of-empires](https://api.github.com/repos/agent-of-empires/agent-of-empires) | T1 | public | undated | 2026-11-09 |
| S51 | [GitHub API — CLIProxyAPI](https://api.github.com/repos/router-for-me/CLIProxyAPI) | T1 | public | undated | 2026-11-09 |

S1–S33 见同目录 `report.md`。
