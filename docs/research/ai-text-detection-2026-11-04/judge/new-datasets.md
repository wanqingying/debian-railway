# 换用新数据集：候选清单 + 实测

目标：把标定从 RAID（2024-05，ACL 2024）/ HC3（2023，ChatGPT 时代）换到覆盖 2025–2026 模型的语料，并且最好有中文、有「人机协作（AI 润色）」这一档。

## 候选（按对本项目的适用度排序）

| # | 数据集 | 时间 | 语种 | 规模 | 生成模型 | 为什么有用 / 局限 | 可直接下载 |
|---|---|---|---|---|---|---|---|
| 1 | **C-ReD**（ACL 2026 Findings，清华/南开/哈工大深圳/鹏城） | 2026 | 中文（+繁中） | 128,610（人类 12,997 / AI 115,613） | GPT-3.5、GPT-4o、Gemini-2.5-Flash、Claude-3.5-Haiku、DeepSeek-V3、**DeepSeek-R1**、Qwen2.5、**Qwen3**、豆包-1.5-Pro | 五个域（新闻 THUCNews、知乎问答、豆瓣影评、高考作文、ChinaXiv 学术），真实 prompt；**有知乎/豆瓣，语域最接近论坛** | ✅ GitHub `HeraldofLight/C-ReD` 逐域逐模型 CSV |
| 2 | **TextSight 2026 控制集** | 2026-09-30 | 英文 | 700（人类 644 / AI 56） | **Claude Opus 5、Claude Haiku 4.5**、GPT-4.1、gpt-oss-120b、**Qwen 3.8** | 唯一一份明确目标是「不迁就检测器」的 2026 集；人类侧用 pre-2022 维基 / PMC 2015–21（不用维多利亚小说），体裁与 AI 侧对齐；附官方基准（同一模型同一代码：易题 88.2% → 难题 25%） | ✅ HF `textsightai/ai-text-detection-benchmark-2026` |
| 3 | **C-HAT-Bench**（arXiv 2609.32770） | 2026-09 | 中文 | 5,000 人类原文 → **240,539 变体** | **GPT-5.5、Qwen3.7-Plus、GLM-5.2、Kimi K2.6、DeepSeek V4 Pro、Gemini 3.5 Flash** | **最对口「AI 参与」**：三种协作模式（Content Filling / Machine Rewriting / Prompt-based Generation）+ 前缀续写 + 边界定位；21 个检测器、AUROC 在协作模式下平均降 12.0% | ⚠️ 代码/数据在 anonymous.4open.science，需先确认可下载 |
| 4 | **AIGC-text-bank**（arXiv 2604.19172，MSRA REVEAL） | 2026-04 | 英文 | 1,498,279（human 67k / ai_native 699k / **ai_polish 732k**） | GPT-5、GPT-4o、DeepSeek-R1、Grok 4.1、Qwen3-8B/32B、Llama-3.3-70B、Phi-4 等 12 个 | 唯一把 **AI 润色（人写→AI 改）** 单独成类的大集，10 个域含 Twitter/Reddit；英文 | ✅ HF `bmbgsj/AIGC-text-bank` |
| 5 | **DetectRL-ZH / NLPCC 2025 Task 1** | 2025 | 中文 | 训练 32,400 | GPT-4o、GLM-4-flash、Qwen-turbo | 含 paraphrase / adversarial / mixed；测试集 OOD（DeepSeek-V3 创意写作） | ✅ 任务页 + GitHub |
| 6 | **NLPCC 2026 Task 6** | 2026 | 中文 | 训练 20,370 对（HWT/LGT/HLT 三列） | GPT-4、Qwen、ChatGLM、Baichuan | 三列格式天然包含「LLM 精修文本」 | ✅ 任务页 

不再有用的：`artem9k/ai-text-detection-pile`、`MAGE`、`TuringBench`、`HC3`——生成器全是 GPT-2/3/ChatGPT，正是问题本身。

## 实测（同一套 v4，阈值 0.75）

### C-ReD（中文，2026）

抽样：知乎问答人类 15 + 知乎问答 AI（Qwen3 15、DeepSeek-R1 15）+ 豆瓣影评人类 15 + 豆瓣影评 AI（Qwen3 15）= 75 条。

| 群体 | 判 AI | 平均 p_ai |
|---|---|---|
| **AI（44 条可比）** | **44/44 = 100%** | 0.87 |
| **人类（30 条）** | **1/30 = 3.3%** | 0.13 |

唯一误报是豆瓣影评里一段高度排比的抒情文字（0.78）。

### TextSight 2026（英文，2026 前沿模型）

| 群体 | 结果 |
|---|---|
| AI（55 条） | **42/55 = 76%** 检出，平均 p 0.77 |
| 人类（40 条，维基 2021 + PMC 2015–21） | **0/40 = 0% 误报**，平均 p 0.23 |

分模型：gpt-oss-120b 92%、Claude Haiku 4.5 83%、GPT-4.1 82%、Qwen 3.8 75%、**Claude Opus 5 50%**。

对照：该数据集公布的检测器在同样的人类集上是 **Oxidane 50% @1% FPR**、他们自己的轻量检测器 **25%**；换成"维多利亚小说当人类"的送分题则 88.2%。

## 结论

1. **判定器没坏，坏的是语域。** 换到 2026 年的中文数据集（C-ReD），100% 检出 AI、3.3% 误报；换到 2026 年前沿英文（TextSight），76% 检出、0 误报。而小黑盒（xhh）只有 18.8%，刻意模仿人类的生成文本 0/40——**是因为那里是"像玩家随口写的"语域，不是模型更新了**。
2. **阈值 0.75 在新数据集上依然站得住**（TextSight 人类 0 误报、C-ReD 人类 3.3% 误报）。之前判断"阈值不可迁移"只对"刻意伪装"那一档成立。
3. **下一步的标定应该用 C-ReD**：它是中文、可直接下、覆盖 DeepSeek/Qwen/豆包，而且是当前唯一能把「知乎问答 / 豆瓣影评」这类论坛语域单独拆出来看的公开集。
4. **要回答「AI 参与率」必须换数据集**：C-ReD 只有 human / AI 二分。要么用 AIGC-text-bank 的 `ai_polish`（英文），要么等 C-HAT-Bench 的数据落地（中文、含协作模式），否则「润色过的真人稿」在现有任何评测里都是不可见的。
