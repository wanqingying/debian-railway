# judge-v1 评测结果

- 数据集：RAID（长文摘要，llama-chat/mpt/mpt-chat/mistral/mistral-chat，attack=none）、HC3-en、HC3-zh（短问答，老 ChatGPT）
- 判定模型：`opencode-go/deepseek-v4.1-flash`，每条一个全新会话，输入为 `prompt-judge-v1.md` 全文（`{{TEXT}}` 替换）
- 判定规则：`AI`+`LIKELY_AI` = 判 AI；`LIKELY_HUMAN`+`UNCERTAIN` = 判人
- 样本：60 条，每条数据集 human/ai 各 ≤10

## 1. 各数据集

### RAID（n=20）

混淆矩阵（行=模型判定，列=真实标签）：

| 判定 | 真实 human（n=10） | 真实 ai（n=10） |
|---|---|---|
| 判 AI（`AI`+`LIKELY_AI`） | 0 | 7 |
| 判人（`LIKELY_HUMAN`+`UNCERTAIN`） | 10 | 3 |

- 总体准确率：**85.0% [64.0–94.8]**（17/20，95% Wilson）
- 判人准确率（human 被正确判人）：100.0%；判 AI 准确率（ai 被正确判 AI）：70.0%
- `UNCERTAIN` 占比：**45.0%**（9/20）
- 剔除 `UNCERTAIN` 后：**90.9% [62.3–98.4]**（10/11）
- 平均耗时：17.3s/条

### HC3-en（n=20）

混淆矩阵（行=模型判定，列=真实标签）：

| 判定 | 真实 human（n=10） | 真实 ai（n=10） |
|---|---|---|
| 判 AI（`AI`+`LIKELY_AI`） | 0 | 10 |
| 判人（`LIKELY_HUMAN`+`UNCERTAIN`） | 10 | 0 |

- 总体准确率：**100.0% [83.9–100.0]**（20/20，95% Wilson）
- 判人准确率（human 被正确判人）：100.0%；判 AI 准确率（ai 被正确判 AI）：100.0%
- `UNCERTAIN` 占比：**15.0%**（3/20）
- 剔除 `UNCERTAIN` 后：**100.0% [81.6–100.0]**（17/17）
- 平均耗时：14.2s/条

### HC3-zh（n=20）

混淆矩阵（行=模型判定，列=真实标签）：

| 判定 | 真实 human（n=10） | 真实 ai（n=10） |
|---|---|---|
| 判 AI（`AI`+`LIKELY_AI`） | 0 | 10 |
| 判人（`LIKELY_HUMAN`+`UNCERTAIN`） | 10 | 0 |

- 总体准确率：**100.0% [83.9–100.0]**（20/20，95% Wilson）
- 判人准确率（human 被正确判人）：100.0%；判 AI 准确率（ai 被正确判 AI）：100.0%
- `UNCERTAIN` 占比：**35.0%**（7/20）
- 剔除 `UNCERTAIN` 后：**100.0% [77.2–100.0]**（13/13）
- 平均耗时：11.3s/条


## 2. 覆盖度（UNCERTAIN 与剔除后准确率）

| 数据集 | UNCERTAIN 占比 | 剔除 UNCERTAIN 后准确率 | 总体准确率 |
|---|---|---|---|
| RAID | 45.0%（9/20） | 90.9%（10/11） | 85.0% [64.0–94.8] |
| HC3-en | 15.0%（3/20） | 100.0%（17/17） | 100.0% [83.9–100.0] |
| HC3-zh | 35.0%（7/20） | 100.0%（13/13） | 100.0% [83.9–100.0] |

## 3. 三数据集合并

### 全部样本（n=60）

混淆矩阵（行=模型判定，列=真实标签）：

| 判定 | 真实 human（n=30） | 真实 ai（n=30） |
|---|---|---|
| 判 AI（`AI`+`LIKELY_AI`） | 0 | 27 |
| 判人（`LIKELY_HUMAN`+`UNCERTAIN`） | 30 | 3 |

- 总体准确率：**95.0% [86.3–98.3]**（57/60，95% Wilson）
- 判人准确率（human 被正确判人）：100.0%；判 AI 准确率（ai 被正确判 AI）：90.0%
- `UNCERTAIN` 占比：**31.7%**（19/60）
- 剔除 `UNCERTAIN` 后：**97.6% [87.4–99.6]**（40/41）
- 平均耗时：14.3s/条


分档位分布（human 条数 / ai 条数）：

| 数据集 | LIKELY_HUMAN | UNCERTAIN | LIKELY_AI | AI |
|---|---|---|---|---|
| RAID | 3/1 | 7/2 | 0/4 | 0/3 |
| HC3-en | 7/0 | 3/0 | 0/10 | 0/0 |
| HC3-zh | 3/0 | 7/0 | 0/5 | 0/5 |
| 合计 | 13/1 | 17/2 | 0/19 | 0/8 |

## 4. 失败案例

共 3 条判错（按置信度降序取 3 条）：

**失败案例 1 — raid-a0002600（RAID，真实 ai，判定 UNCERTAIN @ 0.62）**

> This study introduces a novel mask-guided sample selection approach for semi-supervised instance segmentation. Our method utilizes the availability of partially labeled data, where only object masks a……

- evidence：「novel mask-guided」→ 以泛化的新颖性声明开篇，未给出具体机制，属于模板化学术措辞。；「Overall, this work」→ 结尾升华段语义空泛，是模型摘要的常见结构，但人类学术写作也常用。；「leveraging available」→ leverage 等抽象动词重复出现，与套话高度重合，但单独不构成证据。
- caveats：最可能错在把高度模板化、非母语的学术摘要误判为 AI；全文无硬信号，证据强度不足。

**失败案例 2 — raid-a0001600（RAID，真实 ai，判定 LIKELY_HUMAN @ 0.6）**

> \begin{paracol}{2}    This work presents w–net, our proposed novel dual supervised medical image segmentation model based on Unet++ architecture that can benefit both weakly labeled data (a few pixels……

- evidence：「This means it does」→ 缺少助动词、语法塌陷，是随手写作而非模型平滑输出；「end –to -end」→ 连字符前后空格混乱，「–to」混用长短破折号，属人工排版痕迹；「pre trainings done」→ 名词堆叠、冠词缺失，非母语作者口语化直译；「~refer Paper 1 & 2~」→ 正文里留下非正式占位引用，是草稿级人类痕迹而非成稿模板
- caveats：文本被截断且可能是 PDF/OCR 提取或翻译产物，残缺本身会伪装成人味；若原文完整且这些错误是刻意注入的，则判断会反转。

**失败案例 3 — raid-a0004600（RAID，真实 ai，判定 UNCERTAIN @ 0.55）**

> > We propose fast image segmentation by directly predicting super pixel labels on input images via boundary maps produced on its convolutional feature channels with our proposed boundary- to-pixel dir……

- evidence：「boundary- to-pixel」→ 连字符后跟空格、术语不统一（super pixel/superpixel），这类手工排版与改动留下的残迹更像作者自己反复编辑的结果，而非一次性生成的干净输出。；「through binoculars」→ 摘要中出现「像用双筒望远镜看」这种生活化类比，是作者自发的题外插话；模型在正式摘要里通常不会引入这类比喻。；「flops by 80%」→ 带有具体到实现层面的算力对比数字，属于只有作者才掌握的实验细节，难以凭空编造。
- caveats：最可能错在：这可能是作者对原摘要做的机器改写或翻译润色，非母语搭配与那个类比或许来自原文，而被改写的部分恰好抹掉了人类痕迹。

