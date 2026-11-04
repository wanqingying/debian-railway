# 单人上架 Steam 的 10–30 元游戏，引擎该怎么选

**Question:** 单人开发、上架 Steam 的单机游戏（小到中等体量，定价 10–30 元人民币），应该如何在游戏引擎之间做选择？
**Date:** 2026-11-02  **Depth:** deep
**Sources:** 47（36 条 T1 一手） · **Citation accuracy:** 100% (54/54) · **Cutoff:** 2026-11-02

## TL;DR

- **先算账，再选引擎。** 2026 年 Steam 新作的收入中位数在 196–290 美元之间，约 67% 的新作毛收入不到 1,000 美元 [S5][S6]；引擎许可费（0–715 元）不是这个价位段的主要风险，**能不能在 6–12 个月内做完并被看见**才是。
- **没有特殊类型偏好时，默认选 Godot 4.7。** MIT、2D 是一等公民、4.7 补上了官方 Asset Store [S12]，Steam 侧有 GodotSteam 4.23.2（Steamworks SDK 1.65，覆盖成就/云存档/工坊）[S36]。代价是主机移植必须走第三方 [S35]、3D 上限低于 Unity/Unreal。
- **如果“手感”就是卖点**（平台跳跃、动作、弹幕、肉鸽），GameMaker 仍是最快的 2D 路径，血脉里有 Spelunky、DELTARUNE、UFO 50 [S45]。但 2026 年立项要按 **99.99 美元商用授权 + LTS 2026 / GMS2 运行时**做预算：GMRT 虽然 2027-01-01 起商用免费 [S18]，官方手册明确说它还是实验性、不建议把在研项目迁过去 [S19]。
- **已有 C# 基础、需要成熟资产/中间件、或要主机与中高画质 3D** → Unity 6.3 LTS。个人版在年收入/融资 20 万美元以下免费，Pro 为 2,310 美元/席/年，Runtime Fee 已取消 [S13][S14]。
- **类型专用工具常常胜过通用引擎**：JRPG → RPG Maker MZ（79.99 美元，国区 268 元）[S24][S25]；视觉小说 → Ren'Py（免费，内置 Steamworks SDK 1.62 + Steam Timeline）[S26][S27]。
- **不要把这个体量交给 Unreal 默认处理。** UE 5.8 是 UE5 最后一个计划大版本 [S16]，5% 版税要单款累计 100 万美元后才触发 [S15]——钱不是问题，问题是学习、构建与包体成本跟 10–30 元的产品逻辑不匹配。
- **最大的不确定性**：你的类型、美术能力、编程背景未知，所以下面给的是决策树而不是单一答案；另外 Valve 的 30% 基线来自媒体对合同的核对，公开页面只写了 1,000 万美元以上的分档 [S1][S2]。

## Method

- **节点**：N1 收入结构 → N2 候选全集 → N3 授权与费用 → N4 出货能力 → N5 生态/单人可完成性 → N6 类型映射 → N7 决策框架。
- **来源与通道**：全部为公开网页（lane A），共 47 个来源、54 条 claim；36 条来自厂商/平台一手页面（T1），6 条 T2，8 条 T3，1 条 T4（中文社区教程）。
- **未覆盖**：Valve 的 Steam Distribution Agreement 正文需要登录签署后才能查看，30% 基线只能用 Valve 公告 + 媒体核对来支撑；RPG Maker/Defold/LÖVE 的部分 Steam 接入细节只有社区方案，已在文中标“未核实”。
- **执行方式**：单上下文顺序采集（未使用并行 worker），因此不存在“多路独立搜索”的独立性，结论对早期检索框架有一定路径依赖。
- **范围外**：蒸汽平台（Steam 中国）的版号/发行资质、税务申报、美术外包与发行谈判，不在本报告内。

## Findings

### N1 · 10–30 元的钱怎么分，引擎费到底算不算成本

先把收入拆开。Steam 对前 1,000 万美元流水抽 30%，之后 25%，5,000 万美元以上 20% [S1]；30% 这个基线在 Valve 的公开公告里没有单独成句，是媒体核对合同后的表述 [S2]。每款产品还要先交 100 美元 Steam Direct 费，产品累计 Adjusted Gross Revenue 达到 1,000 美元后才返还 [S3]；退款规则是 14 天内、游玩不足 2 小时 [S4]。非美国开发者拿到的分成按版税处理，美国来源收入预扣 0%–30%，取决于税表与税收协定 [S8]。

