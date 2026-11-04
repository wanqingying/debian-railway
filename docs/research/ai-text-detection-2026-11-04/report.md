# 怎么用技术手段判断一篇帖子/文章是不是 AI 写的

**Question：** 面对一篇具体的帖子或文章，能用哪些**技术手段**判定它是否由 AI 生成；各自在真实数据上的准确率、误报代价、失效边界是什么；一个人或一个小团队应该按什么顺序调用它们，最后能给出多强的结论。
**Date：** 2026-11-04  **Depth：** standard
**Sources：** 50（23 T1） · **Claims：** 55（42 load-bearing） · **Citation accuracy：** 100%（42/42 逐字复核） · **Cutoff：** 时间窗 ≥2025-01-01，9 条更早的方法学原始文献逐条标注了不过期的理由

## TL;DR

- **唯一能自动跑、且在当前文本上真有效的，是「训练型检测器 + 按目标误报率标定」。** 2026 年 7 月独立测试：495 段真人文本上 Pangram 与 GPTZero 误报 0 段，直白提示生成的 AI 文本漏报 ≤0.7% [S7]；但同一批工具去判「模仿某位作者风格」的文本时，漏报跳到 10.1%／10.8%／17.8%，模仿科学写作时 24–29% 漏报 [S7]。
- **「99% 准确率」是不能迁移的宣传数字。** 固定 5% 误报率的 RAID 协议下，榜首也只有 86.4%，Pangram 系 85.0、Binoculars 79.6、GPTZero 66.5、GLTR 62.6 [S5]；同一份 4000 词论文数据集上 Pangram 97.5%，而 Turnitin／Copyleaks／GPTZero 对纯 AI 论文的检出率是 **0%** [S8]。
- **帖子这类短文本是最难的场景，不是最容易的。** 分块打分方法在 <100 词时方差大到不可用 [S42]；OpenAI 自家水印在 1% 误报率下 200 token 只有约 80% 检出，替换 25% 同义词后掉到 17% [S37]。
- **中文走两条路：云 API 或自建。** 阿里云内容安全直接把「AI 生成文本鉴别」做成 `text_aigc_detector` 服务 [S47]；自建路线里编码器模型跨分布会掉到 76–79%，LoRA 微调的 Qwen2.5-7B 在同分布下 95.94% [S26]。国内还有一条别人没有的线索：GB 45438—2025 强制在**文件元数据**里写 `{"AIGC":{"Label":"1|2|3",…}}` [S45]——但纯文本帖子没有文件元数据可查。
- **水印/凭证是「有则定性、无则无信息」。** SynthID-Text 已在 Gemini 生产环境落地（2000 万条响应对照，质量无差异）[S4]，Anthropic 与 OpenAI 跟进；但三家对**文本**的检测器都只对审核过的机构开放，Google 对公众开放的 SynthID Detector 只收图像/视频/音频 [S38][S34]。
- **最大的不确定性写在最前面：** 改写是这类检测器的结构性弱点——DIPPER 把 DetectGPT 从 70.3% 打到 4.6%（固定 1% 误报率）[S14]，5 轮递归改写把水印 TPR 从 99% 打到 15% [S13]。所以技术上**不存在**「确凿判定」，只有「概率 + 误报预算」。

## Method

- 调研节点：N1 技术路线 → N2 商用 API 与实测 → N3 可自建开源 → N4 中文与强制标识 → N5 失效边界 → N6 水印与凭证 → N7 流程（无新事实）。
- 来源分层与通道：论文/标准原文（arXiv、ACL Anthology、Nature、gov.cn、TC260、国标 PDF）走 HTTP + `pdftotext`；JS 渲染与反爬页面（Nature 正文、阿里云帮助中心）走容器内可见 Chromium 的 `browse.mjs`；定价页走 HTTP。全日志 54 条公开、1 条需渲染。
- 校验方式：每条 load-bearing 声明重新抓 URL，按 n-gram 逐字比对引文（`verify.mjs`，同目录），42/42 命中；5 条因 LaTeX/MathJax 重复数字、PDF 把单词拆成单字而由人工 `grep` 复核并写明原因。
- 不可得：OpenAI 2023 分类器原文（openai.com 返回 403，改用二手汇总并降权到 T4 且不 load-bearing）[S11]；ScienceDirect 上的德国讲师研究被机器人验证拦截，改用 PMC 上可复核的同类研究 [S18]。
- 预算：约 50 分钟、55 条声明。N5 只保留 2 条「人能不能看出来」的量化证据作背景，其余 10 条标为非 load-bearing——用户明确要的是技术手段。

