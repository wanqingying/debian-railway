# kenning-xl-v0.6 要多大、CPU 能不能跑

**问题：** `systemonedev/kenning-xl-v0.6`（1.7B）的体积、内存、CPU 要求，能否内置进游戏？
**日期：** 2026-11-02

## 一句话

**体积：bf16 权重 3.4 GB；Q4 量化约 1.1 GB，运行时内存约 1.4 GB。CPU 完全能跑，但“能跑”和“能直接用”是两件事——它不是标准 transformers 模型，官方要求通过 `systemone-builder` 的自定义 readout 加载，没有现成 GGUF。**

## 一、体积与内存

| 形态 | 磁盘 | 常驻内存（含 KV cache） |
|---|---:|---:|
| bf16 原始权重（HF 上就是） | 3.44 GB | ≈ 4.0 GB |
| Q4_K_M 量化 | ≈ 1.1 GB | ≈ 1.4 GB |
| Q8_0 量化 | ≈ 1.9 GB | ≈ 2.3 GB |

作为对照：同规模的 Qwen3-1.7B Q4_K_M 下载下来正好 **1.11 GB**（本次实测），所以 “1.7B / Q4 ≈ 1.1 GB” 这个换算可以直接用。

打包影响：游戏本体如果是 2 GB，加 1.1 GB 模型 → 3.1 GB，Steam 首包体积涨约 55%；用独立 depot（可选下载）可以避开。

## 二、CPU 要求

结论先给：**任何支持 AVX2 的 x86-64（2015 年之后的 Intel Haswell+/AMD Excavator+）都能跑；8 线程是舒适线，4 线程可跑但每次决策 1–3 秒。**

| CPU 档次 | 典型机器 | 1.7B Q4 单次决策（prefill 1–2k token + 少量生成） |
|---|---|---|
| 4 线程、无 AVX-512 | 低端轻薄本 | 1.5–3 s |
| 8 线程 AVX2 | 主流台式/游戏本 | 0.4–1.2 s |
| 8 线程 AVX-512 / Apple M 系列 | 新台式 / Mac | 0.2–0.6 s |
| 独显（8 GB 显存） | 游戏 PC | < 0.2 s |

关键点：**这类“选择题”负载的耗时主要花在 prefill（把状态读进去），不是生成**。所以模型能一次并行评估多个问题（Jev 那套设计）时，成本几乎不随问题数增长——这正是它适合“每 30–60 秒问一次”的原因。

## 三、真正的障碍：它不是标准模型

`kenning-xl` 的 README 原文：

> “It is not a plain `transformers` classifier; load it through the builder.”

它的做法是：把 (state, question) 渲染成一段文本，跑一次前向，然后在**答案 token 的位置**读 next-token 分布，得到选项概率。这个 readout 逻辑在 `systemone-builder` 里，不在权重里。

后果：

- ❌ 没有官方 GGUF，`llama.cpp` 不能直接加载；
- ❌ 不能 `AutoModelForSequenceClassification` 一把梭；
- ✅ 权重本身是 Apache-2.0 的 Qwen3-1.7B LoRA 合并，可以自己导出；
- ✅ 你可以复现这个 readout：自己写“选项 token 打分”逻辑（llama.cpp 的 logits 接口就能做），或者在导出 ONNX 时把 readout 一起固化。

**所以内置路径是“改造”，不是“拿来即用”。**

## 四、实测未完成（已放弃该路线）

原计划在本机用 `llama.cpp` + Qwen3-1.7B-Q4_K_M 实测单次决策耗时，构建过程反复受阻（cmake 需手动装、`llama-cli` 目标已改名 `llama-app`、缺 server-impl 链接库），最终改用 `llama-cpp-python`；测量未跑完即决定不走“内置小模型”路线，实验产物（1.1 GB 模型 + 273 MB 构建目录 + 相关 pip 包）已清理。

因此上表中的 CPU 数字仍是**文献与规格推算值**，不是本机实测。路线决策见 `decision-jev-vs-local-model-2026-11-02/report.md`。

## 五、建议

1. **不要直接内置 `kenning-xl`**：它的价值是“证明 1.7B 能做到 0.86 的 agent 决策水平”，不是“拿来当依赖”。
2. **正确做法**：拿 Qwen3-1.7B（Apache-2.0）+ 你自己的 (state → 意图) 数据做 LoRA/分类头，导出 **ONNX**（序列分类，几百 KB 的 head）或 GGUF，自己控制 readout。
3. **规模取舍**：0.5B 也能跑（300 MB、<100 ms），但公开评测只有 50% 左右；1.7B 是“质量/体积”的甜点；9B 需要独显，不适合大众配置。
4. **降级**：没有模型/超时 → 回退手写效用函数，游戏必须完整可玩。

## Sources

| ID | Source |
|---|---|
| S1 | [systemonedev/kenning-xl-v0.6（3.44 GB safetensors，Apache-2.0，服务方式说明）](https://huggingface.co/systemonedev/kenning-xl-v0.6) |
| S2 | [unsloth/Qwen3-1.7B-GGUF（Q4_K_M 1.11 GB，本次实测下载）](https://huggingface.co/unsloth/Qwen3-1.7B-GGUF) |
| S3 | [dwidlee/systemone-lite-0.5b（0.5B 的延迟与准确率自评）](https://huggingface.co/dwidlee/systemone-lite-0.5b) |