| 销量（定价 ¥20） | 毛收入 | 扣 30% 后 | 再计 8% 退款 | 扣 Steam Direct（≈¥715） | GameMaker 授权占净收入 |
|---|---:|---:|---:|---:|---:|
| 1,000 份 | ¥20,000 | ¥14,000 | ¥12,880 | ¥12,165 | 5.9% |
| 5,000 份 | ¥100,000 | ¥70,000 | ¥64,400 | ¥63,685 | 1.1% |
| 20,000 份 | ¥400,000 | ¥280,000 | ¥257,600 | ¥256,885 | 0.28% |

（汇率按 1 USD ≈ 7.15 CNY 估算；未计个人所得税与预扣税，8% 退款仅为敏感性假设。）

这张表要跟市场现实一起看：2026 上半年近 1.2 万款新作，中位收入 196 美元，67% 不到 1,000 美元，只有 1.2% 过 100 万美元 [S5]；Q1 的 6,169 款新作中位数约 290 美元，平均每天上线 55 款以上 [S6]；GameDiscoverCo 追踪的 2026 年 1 月付费新作，8 个月后中位毛收入约 1,000 美元，7.2% 到 10 万美元、1.3% 到 100 万美元 [S7]；2025 年那一批的中位数则是 249 美元 [S7]。**中位销量的开发者，连 100 美元的 Steam Direct 费都很难收回**（需要约 1,000 美元 AGR，折合约 358 份 × ¥20）。

结论不是“所以别做”，而是：**在这个区间，引擎的授权费只在“中位结果”下才显得大**（¥715 相当于中位净收入的约 55%–80%，取决于是用 196 还是 290 美元的中位口径），但它相对于 6–12 个月的人力成本仍然是零头。选型的第一目标因此是**降低完成成本与返工概率**，不是省许可费，也不是追求引擎上限。

### N2 · 候选全集与入选标准

入选标准（四条同时满足）：① 能导出 Windows x64 构建并在 Steam 外运行；② 有已发行的商业 Steam 作品，或有官方/事实标准的 Steamworks 接入路径；③ 2025–2026 年仍在维护；④ 单人可用（有编辑器与文档，不要求团队管线）。

按这个标准，值得进入决选的只有三类：

| 类别 | 候选 | 为什么在这个名单里 |
|---|---|---|
| 通用引擎 | **Godot**、**Unity**、**GameMaker**、**Unreal**、**Defold**、**Construct 3**、**GDevelop** | 都有编辑器、桌面导出与 Steam 先例；差别在 2D/3D 重心、授权与生态 |
| 框架/库 | **MonoGame/FNA**、**LÖVE**、**Bevy** | 没有完整编辑器，换来完全控制与极小运行时；适合以编程为主的人 |
| 类型专用 | **RPG Maker MZ**、**Ren'Py** | 把某一类的“底座”直接买下来：JRPG 的数据库/事件，VN 的存档/回看/本地化 |

长尾候选（本次未逐项核价，但属于同一决策空间）：Cocos Creator、libGDX、raylib、HaxeFlixel、Adventure Game Studio（点击冒险）、Pixel Game Maker MV / Action Game Maker（动作向 Maker 系）、Wolf RPG Editor、Visionaire Studio、Naninovel（Unity 上的 VN 框架）、RPG in a Box。它们大多在“类型极度匹配”时才有意义，不作为默认解。

排除项及原因：纯手游/纯 Web 工具（无法直接产出可上架桌面构建）、MMO/服务端优先的引擎（与单机需求相反）、2025 年后无维护的引擎、以及“从零自研引擎”（对首款商业作品是把风险乘二）。框架类里也有反例：《吸血鬼幸存者》最初用 Phaser（HTML5 框架）做出爆款 [S46]，但这类 Web 技术要先自己解决桌面封装与 Steam 接入，属于“能走通但不是默认路径”。

### N3 · 2026 年 11 月的授权与费用