## Findings

### N1 · 技术路线：四类信号，能力差别在「能不能被改写打掉」

1. **统计/零样本指标**——不改模型、不需要训练数据，用一个（或两个）语言模型给文本打「它有多可预测」。DetectGPT 用扰动前后的对数概率差，Fast-DetectGPT 换成条件概率曲率（更快）[S41]；Binoculars 用两个相近模型困惑度的比值，在 0.01% 误报率下检出 >90% 的 ChatGPT 文本，且没在 ChatGPT 数据上训练过 [S2]。优点是跨模型泛化，缺点是对改写几乎无抵抗力 [S14]。
2. **训练型分类器**——在「人 vs 机器」标注集上训一个判别器（RoBERTa 系、商用黑盒）。同分布能逼近 100%，跨分布崩塌；同分布高分靠的常常是数据集伪影，而不是「AI 感」[S26]。
3. **水印**——只改采样过程（tournament sampling / g-function），不改训练、不加可见字符，检测时不需要原模型 [S4]。SynthID-Text 在 Gemini 上跑了约 2000 万条带/不带水印响应的对照实验，点赞率差 0.01%、点踩率差 0.02%，均不显著 [S4]。
4. **来源凭证/元数据**——C2PA 清单用私钥签名，验证器能确认「谁签的、字节有没有被改」，规范明说**不判断内容真假** [S28][S29]；国内对应的是国标规定的 `AIGC` 元数据字段 [S45]。

一个正在成型的新方向是「可审计检测」：2026-10 的 RAID 榜首是稀疏自编码器方案 BASE-SAE（86.4），卖点是能给出为什么判 AI 的结构化解释，而不只是一个分数 [S5]。

### N2 · 商用/API 的真实数字：排序会随数据集翻转

先看同一协议下的横向数字（RAID，1.1 万条人类文本 + 600 万条 AI 生成，固定 5% 误报率）[S3][S5]：

| 工具 | TPR@FPR=5%（RAID） | 备注 |
|---|---|---|
| BASE-SAE（开源研究） | 86.4 | 可解释特征 |
| Originality.ai | 85.0 | 商用 |
| Binoculars（开源） | 79.6 | 零样本指标型 |
| Fast-DetectGPT（开源） | 73.6 | 零样本指标型 |
| Winston AI | 71.0 | 商用 |
| GPTZero | 66.5 | 商用 |
| GLTR | 62.6 | 统计可视化 |

换一组 2026 年的独立评测，排序立刻变：

| 测试 | 数据集 | 结论 |
|---|---|---|
| Epoch AI 2026-07 [S7] | 495 段真人文本 + 297 段直白提示 AI + 297 段风格模仿 AI | 误报：Pangram 0、GPTZero 0、Originality 3.8%；直白提示漏报 ≤0.7%；**风格模仿漏报 10.1%/10.8%/17.8%** |
| VUB/IJEI 2026（160 篇 4000+ 词论文）[S8] | 纯 AI / 人机混合 / 人性化 AI | 纯 AI：Pangram 97.5%，Turnitin、Copyleaks、GPTZero 全 0%；人性化后 Pangram 仍 95% |
| 芝加哥 BFI [S6] | 1992 段人 + 1992 段 AI，六种文体 | Pangram 误报/漏报≈0；GPTZero 误报 0.7%、漏报 6%；开源 RoBERTa 误报 30–78%，不可用 |
| Graphite 产业测试 [S9] | 15.7k 篇 2020–2022 真人文章 + 2k×3 模型生成 | 误报 1.36–1.84%；漏报平均 0.07–1.97%，Gemini 上最高 3.5–4.9% |

**唯一的硬结论：开源 RoBERTa 系检测器不能用于任何有后果的场景**（误报 30–78%，`RAID` 里 GLTR 在默认阈值下误报 100%）[S6][S3]；闭源商用工具在默认阈值下误报基本都压到 1.7% 以下，因为它们是**按误报预算标定过**的 [S3]。

厂商数字不能作为选型依据：GPTZero 官方博客称在同一份 Chicago Booth 队列上召回 99.3%、Pangram 98.9% [S10]，而第三方复现里 GPTZero 在纯 AI 论文上是 0% [S8]。两者都真——差在数据集与阈值。

