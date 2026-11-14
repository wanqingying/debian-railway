# AI 辅助美术，能撑起一款 10–30 元的 Steam 单机游戏吗

**Question:** 单人制作中小体量单机游戏，美术能否由 AI 辅助完成？边界、成本与风险是什么？
**Date:** 2026-11-02  **Depth:** quick
**Sources:** 18 · **Citation accuracy:** 100% (23/23) · **Cutoff:** 2026-11-02

**适用范围：** Steam 国际版（Valve，美国）的规则、美国版权法，以及欧盟 AI Act 对“使用 AI 系统的人”（deployer）的透明度义务。不涉及中国境内平台规则——上一版把《标识办法》写进来，是我自己假设了“会在中国发行”，本轮已删除。

## TL;DR

- **能，但要换分工。** AI 负责“量”（图标、卡牌、立绘初稿、背景、UI 素材），人负责“一致性、手感、最后 30% 的修”。全交给 AI 的作品，问题通常不在“一眼假”，而在风格不统一、精灵表对不齐、封面没有记忆点。
- **规则上完全可行。** Steam 允许 AI 美术，只要在 Content Survey 里披露“随游戏发布的预生成内容”；2026 年 1 月起，AI 编程助手这类工作流工具不再需要披露 [S1][S2]。
- **版权上有一个真坑。** 纯 AI 生成、只靠提示词得到的图，在美国不受版权保护；你能主张的是自己对输出的选择、编排与修改 [S10]。这意味着别人抄你的 AI 立绘，你很难用版权维权。
- **欧盟不额外要求你给每张图打标。** 第 50(2) 的机器可读标记义务落在 AI 服务提供者（Midjourney、Adobe）身上，不是游戏开发者；第 50(4) 只针对 deepfake，且艺术/虚构作品只需以不干扰体验的方式披露 [S14][S15][S16]。
- **市场代价存在，但不等于死刑。** 披露 AI 的游戏平均好评率 77%，未披露 81%；20 美元以上差距拉大到 73% 对 81% [S5]。10–30 元处在低价段，价格惩罚较弱；决定评价的仍是“好不好玩”和“看起来投没投入”。
- **最危险的不是披露，是被怀疑。** 有游戏没用 AI 却被单条评测指为“AI slop”，开发者只能公开否认，平台没有核验机制 [S7]。反过来，全部美术由 AI 制作、如实披露的《Tasty Chef》拿到 92% 好评 [S5]。

## Findings

### A1 · Steam 要你披露什么

Valve 的 Content Survey 把生成式 AI 分成两类 [S1]：

| 类别 | 定义 | 你要做什么 |
|---|---|---|
| **预生成（Pre-Generated）** | 开发期用 AI 做、随游戏发布、玩家会看到/听到的内容：美术、声音、叙事、本地化、商店页与营销素材 | 在调查里写清楚用了什么、用在哪；商店页会出现 “AI Generated Content Disclosure” 区块 [S3] |
| **实时生成（Live-Generated）** | 游戏运行时才生成的内容 | 除上述外，还要说明护栏（防违法内容），并提供玩家在游戏内举报的通道 [S3] |

两个容易误解的点：

1. **“效率工具”不算。** Valve 原文说得很直白：开发环境内置 AI 带来的效率提升“不是本节关注点”，关注的是玩家最终消费的内容 [S1]。2026 年 1 月的改版进一步明确：AI 编程助手不需要披露，但进入游戏或营销素材的 AI 内容要披露 [S2]。
2. **封面图、胶囊图、预告片也算。** 只要 AI 生成的内容出现在商店页或营销材料里，就在披露范围内 [S2]。封面是转化率最高的资产，这一条不能漏。

规模上，这已经不是边缘做法：2025 年上半年有近 8,000 款 Steam 新作披露使用生成式 AI，而 2024 年全年约 1,000 款 [S4]；到 2026 年中，约三分之一的新作带披露 [S5]。

### A2 · 版权、商用授权与欧盟规则

**坑一：纯 AI 图不受版权保护。** 美国版权局 2025 年的结论是：完全由 AI 生成的材料不受保护；仅提供提示词不构成作者身份；但人类对输出的选择、编排、修改可以形成可保护的表达 [S10]。D.C. 巡回法院 2025 年 3 月也维持了对纯 AI 生成图片登记的拒绝 [S11]。

对单人开发者的实际影响：

- 你的**游戏整体**（代码、关卡设计、文本、整体编排）仍然受版权保护；
- 但**单张 AI 立绘/图标**很难主张版权，别人拿去用，你缺少有效的维权工具；
- 如果你做过大幅修改、分层合成、手绘叠加，保留 PSD/工程文件，版权登记时可以主张“人类作者部分”。