| 引擎 | 授权/费用（本价位段实际触发） | 当前版本 | 关键条款 |
|---|---|---|---|
| Godot | ¥0 | 4.7（2026-06-18）[S10]，4.8 预计 2026 Q4 [S11] | MIT，可商用、无版税 [S9] |
| Unity | ¥0（Personal）；年收入/融资 >20 万美元才强制 Pro | 6.3 LTS（支持到 2027-12）[S14] | Pro 2,310 美元/席/年（210 美元/月）；Runtime Fee 已取消 [S13] |
| Unreal | ¥0；单款累计 >100 万美元后 5% | 5.8（UE5 最后一版）[S16] | 5% 版税，Epic 商店收入免；非游戏席位 1,850 美元/年 [S15] |
| GameMaker | 99.99 美元一次性（商用）[S17] | LTS 2026 / GMRT beta | GMRT 自 2027-01-01 商用免费，但目前是 beta，官方不建议迁移 [S18][S19] |
| Defold | ¥0 | 持续月度更新 | 永久免费、无版税，基金会持有 [S20] |
| Construct 3 | 129.99 美元/年（个人） | r458+ | 订阅制；NW.js 导出已退役，改用 WebView2/WKWebView/CEF [S21][S22] |
| RPG Maker MZ | 79.99 美元 / 国区 ¥268 | MZ（2020） | 专用 JRPG 工具；历史低价约 ¥104 [S24][S25] |
| Ren'Py | ¥0 | 8.5.3 稳定（2026-05-15） | 开源可商用；内置 Steamworks [S26][S27] |
| Bevy | ¥0 | 0.19（2026-06-18） | 免费开源，Rust 生态 [S28] |
| MonoGame | ¥0 | 3.8.5（2026-07） | 开源；新增 DesktopVK / DX12 目标 [S29][S30] |
| LÖVE | ¥0 | 11.5 稳定，12.0 开发中 | Lua 框架，无编辑器 [S31] |
| GDevelop | ¥0 起 | 持续更新 | 开源；免费版桌面导出每天 1 次 [S34] |

三个容易踩的时效点：

1. **Unity 的“20 万美元”是年收入+融资的口径**，不是终身收入；超过后必须升级 Pro，而不是“超过才抽成” [S13]。
2. **Unreal 的 100 万美元是单款产品终身毛收入**，不是公司年收入；对本价位段实际永不触发 [S15]。
3. **GameMaker 正处于运行时换代期**：GMRT 的商业免费从 2027 年开始，但 GMRT 仍是 beta [S18][S19]；2026 年立项若等免费，等于把项目押在一个未稳定的运行时上。

### N4 · 出货能力：Steamworks、打包、Deck

| 引擎 | Steam 接入 | 桌面/Deck | 备注 |
|---|---|---|---|
| Godot | 社区 GodotSteam 4.23.2（GDExtension，SDK 1.65，成就→工坊）[S36] | 原生 Windows/Linux 导出；Linux 构建可直接跑 Deck | 无官方 Steamworks 绑定，但事实标准成熟 |
| Unity | Steamworks.NET（MIT，免费）[S37] | Windows → Proton；可出 Linux 构建 | 商业工具包可再包一层，但不是必需 |
| GameMaker | 官方 Steamworks 扩展 2.2.1（2026-04，Win/mac/Linux，成就/云/排行榜/Steam Input）[S38] | 官方桌面导出 | 2D 路径最短 |
| Unreal | 内置 Online Subsystem Steam，改 `DefaultEngine.ini` + 打包放 `steam_appid.txt` [S39] | Windows → Proton；可出 Linux | 配置项多，文档分散 |
| Ren'Py | 内置 Steamworks 1.62，支持 Steam Timeline [S27] | Win/mac/Linux/移动 [S26] | VN 的存档、回看、跳过、本地化都是现成的 |
| RPG Maker MZ | 社区插件（本次未核实） | Windows | 成就/云存档要自己补 |
| Construct 3 | 官方导出器内置 Steamworks 插件 [S23] | Win/mac/Linux/Deck | 从 NW.js 迁移的项目要重做打包 |
| Defold | 官方扩展/社区方案（本次未核实） | 官方 Steam 页称可一键部署 [S47] | 引擎小、启动快 |

Deck 的硬指标与引擎无关，是产品指标：默认手柄配置必须能完成全部内容、按键图标要匹配、文本输入要能呼出屏幕键盘、800p 下默认 30fps、不能弹兼容性警告 [S40]。没有原生 Linux 构建的 Windows 游戏走 Proton [S40]——Godot/Ren'Py/Defold 的原生 Linux 导出在这里是实打实的省事，Unity/Unreal 则需要额外验证 Proton 表现。这里说的“原生 Linux 构建”只指引擎具备 Linux 导出目标，具体运行表现仍要逐项目实测。