价格（归一化到千词，2026-10 抓取）[S49][S50]：

| API | $/千词 | 计费单位 | 1 万篇 ×500 词的成本（本报告换算） |
|---|---|---|---|
| Copyleaks | 0.027 | 250 词/点 | ≈$135 |
| Sapling | 0.03 | 千字符 | ≈$150 |
| Pangram 3 | 0.05 | 千词 | ≈$250 |
| Winston | 0.09 | 1 点/词 | ≈$450 |
| Originality | 0.119 | 100 词/点 | ≈$595 |
| GPTZero | ~0.15 | 词 | ≈$750 |
| Pangram 4 | 0.50 | 千词 | ≈$2500 |

计费单位不统一（词 / 100 词 / 250 词 / 千字符），跨厂商比价必须先换算成同一单位，否则结论会差一个数量级 [S49]。

### N3 · 能自己部署的：三条路线与它们的真实约束

| 方案 | 算法 | 显存/模型 | 关键约束 |
|---|---|---|---|
| Binoculars [S2][S39] | 双模型困惑度比 | 原生需同时驻留两个 7B ≈28GB；4-bit + 顺序加载 ≈7.8GB [S40] | 阈值是**用 Falcon-7B 对固定**的全局值，换模型必须重标定；作者明说英文最好、仅学术用途 [S39] |
| Fast-DetectGPT / IsItAI [S41][S42] | 条件概率曲率 | 3B–8B 打分模型，6–12GB [S43] | 作者 2026 年实测 Llama3-8B 明显优于 falcon-7b [S41]；IsItAI 支持自带数据校准、按句分块聚合 [S42] |
| RoBERTa 分类器 | 监督分类 | 1.2–2.5GB，1k token ≈18ms（A10G）[S43] | 快、便宜，但跨分布严重过拟合，误报高 [S26][S6] |
| Greyscope [S42] | 4B 模型，连续 `ai_involvement` | bf16 8.4GB / int4 3.5GB | 支持英/日/繁体中文，输出「人 / AI 编辑 / AI 生成」三态而非二分类 |

工程上必须自己做的两件事：

1. **重标定阈值。** Binoculars 的默认阈值不适用于你的领域与模型；商用工具也一样——`RAID` 里同一批开源检测器在「看起来合理」的默认阈值下误报可达 100%，闭源工具因为标定过才低 [S3][S7]。
2. **分块 + 聚合。** 长文按句/窗口切块分别打分再加权（Binoculars 分支用 384 token 窗口 + 长度加权 [S40]），才能定位「哪几段是 AI」。反过来，**短文本没有足够 chunk，分数方差大**，IsItAI 直接把 <100 词列为不可靠 [S42]。

### N4 · 中文与国内：一条云 API + 一套强制标识 + 一批学术模型

- **云 API：** 阿里云内容安全把「AI 生成文本鉴别」做成 `text_aigc_detector`（走 `TextModerationPlus`），与图片/语音/视频鉴别并列，用于「文本是否疑似由 AI 生成合成」[S47]。
- **强制标识（这条是中文内容独有的可技术验证点）：** 《人工智能生成合成内容标识办法》2025-09-01 施行，要求传播平台**核验文件元数据里的隐式标识**；没核验到但检测出显式标识或其他生成合成痕迹的，按「疑似」标注 [S44]。配套强制国标 GB 45438—2025 规定了字段格式：元数据里含 `AIGC` 的扩展字段，值为 JSON，`Label` 取 1/2/3 分别表示「属于/可能/疑似」，另含 `ContentProducer`、`ProduceID`、`ContentPropagator`、`PropagateID` 等 [S45]：

```json
{"AIGC": {"Label":"1","ContentProducer":"…","ProduceID":"…","ReservedCode1":"…",
          "ContentPropagator":"…","PropagateID":"…","ReservedCode2":"…"}}
```

  实务含义：**图片/音视频文件**可以查元数据；**纯文本帖子**没有文件头可查，只能依赖平台侧检测或作者主动声明。TC260 的配套实践指南给了检测框架（方案设计 → 预处理 → 检测实施 → 结果输出），并明确要求「多算法交叉检测」：多种算法独立分析再交叉验证 [S46]。