**坑二：工具条款决定你能不能商用。**

| 工具 | 商用条款 | 要注意 |
|---|---|---|
| Adobe Firefly | 模型在授权内容 + 公有领域上训练，输出归客户；商用可用 [S12] | IP 赔偿只覆盖符合条件的团队/企业套餐，个人订阅不自动带 |
| Midjourney | 付费会员在“法律允许的最大范围”内拥有资产 [S13] | **免费/未付费账号的输出是 CC BY-NC（非商用）**；年收入 >100 万美元需 Pro/Mega；默认公开可 remix |
| 本地 Stable Diffusion / ComfyUI | 输出一般不受工具条款限制 | 模型与 LoRA 的许可要逐个看；训练数据版权风险由你承担 |

“免费号生成、后来订阅了”不等于获得商用权——授权看的是生成当时的账号状态。

**欧盟：标记义务在服务商，不在你。** AI Act 第 50 条从 2026-08-02 起适用。第 50(2) 要求“生成合成内容的 AI 系统提供者”给输出加机器可读标记并可被检测 [S14]——这是 Midjourney/Adobe 的义务。委员会 2026 年 7 月的指引进一步写明：仅在游戏、动画、影视等生产流程闭环中使用、且不是 AI 系统最终输出的内容，不在第 50(2) 标记范围内 [S15]。第 50(4) 的披露义务针对 **deepfake**，而且当内容属于明显的艺术、创作、虚构作品时，只需以不干扰作品展示的方式披露“存在 AI 生成内容” [S16]。

所以：**在 Steam 上卖一款含 AI 美术的游戏，欧盟没有给你新增“逐张打标”的义务**；真正约束你的是 Steam 的披露要求，以及版权/合同。唯一要提高警惕的是拿真人做 deepfake（肖像、配音），那会触发第 50(4)。

### A3 · 哪些美术 AI 现在能交付

这是一张**工作流判断表**，不是实测基准：

| 资产类型 | AI 可交付度 | 现实做法 |
|---|---|---|
| 概念图、情绪板、参考图 | 高 | 直接用于立项与对齐风格 |
| 2D 立绘、头像、卡牌插画 | 高 | AI 出 3–5 版 → 人选 → 修手/修脸/统一光 |
| UI 图标、边框、材质、花纹 | 高 | 批量生成 + 统一色板 + 手动切图 |
| 手绘风场景背景、视差层 | 中高 | 分图层生成，注意透视与可玩区域 |
| 像素精灵（静帧） | 中 | 需要固定网格、限色、手动清像素 |
| 像素动画 / 精灵表 | 中低 | 枢轴、脚底基线、循环连续性都要后处理 |
| Tilemap 瓦片（无缝） | 中低 | 接缝与转角最容易穿帮，通常要手绘补 |
| 3D 模型 | 中 | 生成的是“造型”，拓扑/UV/绑定仍要重做 |
| PBR 纹理 | 中 | 可做基础层，细节靠 Substance/手绘 |
| 角色骨骼动画、手 K 关键帧 | 低 | 目前仍是人工为主 |
| 字体、Logo | 低 | 侵权与商标风险高，建议买商用字体/请人设计 |

这张表的分界线很清楚：**“单张、静态、可后期”的资产 AI 已经够用；“连续、对齐、要进引擎”的资产仍需要人。** 现有的 AI 精灵管线（如 Ludo、SpriteCanvas）本身就把“共享单元格、枢轴、循环检查”当成卖点 [S17][S18]——这恰恰说明原始生成结果不是引擎可用资产，中间必须有一道工程处理。

### A4 · 披露的真实代价

先把数据摆齐，因为它们互相矛盾：

| 来源 | 样本 | 结论 |
|---|---|---|
| Sulka Haro 统计（经 IndieTooling 转述） | 53,597 款 Steam 新作 | 披露组平均 77% 好评 vs 81%；20 美元以上 73% vs 81% [S5] |
| Game Oracle / AISEEBIZ（经中文媒体转述） | 9,879 款 2025 年新作 | 披露组首月评测中位数 4 条 vs 7 条（约 -53%）；但校正经验变量后，缺经验的小团队几乎无额外影响 [S9] |
| 《Tasty Chef》 | 513 条评测 | 全部美术+音乐由 AI 制作并披露，92% 好评；销量估计 1.09 万–2.5 万份 [S5] |
| 《HEXSTORM》 | 首周约 1,200 份 | AI 写代码引发抵制，数小时跌到 55%，补丁+降价后回到 74% [S6] |
| “零 AI”重制案例 | 单人自述 | 首月不到 300 份；改为零 AI 后月销约 2,000 份（约 5 倍）[S8] |