### N5 · 生态与“单人能不能做完”

- **采用率**：GDC 2026 调查里 42% 的从业者以 Unreal 为主引擎、Unity 30%，新兴独立工作室中 Godot 11% [S41]。但按**发行游戏数量**统计，2025 年 Unity 仍占 49.4%、Unreal 约 20%、Godot 7.1%（2020 年 0.9%），2025 年 GMTK Jam 有 39% 的作品用 Godot [S42]。两套数字不矛盾：大团队用 Unreal，小团队与 Game Jam 用 Unity/Godot。
- **中文资料**：Godot 已有成体系的中文深度教程（76 篇、约 21 万字，基线 4.7.2，2026-10 更新）[S43]；中文媒体也把 Godot 视为“Unity/Unreal 之外的第三种选择”，同时指出主机支持弱、国内招聘市场仍以 Unity/Unreal 为主 [S44]。
- **资产**：Unity 的 Asset Store 仍是最大；Godot 4.7 的官方 Asset Store 是补课，不是追平 [S12]。这个差距在“系统复杂、需要现成中间件”的项目上会变成实打实的时间。
- **能落地的证据**：GameMaker 有 Spelunky、DELTARUNE、UFO 50 [S45]；MonoGame 有星露谷物语、蔚蓝、怒之铁拳 4 [S30]；LÖVE 有小丑牌（单人开发、销量 500 万+）[S32][S33]；Godot 有《杀戮尖塔 2》（销量 300 万）、《土豆兄弟》《恶魔轮盘赌》《文字游戏》[S44]。
- **单人失败模式**（与引擎选择直接相关的三条）：① 选了一个“什么都能做”的引擎，结果把时间花在搭管线而不是做内容；② 做到一半换引擎，沉没成本把项目拖死；③ 选了一个生态薄弱的引擎，每个基础系统都要自己写，内容量被工具债吃掉。市场数据说明这三条比“引擎性能”更致命 [S5][S6][S7]。

### N6 · 类型 → 引擎

| 类型 | 首选 | 备选 | 理由 | 存在性证明 |
|---|---|---|---|---|
| 2D 动作/平台/弹幕 | **GameMaker** | Godot | 2D 手感与精灵工作流最成熟，官方 Steamworks 扩展齐全 | Spelunky、DELTARUNE、UFO 50 [S45] |
| 2D 肉鸽/卡牌/构筑 | **Godot** | Unity、LÖVE | 系统与 UI 用节点/场景组织，迭代快；LÖVE 适合纯 Lua 程序员 | 杀戮尖塔 2（Godot）[S44]；小丑牌（LÖVE）[S32] |
| 银河城/横版探索 | **Godot** | GameMaker | 场景复用、Tilemap、状态机都够用；美术管线简单 | 该类型作品多，但本次未逐款核实引擎 |
| 种田/生活模拟 | **Unity** | Godot、MonoGame | 大量现成系统与资产；C# 处理数据/存档更稳 | 星露谷物语（MonoGame）[S30] |
| 模拟经营/自动化 | **Godot** | Unity | 重逻辑、重 UI，GDScript/C# 迭代快；3D 需求低 | 本次未逐款核实 |
| 卡牌/策略/桌游 | **Godot** | Unity、LÖVE | UI 与数据驱动是主战场；LÖVE 的 2D 足够 | 小丑牌（LÖVE）[S32] |
| 解谜 | **Godot** | Unity | 关卡状态集中管理、场景即关卡，改起来轻 | 本次未逐款核实 |
| 恐怖/步行模拟 | **Unity** | Unreal、Godot | 后处理、资产、音效中间件最成熟；3D 门槛低 | 本次未逐款核实 |
| JRPG（回合制/剧情） | **RPG Maker MZ** | Godot、Unity | 数据库+事件系统直接覆盖 70% 的 JRPG 底座 | MZ 是 Steam 在售的完整 RPG 工具 [S24] |
| 视觉小说/文字冒险 | **Ren'Py** | Unity（Naninovel） | 存档/回看/跳过/本地化/Steam 成就全内置 | Ren'Py 官方定位即 VN，内置 Steamworks [S26][S27] |

“存在性证明”一栏刻意只写已核实引擎归属的作品；没核实的就写“未逐款核实”，不拿印象当证据。

## Comparison