- **学术模型：** MLSDET 用 Qwen / Wenzhong-GPT2 / LLaMA 多模型的 log-rank、熵、对数似然与跨模型交叉熵做集成，在 HC3-Chinese 上比零样本 CLTR 的 F1 高 15.94% [S48]；编码器（RoBERTa-wwm / BERT）同分布接近记住训练集，跨分布掉到 76.3%／79.3%，LoRA 微调的 Qwen2.5-7B 在同分布测试集 95.94% [S26]。人民网「天目」自称对国内外主流大模型的中文文本识别率 93%，切入点是困惑度与词频 [S27]（机构自述，无独立复现）。
- **中文的额外难点：** C-HAT-Bench（5000 篇人类原文 → 24 万变体）显示，一旦是「人机协作」（续写、改写、内容填充），文档级检测器平均 AUROC 相对纯 AI 生成下降 12.0%，单模型最大降幅 44.4% [S15]。中文没有词边界，检测线索对分词敏感，跨生产模式几乎不能迁移 [S15]。

### N5 · 失效边界：四类，每一类都有数字

1. **改写攻击是结构性的。** DIPPER（11B 段落级改写）把 DetectGPT 在 1% 误报率下的检出率从 70.3% 打到 4.6%，语义几乎不变 [S14]；5 轮递归改写把水印 TPR 从 99% 打到 15% [S13]，零样本检测器 AUROC 从 96.5% 掉到 25.2% [S13]。Sadasivan 等人进一步给出不可能性结论：当模型足够像人，最优检测器也只能略优于随机 [S13]。防御是有的——模型侧保存全部输出做**检索比对**，可检出 80–97% 被改写的生成文本、只误判 1% 人类文本 [S14]——但这只有模型提供方做得到，外部使用者拿不到。
2. **误报率偏差是有方向性的：罚「语言简单」。** 7 个流行检测器判 91 篇中国学生 TOEFL 作文，平均误报 **61.22%**，97.8% 的作文至少被一个检测器判成 AI；同一批检测器判美国八年级母语作文近乎全对 [S12]。机制是困惑度：用 ChatGPT 给这些作文「提升用词」后误报从 61.22% 降到 11.77%；反过来把母语作文「简化用词」后误报从 5.19% 升到 56.65% [S12]。这条对中文写作者尤其致命——非母语、术语密集、句式规整的文本天然低困惑度。
3. **校准与解码参数会改变结论。** 加一个 repetition penalty 就让检测准确率最多掉 32 个百分点，与解码策略无关 [S3]；换未见过的生成模型同样掉 [S3]。
4. **短文本、混合文本、模仿风格：** <100 词分块方法不可靠 [S42]；人机混合让 AUROC 平均掉 12% [S15]；模仿特定作者风格让商用工具漏报 10–18%，模仿科学写作时 25–29% [S7]。

背景（非技术手段，只说明为什么不能退回肉眼）：普通人判 500 篇文本约 59% [S16]，无反馈条件下 55.4% [S17]，受训专家上限 87.6% [S19]——也就是说人眼在「帖子」这个体裁上大致等于抛硬币，而这恰恰是检测器最能打的场景，所以技术手段是唯一可用的路径。

### N6 · 水印与来源凭证：现在到底能查到什么

**文本水印的落地状态（2026-10）：**

| 厂商 | 机制 | 覆盖 | 谁能验证 |
|---|---|---|---|
| Google | SynthID-Text（改采样、无可见字符）[S4] | Gemini app/web 文本 [S37] | 公开的 SynthID Detector 只收图像/视频/音频文件，**不收文本** [S38] |
| Anthropic | SynthID-Text 系方案 | 2026-08-02 之后发布的模型、全球、含 API [S37] | 检测 API 私有预览，仅限有 EU 合规义务的机构 [S37] |
| OpenAI | 自研 textGrain | **仅 EU 的 ChatGPT/Codex**；API 全球可选、默认关闭 [S34] | 只对审核过的研究者/机构开放 [S35] |
| xAI | 文档提到 Grok 部分模型 API 默认开启 | — | 需申请 [S37] |

OpenAI 自己公布的曲线是理解这类水印的最好刻度：1% 误报率下，200 token 约 80% 检出、400 token 约 95%，**把 25% 的词换成同义词后只剩 17%** [S37]；并且明确说 textGrain「不保证可靠检测」，不验证准确性、不证明人类作者身份 [S35]。所有水印的共同盲区是同一件事：短文本、事实性回答、代码、翻译、重写 [S4][S37]。