怎么读这些数字：

1. **平均惩罚是真的，但幅度不大**（77% vs 81%），而且**在低价段更小**。你卖 10–30 元，正好避开了 20 美元以上差距最大的区间。
2. **“-53% 评测数”是这条链里最弱的数字**：它是二手转述，且原文自己也说校正经验变量后小团队几乎没有额外影响 [S9]。不要用它做决策，但可以把它当成“别把 AI 当卖点”的提醒。
3. **两个成功案例的共同点不是“AI 用得好”，而是“游戏本身站得住”**。《Tasty Chef》的评测里，不少好评也说 AI 美术是它最弱的部分，但仍然推荐，因为做菜循环好玩 [S5]。
4. **反例也有混淆变量**：《HEXSTORM》同时被批评难度高、定价高、完成度不足 [S6]，不能把 55% 全算在 AI 头上。
5. **最防不胜防的是误伤**：一款没用 AI 的游戏被指“AI slop”，开发者只能自证，平台没有核验机制 [S7]。这意味着“零 AI”不是护身符，“像 AI”才是风险。

## Recommendations

### 一句话

**用 AI 做“量”和“草稿”，把“一致性、封面、角色脸”留给人；如实披露；不要拿 AI 当卖点。**

### 按预算的三条路线

**A. 0 元路线（有时间、有显卡）**
本地 ComfyUI / Stable Diffusion + 固定角色 LoRA + ControlNet；Aseprite 手修像素；Krita/Photopea 做分层。优点是无限试错、风格可控；缺点是要花 1–2 周搭管线，且模型/LoRA 的商用许可要逐个确认。

**B. 订阅路线（约 ¥100–300/月）**
Midjourney（付费号）或 Firefly 出概念、卡牌、背景；Ludo/SpriteCanvas 出精灵初稿；人做统一色板、修脸、切图。适合“美术是短板、但不想学管线”的人。

**C. 混合路线（推荐给 10–30 元产品）**
- 封面/胶囊图 + 主角立绘：**外包或请画师深度修改**（这是玩家第一眼看到的东西，最值钱）；
- 量产物件（图标、卡牌、道具、背景变体）：AI 批量生成 + 你统一风格；
- 动画与精灵表：AI 出静帧，人做逐帧修正。

一款 2–8 小时的 2D 小游戏，量产物件通常在几百个量级；AI 能把“画”的时间压掉一半以上，但“选、修、对齐、统一”仍要占美术工时的大头。

### 上线前检查清单

1. **记录来源**：每个 AI 资产的工具、账号、提示词、生成日期，留一份表——审核问起、玩家质疑、版权登记都用得上。
2. **只用商用条款明确的工具**：Midjourney 免费号不能用；Firefly 个人版可用但无赔偿；本地模型的许可逐个看。
3. **不提示在世艺术家名字、不提示他人 IP**（角色、Logo、知名画风），这是侵权投诉的高发点。
4. **商店页披露写人话**：例如“角色立绘与图标由生成式 AI 起草，经人工修改与统一”；不要只写“使用了 AI”。
5. **封面单独把关**：AI 生成的胶囊图最容易“一眼 AI”，宁可多花几百块请人重绘。
6. **精灵表验三件事**：枢轴一致、脚底不滑、循环首尾不断；瓦片验接缝与转角。
7. **保留分层文件**：PSD/工程文件是你主张“人类修改”的证据。

### 什么情况下不要用 AI 美术

- 美术本身就是卖点（手绘风、独特画风、角色驱动）：玩家会拿放大镜看，AI 的“平均脸”直接劝退。
- 你要靠美术做差异化营销（封面、PV、Steam 页面视觉）：这是最不该省的地方。
- 你没有能力做后期：AI 出图不等于成品，修图能力决定最终质量；不会修就不要全交给 AI。

## Confidence, gaps & disagreements