评分针对“单人、首款或早期商业作品、10–30 元、6–12 个月”这一具体场景，1–5 分，**是本文判断，不是实测**。

权重：完成速度 30%、类型契合 20%、学习成本 15%、出货配套 15%、生态资产 10%、成本 5%、可控/移植 5%。

| 引擎 | 完成速度 | 类型契合 | 学习成本 | 出货配套 | 生态资产 | 成本 | 可控/移植 | 加权 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **Godot 4.7** | 5 | 5 | 4 | 4 | 4 | 5 | 5 | **4.60** |
| **GameMaker** | 5 | 4 | 5 | 4 | 4 | 4 | 3 | **4.40** |
| **Unity 6.3 LTS** | 3 | 4 | 3 | 5 | 5 | 4 | 3 | **3.75** |
| **Defold** | 4 | 4 | 4 | 3 | 2 | 5 | 4 | **3.70** |
| **Construct 3** | 4 | 3 | 5 | 3 | 3 | 2 | 1 | **3.45** |
| **LÖVE** | 3 | 3 | 3 | 2 | 3 | 5 | 5 | **3.05** |
| **MonoGame** | 2 | 3 | 2 | 2 | 3 | 5 | 5 | **2.60** |
| **Unreal 5.8** | 2 | 3（3D） | 1 | 3 | 4 | 4 | 3 | **2.55** |
| **Bevy 0.19** | 2 | 2 | 1 | 1 | 2 | 5 | 5 | **2.00** |

类型专用工具不放进同一张表，因为它们的“类型契合”是 5、其他类型是 1，平均分没有意义：**RPG Maker MZ 只在 JRPG 里赢，Ren'Py 只在 VN/文字冒险里赢**，而且在这两个类型里它们赢得非常彻底（数据库/事件系统、存档/回看/本地化都是现成的）。

## Analysis

这是解释，不是事实：

1. **引擎的“上限”在这个价位段几乎不被支付。** 10–30 元的游戏卖的是“一个明确、完整、2–10 小时的体验”，不是技术演示。Unreal 的 Nanite/Lumen、Unity 的 HDRP、Godot 的 3D 管线，只有在美术与内容能填满它们时才值钱；填不满时，它们只是更长的构建时间和更大的包体。
2. **“完成速度”由三件事决定**：编辑器迭代循环（改一行看一次结果要几秒）、内容管线（一张图/一段对话进游戏要几步）、以及基础系统是否现成（存档、设置、本地化、成就、手柄）。Godot 赢在前两项，Ren'Py/RPG Maker 赢在第三项，Unity 赢在“第三项的深度”（资产商店能买到成熟方案），GameMaker 赢在 2D 的第二项。
3. **授权风险是真实的，但不在这个收入区间爆发。** Unity 的 Runtime Fee 已经取消 [S13]，Unreal 的 5% 要 100 万美元才触发 [S15]；真正会在第一天收钱的是 GameMaker（99.99 美元）、RPG Maker（79.99 美元）、Construct（129.99 美元/年）。如果项目的中位预期是几百美元，**免费引擎的优势是“不会在失败时再割一刀”**；但如果你确信付费工具能省下两周，它仍然划算——两周的人力远高于 715 元。
4. **生态差距会以“工具债”的形式复利。** 选 Godot 意味着某些中间件要自己写或找替代；选 Unity 意味着你能买到，但也要承担包管理与版本升级的复杂度。对单人来说，**“能不能自己修”比“有没有现成的”更重要**，这解释了为什么开源引擎在小团队里份额上升 [S42]。
5. **换引擎是最大的隐性成本。** 市场数据说明大多数作品连 1,000 美元都到不了 [S5][S6]；在这种分布下，把 3 个月投入换引擎，几乎必然把项目从“可能完成”变成“完不成”。所以决策应该在前两周做完，之后不再回头。

## Confidence, gaps & disagreements