**文件凭证（C2PA）：** 清单签名只承诺「签名后字节未变、签名者是谁」，规范明说不判断内容真假 [S28][S29]。读者能自查的入口是 Adobe Inspect（inspect.cr）与 verify.contentauthenticity.org，能看到签名者、工具、动作以及是否标了 AI 生成；**没有凭证不等于不是 AI** [S30]。而且「有凭证」也不等于安全：2026-10 有人构造出签名有效、但哈希排他区间覆盖整个文件的图片，没有任何验证工具报警 [S31]。

**法规把水印从「可选」变成「必须」：** EU AI Act 第 50(2) 条自 2026-08-02 起要求生成式 AI 提供方**既标记又能被检测**，只做标记不算合规；2026-12-02 前已上市的系统也要补齐 [S32]。第 50(4) 条对文本的要求弱得多：只有「为告知公众公共利益的文本」需要披露，且经人工编辑审校、有编辑责任人的可豁免 [S33]。国内对应的是 GB 45438—2025 的强制元数据字段 [S45]。

## Analysis

**（以下为本报告的推断，不是来源结论。）**

把数字放在一起看，这个任务的结构是清楚的：**检测器不是「判断器」，是「按误报预算筛出的信号」**。任何一次调用真正决定的是三件事——文本长度、是否被改写过、以及你的先验。用贝叶斯算一下就明白为什么不能直接采信分数：取 TPR=95%、FPR=1.8%（Graphite 实测的 Pangram 档）[S9]，当被检内容的 AI 占比先验是 50% 时，一个阳性有 98% 概率为真；先验降到 5%（一个正常论坛里 AI 帖的真实比例），同一个阳性只剩 **73.5%** 为真。误报率从 1.8% 压到 0.5%（Epoch 实测档）[S7]，5% 先验下的阳性可信度升到 90.9%。**先压低误报率，比追求高召回对结论质量有用得多**——这也是为什么 Chicago Booth 的政策上限实验里，只有 Pangram 能在 0.5% 误报封顶下不塌 [S6]。

第二个结构性事实：**这个领域的「准确率」几乎全是分布内数字**。同分布能到 95–97%，换模型、换领域、加一次改写就掉到 60% 以下甚至个位数 [S13][S14][S26]。所以选型时真正该看的是「在**我的**数据上、按**我的**误报预算标定后」的曲线，而这份报告能提供的只是起点。

第三，**中文与英文的能力差不是翻译问题，是资源问题**：英文有 RAID（600 万条）、Graphite（9 万条）这种量级的公开评测，中文最大的公开资源是 C-HAT-Bench（24 万变体）[S15] 与 HC3-Chinese [S48]，商用中文检测器的第三方横评基本不存在。国内真正能查的「硬信号」反而是合规产物——元数据里的 `AIGC` 字段 [S45]。

## Confidence, gaps & disagreements

- **高置信：** 商用检测器在默认阈值下误报 <2%、开源 RoBERTa 系不可用 [S3][S6][S9]；改写能摧毁检测 [S13][S14]；SynthID 已在 Gemini 落地且不损质量 [S4]；水印对短文本/改写脆弱 [S4][S37]。
- **单源/暂定：** Pangram 在 4000 词论文上的 97.5% 与「人性化后仍 95%」来自厂商转述的 VUB 论文 [S8]，未读到原文；阿里云 `text_aigc_detector` 的准确率无任何第三方数字 [S47]；人民网「天目」93% 是机构自述 [S27]。
- **互相矛盾：** GPTZero 官方称 Chicago Booth 队列召回 99.3% 且优于 Pangram [S10]，而 Epoch 与 VUB 的独立复现里 GPTZero 明显落后甚至归零 [S7][S8]。差异来源是数据集构成与阈值，不是谁在撒谎——但这足以说明厂商数字不能用于选型。
- **未能确立：** 没有任何公开数据回答「中文论坛短帖（50–150 字）上商用检测器的误报率」——这是本次问题最核心的场景，却恰好落在所有基准的空档里。要回答它需要自建标注集（见 N7 第 2 步）。
- **不可脱离账号复现：** 三家厂商的**文本**水印检测器都不对公众开放 [S34][S37][S38]，本报告中「水印能查到什么」只能引用其文档，无法实测。

## Recommendations