- **High confidence**：Steam 的披露分类与 2026 年 1 月口径（Valve 一手页 + 两家媒体）；美国版权局的结论（一手报告）；Adobe/Midjourney 的商用条款（一手文档）；欧盟 AI Act 第 50 条的适用时间与主体划分（委员会一手指引）。
- **Medium**：Sulka Haro 的 53,597 款统计（经二手转述，原始报告未直接读取）；《Tasty Chef》《HEXSTORM》的销量估计（第三方估算，口径不一）。
- **Low / 仅作参考**：Game Oracle 的“-53% 评测数”（二手转述且被原作者限定）；“零 AI 销量翻 5 倍”（单人自述，无法验证）。
- **Not established**：AI 美术对本价位段（¥10–30）的单独影响没有直接数据；我们是从“20 美元以上差距更大”反推低价段更轻，这是推断，不是测量。
- **判断而非事实**：A3 的资产可交付度表是工作流经验，不是 benchmark；3D 模型与纹理的判断尤其保守。
- **欧盟条款的边界**：第 50 条针对“AI 系统提供者/部署者”，游戏本身通常不是 AI 系统；如果你在游戏里内嵌实时生成（Live-Generated）并把它作为功能卖点，就要重新评估第 50 条的适用性。

## Sources

| ID | Source | Tier | Access | Retrieved |
|---|---|---|---|---|
| S1 | [Content Survey — Steamworks Documentation](https://partner.steamgames.com/doc/gettingstarted/contentsurvey) | T1 | public | 2026-11-02 |
| S2 | [Valve tweaks and clarifies AI disclosure rules for Steam — Game Developer](https://www.gamedeveloper.com/business/valve-tweaks-and-clarifies-ai-disclosure-rules-for-steam) | T2 | public | 2026-11-02 |
| S3 | [Steam AI Disclosure: What 465 Pages Actually Say — SteamPageAnalyzer](https://www.steampageanalyzer.com/blog/steam-ai-disclosure-what-developers-wrote) | T3 | public | 2026-11-02 |
| S4 | [Valve has 'significantly' rewritten Steam's rules — VGC](https://www.videogameschronicle.com/news/valve-has-significantly-rewritten-steams-rules-for-how-developers-much-disclose-ai-use/) | T2 | public | 2026-11-02 |
| S5 | [Tasty Chef says AI made all its art — IndieTooling](https://indietooling.com/posts/tasty-chef-ai-art-disclosure) | T3 | public | 2026-11-02 |
| S6 | [$9,500 a week — HEXSTORM — App2top](https://app2top.com/news/9-500-a-week-a-solo-developer-shared-about-the-launch-of-the-game-with-ai-code-hexstorm-tears-of-arcadia-296068.html) | T3 | public | 2026-11-02 |
| S7 | [Steam's AI dilemma manifests in How To Grow a Black Hole — Regen Raygun](https://www.regenraygun.com/steams-ai-dilemma-manifests-in-how-to-grow-a-black-hole/) | T3 | public | 2026-11-02 |
| S8 | [打上“零AI”，销量翻5倍 — 36氪](https://www.36kr.com/p/3844127150819841) | T4 | public | 2026-11-02 |
| S9 | [单人+AI，5000块做出94%好评的Steam游戏 — 什么值得买](https://post.smzdm.com/p/anvx48w7/) | T4 | public | 2026-11-02 |
| S10 | [Copyright and AI, Part 2: Copyrightability — U.S. Copyright Office](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf) | T1 | public | 2026-11-02 |
| S11 | [U.S. Copyright Office Annual Report FY 2025](https://copyright.gov/reports/annual/2025/ar2025.pdf) | T1 | public | 2026-11-02 |
| S12 | [Firefly Legal FAQs – Enterprise Customers — Adobe](https://www.adobe.com/cc-shared/assets/pdf/enterprise/firefly-legal-faqs-enterprise-customers-2024-06-11.pdf) | T1 | public | 2026-11-02 |
| S13 | [Using Images & Videos Commercially — Midjourney](https://docs.midjourney.com/hc/en-us/articles/27870375276557-Using-Images-Videos-Commercially) | T1 | public | 2026-11-02 |
| S14 | [Transparency obligations under Article 50 — European Commission](https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act) | T1 | public | 2026-11-02 |
| S15 | [Guidelines on Article 50 transparency obligations — European Commission](https://ai-act-service-desk.ec.europa.eu/sites/default/files/2026-07/guidelines_on_the_implementation_of_the_transparency_obligations_for_certain_ai_systems_under_article_50_of_the_ai_act_bzptwqhk0ikg1dtlddap41psfy_131215.pdf) | T1 | public | 2026-11-02 |
| S16 | [Article 50: Transparency obligations — AI Act Service Desk](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) | T1 | public | 2026-11-02 |
| S17 | [AI Sprite Sheet Generator — SpriteCanvas](https://spritecanvas.com/) | T3 | public | 2026-11-02 |
| S18 | [Sprite Generator — Ludo.ai Docs](https://ludo.ai/docs/sprite-generator) | T2 | public | 2026-11-02 |