- **High confidence**：各引擎的授权条款与当前版本（均来自厂商一手页）；Steam 的费用/退款/Deck 规则（Valve 一手页）；Steam 市场的中位数区间（三家独立估算方向一致）；GodotSteam/Steamworks.NET/GameMaker Steamworks 扩展的存在与版本。
- **Single-source / tentative**：Steam 的 30% 基线（Valve 公开页只给分档，30% 来自媒体核对合同 [S2]）；Construct 3 的个人版价格（来自其编辑器页的结构化报价数据 [S21]）；RPG Maker MZ 的国区价格与历史低价（SteamPeaks 第三方追踪 [S25]）。
- **Contradicted**：GDC 的“主引擎”口径（Unreal 42% > Unity 30%）与 GameDiscoverCo 的“发行数量”口径（Unity 49.4% > Unreal ~20%）方向相反 [S41][S42]。两者样本不同：前者是 2,300+ 从业者的自报，后者是实际发行的 PC 游戏数量；**不要用 GDC 的数字推断“独立开发者该选什么”**。
- **Not established**：RPG Maker MZ、Defold、LÖVE、GDevelop、Bevy 的 Steam 成就/云存档接入细节没有逐项核实；Construct 3 的 Steam 打包在当前版本的实际体验没有实测；Godot 4.7 在 Windows 上的真实导出/崩溃率没有实测数据。
- **Not reproducible without a login**：Steam Distribution Agreement 原文、Steamworks 后台的成就/税率配置界面。
- **口径提醒**：所有收入数字都是“毛收入估算”，不含退款、税、地区定价与折扣；Steam 不公开逐款财务数据，第三方估算的误差可能很大。

## Recommendations

### 一句话

**默认 Godot 4.7；手感优先选 GameMaker；已有 C#/资产/主机需求选 Unity 6.3 LTS；JRPG 选 RPG Maker MZ；视觉小说选 Ren'Py；Unreal 只在你已经会它、且 3D 写实就是卖点时选。**

### 决策树

1. **你的核心交付物是文字/分支叙事？** → Ren'Py。别用通用引擎重造存档、回看、跳过、本地化。
2. **是回合制 JRPG、大量道具/技能/事件？** → RPG Maker MZ。它的数据库就是你的游戏骨架；先接受它的画面与系统上限。
3. **是 2D 手感型（跳跃、打击、弹幕、速通）？** → GameMaker（预算 99.99 美元，用 LTS 2026 / GMS2 运行时）；想零成本且长期可控 → Godot。
4. **是系统/数值/关卡型（经营、卡牌、解谜、自动化）？** → Godot；如果强依赖某个 Unity 资产/中间件 → Unity。
5. **是 3D 风格化/低多边形？** → Godot 或 Unity；**是写实/影视级？** → Unreal，但先把体量砍到“一个人能填满”。
6. **已有 3 年以上 Unity 经验？** → 留在 Unity。迁移成本大于引擎收益，这一条优先级高于上面所有。
7. **必须上 Switch/PS/Xbox？** → Unity/Unreal；Godot 需要 W4 Games 等第三方移植 [S35]。
8. **想做点击冒险？** → Adventure Game Studio 或 Unity（本次未核价，属长尾）。
9. **只是想最快看到“能玩的东西”、不写代码？** → Construct 3 / GDevelop；接受订阅、导出与性能上限。

### 两周试做协议（把“感觉”变成可比较的数字）

- **第 1 天**：在两个候选引擎里各做同一个垂直切片：移动 + 攻击 + 1 个敌人 + UI + 存档 + 导出 Windows。
- **第 2–3 天**：各加一个真实系统（背包/对话/关卡生成），记录每次“改完到看到结果”的秒数。
- **第 4–5 天**：接入 Steamworks 成就 + 云存档（用 Spacewar 480 测试），记录第一次成就弹窗的时间。
- **第 6–7 天**：打包含 20 张图、3 个音效、中英双语；用手柄测一遍 Deck 指标 [S40]。
- **第 8–10 天**：做 10 分钟真实内容，找 3 个人试玩，记录他们卡在哪。
- **第 11–14 天**：估算“1 小时内容需要几天”，乘以目标时长（10–30 元通常对应 2–8 小时）。
- **退出条件**：3 天内做不出手柄可玩的构建 → 换；每 1 小时内容超过 5 天 → 砍体量或换工具；超过 30% 的时间在跟引擎搏斗 → 换。**换引擎只允许发生在这两周内。**

### 推荐会在什么条件下翻转

- 你已经能熟练使用 Unity/Unreal → 不迁移，直接用现有能力把体量做小。
- 游戏的核心卖点是 3D 写实画面或大规模场景 → Unreal。
- 需要主机首发或已有主机合作 → Unity/Unreal。
- 团队从 1 人变成 3 人以上、且有程序 → Unity/Unreal 的管线与招聘优势开始压过 Godot。
- 你打算做的是“文字 + 轻模拟”而非纯 VN → Ren'Py 仍可（它有 Python），但 Godot/Unity 的 UI 更自由。
- 你愿意接受“先做小、再做大”的两部曲 → 第一部用 Godot/GameMaker 练完整个发行流程，第二部再按类型选专用工具。