1. **单篇快速判断（今天就能用）：** 主用 Pangram（≈$0.05/千词，独立评测里误报最稳）[S50][S6]，配一个自建零样本作交叉（Binoculars 4-bit 或 Fast-DetectGPT）。看「是否过阈」而不看百分比；两工具结论不一致就按「无结论」处理。
2. **先建 200–500 条你自己的标注集再谈准确率。** 同一体裁（论坛帖/公众号）、同一长度档、真人样本要与你的用户群同分布（含非母语、术语密集的样本，否则会复现 61% 误报那种偏差 [S12]），然后按 1% 误报预算重标定阈值。这一步比换工具重要一个数量级。
3. **批量场景按成本档选：** 万篇级、只做分流用 Sapling/Copyleaks（≈$135–150/百万词）；要「能拿去给人看」的结论用 Pangram 3（≈$250）[S49]。自建的交叉点在百万词量级以上，且必须自带 GPU（Binoculars 4-bit ≈7.8GB 显存 [S40]）。
4. **中文内容：** 纯文本走阿里云 `text_aigc_detector` 或自建中文模型（MLSDET 思路 / Qwen LoRA [S48][S26]）；**文件类内容先查元数据 `AIGC` 字段**，命中就是「确定」级证据 [S45]。
5. **结论只允许三档表述：** ①凭证/水印命中 →「确定由某工具生成」；②多个检测器一致且远过阈 →「很可能（附误报预算）」；③其余 →「无信息」。绝不把「未检出」说成「人写的」[S35][S38]。
6. **不要用于处分。** EU 指南只把可检测性作为提供方义务 [S32]，国内规范要求平台按「疑似」标注而非定性 [S44]——两套制度都在回避同一个事实：检测器给不出确证。

## Sources

