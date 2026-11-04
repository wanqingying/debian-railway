# Hugging Face 上的开源“Jev 类”决策小模型

**问题：** 有没有类似 TypeSafe Jev 的开源小模型，能内置进游戏做决策？
**日期：** 2026-11-02  **方法：** HF API 按 reward / rubric / judge / system-one / jev 等词检索，按下载量排序，逐个核对模型卡与参数规模

## 结论

**有，而且已经形成一个“System One 兼容”的小生态——但质量分层很明显：**

| 模型 | 参数 | 许可 | 实测水平 | 能否内置 |
|---|---:|---|---|---|
| [`autotrust/JEV-9B`](https://huggingface.co/autotrust/JEV-9B)（另有 27B/35B） | 9B | Apache-2.0 | Jev 1.13 的蒸馏学生，30k 测试集对齐 | ⚠️ Q4 约 5.5 GB，只能上独显 |
| [`systemonedev/kenning-xl-v0.6`](https://huggingface.co/systemonedev/kenning-xl-v0.6) | 1.7B | Apache-2.0 | Macro **0.688** vs Jev 0.830；**Agent 决策 0.860 vs 0.900** | ✅ Q4 约 1.1 GB |
| [`dwidlee/systemone-lite-0.5b`](https://huggingface.co/dwidlee/systemone-lite-0.5b) | 0.5B | Apache-2.0 | JevBench **50.7%**（随机约 32%），作者自评“不是生产级” | ✅ 300 MB，但能力不够 |
| [`JackKozmo29/*-jev-style-1.5b`](https://huggingface.co/JackKozmo29/depguard-jev-style-1.5b) | 1.5B | Apache-2.0 | 垂类（依赖/邮件/代码/告警）JSON 判定，无独立评测 | ✅ 但只适合对应领域 |
| [`pngwn/system-one-qwen3.5-4b-scorer`](https://huggingface.co/pngwn/system-one-qwen3.5-4b-scorer) | 4B | **CC-BY-NC-4.0** | 无公开评测 | ❌ 非商用许可，游戏不能用 |

**给你的答案：1.7B 这一档是可行区间。** 你的任务（“给定局面，从 6 个意图里选一个”）正好是 kenning-xl 表现最好的 “Agent decisions” 族：0.86 对 Jev 的 0.90，差距只有 4 个点，而 0.5B 那一档只有 50% 左右，不能用。

## 一、这个生态是怎么来的

TypeSafe 的 Jev 定义了一个“线上格式”：`POST /v1/systemone`，输入 state + 类型化问题（choice / score / noul），返回带概率的答案、不生成文本。HF 上出现了三类复刻：

1. **蒸馏学生**：`autotrust/JEV-9B/27B/35B`，用 `SargeDev/jev-distill-corpus-v3` 做知识蒸馏，模型卡里直接写“student of TypeSafe Jev 1.13”，指标用 KL / AUROC / Brier / ECE。Apache-2.0。
2. **独立实现**：`kenning-xl`（1.7B，限定答案 token 的 readout）与 `systemone-lite`（0.5B，closed-option 打分），都实现同一套 wire format，明确声明“与 TypeSafe 无关、未用其输出训练”。
3. **垂类微调**：把 Qwen2.5-1.5B 调成“jev-style”，输出 `{verdict: safe|caution|block}` 这类 JSON，主打“本地、无 key、换端点即可”。

## 二、诚实的质量边界

`systemone-lite-0.5b` 的模型卡写得很直白：

- Phase2 留出集 **61.6%**；JevBench 公开集 **50.7%**（随机基线约 32%）；
- **校准很差**（ECE 0.245）——“不要把概率当成可信置信度”；
- 空间规划类任务（2048 / 推箱子 / 国际象棋）**远未解决**（34–47%）；
- 作者定位：“demos / local experiments, not a production decision service”。

`kenning-xl` 的分项（vs Jev）：

| 族 | kenning-xl | Jev |
|---|---:|---:|
| Agent（工具调用、任务完成） | **0.860** | 0.900 |
| 对话 | 1.000 | 1.000 |
| 文本 | 0.752 | 0.834 |
| 规则/记录 | 0.663 | 0.921 |
| 表格 | 0.660 | 0.940 |
| 日志 | 0.440 | 0.720 |

**规律：越是“从选项里选一个”，小模型越接近 Jev；越是“按规则算数字/查表”，差距越大。** 你的派系领袖意图选择属于前者，商业模拟里的数值推演属于后者。

## 三、内置路线

1. **起点**：`kenning-xl-v0.6`（1.7B, Apache-2.0）。Q4 量化约 1.1 GB，桌面 CPU 12–20 tok/s，单次决策 0.3–1 秒，符合“领袖每 30–60 秒一次”的节奏。
2. **领域微调**：用你的 Agent 接口跑几千个局面，让 Jev（或 9B 学生）标注，再 LoRA 微调到 1.7B。你的动作空间只有 6–10 个，分类任务很窄，1.7B 完全够。
3. **导出**：GGUF（llama.cpp / Godot Llama）或 ONNX（序列分类头）。
4. **约束**：输出只允许你的合法动作 ID，解析失败回退规划器。

## 四、要避开的坑

- **许可**：`pngwn/system-one-qwen3.5-4b-scorer` 是 CC-BY-NC，**不能用于商业游戏**；主流几个是 Apache-2.0，可商用。
- **社会证明极弱**：那几个 “jev-style-1.5b” 只有 1 个 like，下载量却 8–9 万，来源可疑，别直接用于生产。
- **校准不可信**：小模型的 confidence 只能当排序用，不能当“该不该行动”的阈值——这一点连 0.5B 的作者都明说了。
- **不是 Jev**：权重、打分路径、confidence 公式都不同，行为会在边界案例上分叉。

## Sources

| ID | Source |
|---|---|
| S1 | [autotrust/JEV-9B（Jev 1.13 蒸馏学生）](https://huggingface.co/autotrust/JEV-9B) |
| S2 | [systemonedev/kenning-xl-v0.6（含 vs Jev 分项）](https://huggingface.co/systemonedev/kenning-xl-v0.6) |
| S3 | [dwidlee/systemone-lite-0.5b（含 JevBench 与自评限制）](https://huggingface.co/dwidlee/systemone-lite-0.5b) |
| S4 | [JackKozmo29/depguard-jev-style-1.5b](https://huggingface.co/JackKozmo29/depguard-jev-style-1.5b) |
| S5 | [pngwn/system-one-qwen3.5-4b-scorer（CC-BY-NC）](https://huggingface.co/pngwn/system-one-qwen3.5-4b-scorer) |