## Sources

| ID | Source | Tier | Access | Retrieved |
|---|---|---|---|---|
| S1 | [New Revenue Share Tiers and other updates to the Steam Distribution Agreement — Steamworks](https://steamcommunity.com/groups/steamworks/announcements/detail/1697191267930157838) | T1 | public | 2026-11-02 |
| S2 | [Valve's new Steam revenue agreement gives more money to developers — The Verge](https://www.theverge.com/2018/11/30/18120577/valve-steam-game-marketplace-revenue-split-new-rules-competition) | T2 | public | 2026-11-02 |
| S3 | [Steam Direct Fee — Steamworks Documentation](https://partner.steamgames.com/doc/gettingstarted/appfee) | T1 | public | 2026-11-02 |
| S4 | [Steam Refunds — Valve](https://store.steampowered.com/steam_refunds/) | T1 | public | 2026-11-02 |
| S5 | [Steam Genre Benchmark — App2top](https://app2top.com/analytics/steam-genre-benchmark-inequality-index-oversaturated-niches-top-grossing-categories-anomalies-and-perennial-underdogs-295050.html) | T3 | public | 2026-11-02 |
| S6 | [The Indie-pocalypse is here? Steam Q1 2026 Data Analysis — Games-Stats](https://games-stats.com/blog/Steam_in_Q12026/) | T3 | public | 2026-11-02 |
| S7 | [How Much Do Indie Games Make on Steam? — grishakof（引用 GameDiscoverCo）](https://grishakof.com/blog/en/guides/how-much-do-indie-games-make-on-steam/) | T3 | public | 2026-11-02 |
| S8 | [Taxes FAQ — Steamworks Documentation](https://partner.steamgames.com/doc/finance/taxfaq) | T1 | public | 2026-11-02 |
| S9 | [Frequently asked questions — Godot Engine documentation](https://docs.godotengine.org/en/4.6/about/faq.html) | T1 | public | 2026-11-02 |
| S10 | [Download Godot 4.7 (stable) — Godot Engine](https://godotengine.org/download/archive/4.7-stable/) | T1 | public | 2026-11-02 |
| S11 | [Release support timeline — Godot Engine documentation](https://docs.godotengine.org/en/stable/about/release_policy.html) | T1 | public | 2026-11-02 |
| S12 | [Godot 4.7 Release — Godot Engine](https://godotengine.org/releases/4.7/) | T1 | public | 2026-11-02 |
| S13 | [Unity Pricing Changes — Unity](https://unity.com/products/pricing-updates) | T1 | public | 2026-11-02 |
| S14 | [Unity 6 Releases & Support — Unity](https://unity.com/releases/unity-6/support) | T1 | public | 2026-11-02 |
| S15 | [Unreal Engine licensing options — Epic Games](https://www.unrealengine.com/en-US/license) | T1 | public | 2026-11-02 |
| S16 | [Unreal Engine 5.8 is now available — Epic Games](https://www.unrealengine.com/news/unreal-engine-5-8-is-now-available) | T1 | public | 2026-11-02 |
| S17 | [Export Licences Pricing — GameMaker](https://gamemaker.io/en/get) | T1 | public | 2026-11-02 |
| S18 | [GMRT Update: Free for Commercial Use and Source Access — GameMaker](https://gamemaker.io/en/blog/gmrt-update) | T1 | public | 2026-11-02 |
| S19 | [GMRT (GameMaker Runtime) — GameMaker manual](https://manual.gamemaker.io/lts/en/Settings/Runner_Details/GMRT_(GameMaker_Runtime).htm) | T1 | public | 2026-11-02 |
| S20 | [Always free and developer-friendly — Defold](https://defold.com/open/) | T1 | public | 2026-11-02 |
| S21 | [Construct 3 plans — Scirra（页面结构化报价数据）](https://editor.construct.net/r26/) | T1 | public | 2026-11-02 |
| S22 | [Construct 3 r450 — Scirra](https://www.construct.net/en/make-games/releases/beta/r450) | T1 | public | 2026-11-02 |
| S23 | [Construct 3 r424 — Scirra](https://www.construct.net/en/make-games/releases/stable/r424) | T1 | public | 2026-11-02 |
| S24 | [RPG Maker MZ on Steam — Gotcha Gotcha Games](https://store.steampowered.com/app/1096900/RPG_Maker_MZ/) | T1 | public | 2026-11-02 |
| S25 | [RPG Maker MZ price history — SteamPeaks](https://steampeaks.com/app/1096900/rpg-maker-mz/price-history) | T2 | public | 2026-11-02 |
| S26 | [The Ren'Py Visual Novel Engine — Ren'Py](https://www.renpy.org/) | T1 | public | 2026-11-02 |
| S27 | [Changelog — Ren'Py documentation](https://www.renpy.org/doc/html/changelog.html) | T1 | public | 2026-11-02 |
| S28 | [Tags — bevyengine/bevy (GitHub)](https://github.com/bevyengine/bevy/tags) | T1 | public | 2026-11-02 |
| S29 | [3.8.5 Release — MonoGame](https://monogame.net/blog/2026-07-15-3.8.5-release-2026/) | T1 | public | 2026-11-02 |
| S30 | [MonoGame.Framework.DesktopGL — NuGet](https://www.nuget.org/packages/MonoGame.Framework.DesktopGL/3.8.4) | T2 | public | 2026-11-02 |
| S31 | [Version History — LÖVE](https://love2d.org/wiki/Version_History) | T1 | public | 2026-11-02 |
| S32 | [Balatro — Wikipedia](https://en.wikipedia.org/wiki/Balatro_(video_game)) | T2 | public | 2026-11-02 |
| S33 | [How an IT worker from Saskatchewan made the best game of the year — The Logic](https://thelogic.co/news/balatro-developer-interview/) | T2 | public | 2026-11-02 |
| S34 | [GDevelop Premium Plans — GDevelop](https://gdevelop.io/pricing) | T1 | public | 2026-11-02 |
| S35 | [Console support in Godot — Godot Engine](https://godotengine.org/consoles/) | T1 | public | 2026-11-02 |
| S36 | [GodotSteam GDExtension 4.4+ — Godot Asset Library](https://godotengine.org/asset-library/asset/2445) | T1 | public | 2026-11-02 |
| S37 | [Steamworks.NET — rlabrecque](https://steamworks.github.io/) | T1 | public | 2026-11-02 |
| S38 | [GMEXT-Steamworks v2.2.1 — YoYoGames (GitHub)](https://github.com/YoYoGames/GMEXT-Steamworks/releases/tag/2.2.1) | T1 | public | 2026-11-02 |
| S39 | [Setting Up Online Subsystem Steam in Unreal Engine — Epic Developer Community](https://forums.unrealengine.com/t/community-tutorial-setting-up-online-subsystem-steam-in-unreal-engine/2669433) | T3 | public | 2026-11-02 |
| S40 | [Steam Deck and Steam Machine Compatibility Review — Steamworks Documentation](https://partner.steamgames.com/doc/steamhardware/compat) | T1 | public | 2026-11-02 |
| S41 | [GDC 2026 State of the Game Industry — GDC](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/) | T1 | public | 2026-11-02 |
| S42 | [How's PC game engine usage changing? — GameDiscoverCo](https://newsletter.gamediscover.co/p/hows-pc-game-engine-usage-changing) | T2 | public | 2026-11-02 |
| S43 | [深入理解 Godot 引擎 — wangshucheng](https://wangshucheng.github.io/godot-engine-book/) | T4 | public | 2026-11-02 |
| S44 | [免费+开源的神仙引擎，能让独立游戏逃离剥削吗？ — 游民星空](https://www.gamersky.com/news/202603/2115214.shtml) | T3 | public | 2026-11-02 |
| S45 | [GameMaker development engine free for commercial use — Opera Newsroom](https://press.opera.com/2026/10/23/gamemaker-unlocks-access-to-its-acclaimed-game-development-engine-for-more-developers/) | T1 | public | 2026-11-02 |
| S46 | [Balatro Made with Love… Love2D That is — GameFromScratch](https://gamefromscratch.com/balatro-made-with-love-love2d-that-is/) | T3 | public | 2026-11-02 |
| S47 | [Defold on Steam — Defold Foundation](https://store.steampowered.com/app/1365760/Defold/) | T1 | public | 2026-11-02 |