| ID | Source | Tier | Access | Published | Retrieved |
|---|---|---|---|---|---|
| S1 | [Human or Machine? A Survey on Machine-Generated Text Detection (IEEE Access)](https://doi.org/10.1109/access.2026.3666781) | T1 | public | 2026-01-01 | 2026-11-04 |
| S2 | [Spotting LLMs With Binoculars: Zero-Shot Detection of Machine-Generated Text (arXiv 2401.12070)](https://arxiv.org/abs/2401.12070) | T1 | public | 2024-01-22 | 2026-11-04 |
| S3 | [RAID: A Shared Benchmark for Robust Evaluation of Machine-Generated Text Detectors (ACL 2024)](https://aclanthology.org/2024.acl-long.674.pdf) | T1 | public | 2024-08-11 | 2026-11-04 |
| S4 | [Scalable watermarking for identifying large language model outputs (Nature 634)](https://www.nature.com/articles/s41586-024-08025-4) | T1 | public | 2024-10-23 | 2026-11-04 |
| S5 | [RAID leaderboard](https://paperswithcode.co/benchmark/raid) | T2 | public | 2026-10-21 | 2026-11-04 |
| S6 | [Artificial Writing and Automated Detection (Becker Friedman Institute)](https://bfi.uchicago.edu/insights/artificial-writing-and-automated-detection/) | T2 | public | 2025-10-06 | 2026-11-04 |
| S7 | [AI detectors rarely flag human writing, but sometimes miss AI text imitating real authors (Epoch AI)](https://epoch.ai/data-insights/ai-detectors-false-negatives) | T2 | public | 2026-07-15 | 2026-11-04 |
| S8 | [Third-Party Pangram Evaluations (Pangram 转述 VUB/IJEI 论文)](https://www.pangram.com/blog/third-party-pangram-evals) | T4 | public | 2026-08-02 | 2026-11-04 |
| S9 | [AI Now Writes as Many Online Articles as Humans (Graphite)](https://graphite.io/five-percent/research/ai-now-writes-as-many-online-articles-as-humans-do) | T2 | public | 2026-05-15 | 2026-11-04 |
| S10 | [GPTZero Tops Accuracy on Chicago Booth Benchmark in 2026 (vendor)](https://gptzero.me/news/chicago-booth-2026/) | T4 | public | 2026-01-13 | 2026-11-04 |
| S11 | [How Accurate Are AI Detectors? What Independent Studies Found (2026)](https://aicheckerplus.com/guides/how-accurate-are-ai-detectors/) | T4 | public | 2026-10-31 | 2026-11-04 |
| S12 | [GPT detectors are biased against non-native English writers (Patterns, 2023)](https://arxiv.org/html/2304.02819v3) | T1 | public | 2023-07-10 | 2026-11-04 |
| S13 | [Can AI-Generated Text be Reliably Detected? (arXiv 2303.11156)](https://arxiv.org/html/2303.11156v2) | T1 | public | 2023-06-28 | 2026-11-04 |
| S14 | [Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense (NeurIPS 2023)](https://proceedings.neurips.cc/paper_files/paper/2023/hash/575c450013d0e99e4b0ecf82bd1afaa4-Abstract.html) | T1 | public | 2023-12-15 | 2026-11-04 |
| S15 | [C-HAT-Bench: Benchmarking Chinese AI-Text Detection Beyond Fully Generated Text](https://arxiv.org/abs/2609.32770) | T2 | public | 2026-09-26 | 2026-11-04 |
| S16 | [TURING: Evaluating Human Abilities to Identify AI-Generated Texts (LREC 2026)](https://aclanthology.org/anthology-files/anthology-files/pdf/lrec/2026.lrec-1.355.pdf) | T1 | public | 2026-05-01 | 2026-11-04 |
| S17 | [Learning to detect AI texts and learning the limits (PLOS One, 2025)](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0333007) | T1 | public | 2025-10-15 | 2026-11-04 |
| S18 | [Detecting Artificial Intelligence–Generated Versus Human-Written Medical Student Essays (JMIR / PMC11914838)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11914838/) | T1 | public | 2025-01-16 | 2026-11-04 |
| S19 | [Is Human-Like Text Liked by Humans? Multilingual Human Detection and Preference Against AI (ACL 2026)](https://doi.org/10.18653/v1/2026.acl-long.639) | T1 | public | 2025-02-17 | 2026-11-04 |
| S20 | [People who frequently use ChatGPT for writing tasks are accurate and robust detectors of AI-generated text (arXiv 2501.15654)](https://arxiv.org/html/2501.15654v2) | T2 | public | 2025-05-19 | 2026-11-04 |
| S21 | [AI Tells (Graphite research)](https://graphite.io/research/ai-tells) | T2 | public | 2026-09-16 | 2026-11-04 |
| S22 | [Burstiness, em dashes and "delve": the folk signals, measured (Opace Research)](https://opace.agency/tools/ai/content-verification-integrity/research/ai-writing-myths-measured/) | T3 | public | 2026-08-29 | 2026-11-04 |
| S23 | [No writing tell separates human from machine on its own: the best of 10 reaches AUC 0.80](https://dimhold.by/papers/tells-baseline/) | T3 | public | 2026-08-21 | 2026-11-04 |
| S24 | [Delving into LLM-assisted writing in biomedical publications through excess vocabulary (Science Advances, 2025)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12219543/) | T1 | public | 2025-07-02 | 2026-11-04 |
| S25 | [How AI-generated prose diverges from human writing and why it matters (Reuters Institute)](https://reutersinstitute.politics.ox.ac.uk/news/how-ai-generated-prose-diverges-human-writing-and-why-it-matters) | T2 | public | 2025-12-09 | 2026-11-04 |
| S26 | [LLM Encoder vs. Decoder: Robust Detection of Chinese AI-Generated Text with LoRA](https://doi.org/10.48550/arxiv.2509.00731) | T2 | public | 2025-08-31 | 2026-11-04 |
| S27 | [人民网「天目」智能识别系统发布](http://gz.people.com.cn/n2/2023/1210/c344102-40672928.html) | T4 | public | 2023-12-10 | 2026-11-04 |
| S28 | [C2PA and Content Credentials Explainer (spec 2.3)](https://spec.c2pa.org/specifications/specifications/2.3/explainer/_attachments/Explainer.pdf) | T1 | public | undated | 2026-11-04 |
| S29 | [How it works (Content Authenticity Initiative)](https://www.contentauthenticity.org/how-it-works) | T2 | public | undated | 2026-11-04 |
| S30 | [How to check an image for C2PA Content Credentials](https://wipetheai.com/guides/check-image-content-credentials) | T3 | public | 2026-09-23 | 2026-11-04 |
| S31 | [How to check a Content Credential, and what it does not show (verifiable.pro)](https://verifiable.pro/articles/check-a-content-credential/) | T3 | public | 2026-10-20 | 2026-11-04 |
| S32 | [Guidelines on the implementation of the transparency obligations under Article 50 (C(2026) 5054)](https://ai-act-service-desk.ec.europa.eu/sites/default/files/2026-07/guidelines_on_the_implementation_of_the_transparency_obligations_for_certain_ai_systems_under_article_50_of_the_ai_act_bzptwqhk0ikg1dtlddap41psfy_131215.pdf) | T1 | public | 2026-07-20 | 2026-11-04 |
| S33 | [Article 50: Transparency obligations (AI Act Service Desk)](https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50) | T1 | public | undated | 2026-11-04 |
| S34 | [Technical solutions for marking and detecting AI generated text content in the context of Article 50(2)](https://op.europa.eu/en/publication-detail/-/publication/6c981119-4829-11f1-8095-01aa75ed71a1/language-en) | T1 | public | 2026-10-05 | 2026-11-04 |
| S35 | [Provenance signals in OpenAI-generated content (OpenAI Help Center)](https://help.openai.com/en/articles/8912793-provenance-signals-in-openai-generated-content) | T2 | public | 2026-10-05 | 2026-11-04 |
| S36 | [OpenAI is adding text watermarking in ChatGPT and Codex (The Verge)](https://www.theverge.com/ai-artificial-intelligence/1004880/openai-chatgpt-text-watermarks-eu-ai-act) | T3 | public | 2026-08-12 | 2026-11-04 |
| S37 | [Who Watermarks What: AI Provider Tracker](https://aiwatermarking.org/who-watermarks-what/) | T3 | public | 2026-10-10 | 2026-11-04 |
| S38 | [Provenance Week: OpenAI Watermarks ChatGPT Text in the EU, Google Opens SynthID Detector to Everyone](https://aicassindra.com/research/2026/10/10/openai-textgrain-eu-text-watermark-google-synthid-detector-public.html) | T3 | public | 2026-10-09 | 2026-11-04 |
| S39 | [ahans30/Binoculars (GitHub)](https://github.com/ahans30/Binoculars) | T2 | public | 2026-05-01 | 2026-11-04 |
| S40 | [lukiies/Binoculars — 8 GB GPU edition (GitHub)](https://github.com/lukiies/Binoculars) | T3 | public | 2026-01-01 | 2026-11-04 |
| S41 | [baoguangsheng/fast-detect-gpt (GitHub)](https://github.com/baoguangsheng/fast-detect-gpt/) | T2 | public | 2026-01-31 | 2026-11-04 |
| S42 | [Croups/is-it-ai (GitHub)](https://github.com/Croups/is-it-ai) | T3 | public | 2026-06-01 | 2026-11-04 |
| S43 | [Open-Source AI Detectors You Can Actually Self-Host in 2026](https://couldthisbetrue.com/blog/oss-ai-detectors-self-host-2026/) | T4 | public | 2026-05-28 | 2026-11-04 |
| S44 | [人工智能生成合成内容标识办法（国信办通字〔2025〕2号）](https://www.gov.cn/zhengce/zhengceku/202503/content_7014286.htm) | T1 | public | 2025-03-07 | 2026-11-04 |
| S45 | [GB 45438—2025 网络安全技术 人工智能生成合成内容标识方法](http://kjs.customs.gov.cn/kjs/fileDir/resource/cms/article/2596230/6906637/2025122418290565612.pdf) | T1 | public | 2025-02-28 | 2026-11-04 |
| S46 | [TC260 网络安全标准实践指南——人工智能生成合成内容检测框架](https://www.tc260.org.cn/tc260/sjzn/202508/c0908483cf934b919e3f43cbe51d49d1/files/c05e9f9eca704c0985d72c40f7218ca1.pdf) | T1 | public | 2025-08-01 | 2026-11-04 |
| S47 | [AI生成合成内容鉴别和标识最佳实践（阿里云）](https://help.aliyun.com/zh/document_detail/2979119.html) | T3 | render | 2026-01-01 | 2026-11-04 |
| S48 | [MLSDET: Multi-LLM Statistical Deep Ensemble for Chinese AI-Generated Text Detection (ICASSP 2025)](https://doi.org/10.1109/icassp49660.2025.10888686) | T1 | public | 2025-03-12 | 2026-11-04 |
| S49 | [AI text detection: cheapest APIs compared (Oct 2026)](https://proxlai.com/markets/ai-text-detection) | T3 | public | 2026-10-18 | 2026-11-04 |
| S50 | [Best AI Detector APIs: The Four Options I'd Pick in 2026 (Fritz ai)](https://fritz.ai/best-ai-detector-apis/) | T3 | public | 2026-10-28 | 2026-11-04 |
