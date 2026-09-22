# QMD 本地调研与实测报告

**对象**：[tobi/qmd](https://github.com/tobi/qmd) — 本地 markdown 搜索引擎（BM25 全文 + 向量语义 + LLM 查询扩展/重排，全部经 node-llama-cpp 跑本地 GGUF 模型）。
**环境**：本仓库的 Debian Bookworm 容器（Railway，CPU-only，无 GPU）。
**版本**：qmd `2.8.3 (facd35e)`，Node `24.21.0`，npm `11.19.0`。
**日期**：2026-09-20。
**结论（一句话）**：可安装、可用、检索效果符合官方描述；但**本容器必须先解决 CPU 线程超订**，否则会误判为“卡死”。

---

## 一、安装

```bash
npm install -g @tobilu/qmd
```

### 坑 1：npm 11 默认拦截 install 脚本

首次安装只装了 JS 包，node-llama-cpp 的 `postinstall`（下载预编译 llama.cpp 二进制）和 tree-sitter 的原生构建都被跳过，qmd 无法启动。必须显式放行：

```bash
npm install -g \
  --allow-scripts=node-llama-cpp,tree-sitter-go,tree-sitter-python,tree-sitter-rust,tree-sitter-typescript,tree-sitter-javascript \
  @tobilu/qmd
```

预编译后端以独立包形式安装（`@node-llama-cpp/linux-x64` 等），`node-llama-cpp/bins/*.moved.txt` 是正常标记，不是缺失。

### 坑 2：模型体积

三个 GGUF 模型首次使用时自动从 HuggingFace 下载，缓存于 `~/.cache/qmd/models/`：

| 模型 | 用途 | 体积 |
| --- | --- | --- |
| `embeddinggemma-300M-Q8_0` | 向量嵌入（默认） | 334 MB |
| `qwen3-reranker-0.6b-q8_0` | 重排 | 639 MB |
| `qmd-query-expansion-1.7B-q4_k_m` | 查询扩展（微调） | 1282 MB |

合计约 **2.2 GB**。可先 `qmd pull` 预热，避免首次搜索等下载。

---

## 二、环境适配：CPU 线程超订（本次最大问题）

### 现象

第一次 `qmd vsearch` 看似“卡死”：进程 ~780% CPU、150 s+ 无输出，一度怀疑死锁。

### 根因

容器 cgroup CPU 配额与上报核数不一致：

```
/sys/fs/cgroup/cpu.max = 800000 100000   # 实际只有 8 核
nproc / os.cpus() / llama.cpp getMathCores() = 48
```

node-llama-cpp 默认按 `getMathCores()` 起线程（即 48），在 8 核配额上超订 6 倍，线程争抢导致吞吐崩坏。**不是死锁，是慢约 72 倍。**

### 实测（同一 1.7B 模型、同一段生成）

| maxThreads | 耗时 |
| --- | --- |
| 默认（48） | **37 129 ms** |
| 16 | 825 ms |
| **8** | **512 ms** |

8 线程比默认快约 **72 倍**。

### 修复

qmd 未暴露线程参数（`getLlama` 调用处不传 `maxThreads`）。本地最小补丁——在

`/usr/lib/node_modules/@tobilu/qmd/dist/llm.js:648` 的 `getLlama({...})` 选项里加一行：

```js
maxThreads: Number(process.env.QMD_MAX_THREADS) || undefined,
```

然后所有 qmd 命令前 `export QMD_MAX_THREADS=8`。

> 注意：该补丁打在**全局 npm 包**上，容器 root FS 每次 redeploy 会重置，需重打；要长期生效应给上游提 issue/PR，或在启动脚本里做幂等 patch。

---

## 三、测试方法

### 语料

`/tmp/opencode/qmd-test` 下 8 篇自造 markdown，分 2 个 collection：

- `notes`（英文 5 篇）：`railway-deploy`、`ssh-access`、`model-pricing`、`agent-memory`、`provider-throttling`
- `notes-zh`（中文 3 篇）：`数据库连接池`、`红烧肉`、`西藏自驾`

关键设计：`provider-throttling.md` 通篇不含 “rate limit” 字样（用 429 / backoff / throttle），用来验证**纯语义召回**。

### 命令

```bash
export XDG_CONFIG_HOME=/tmp/opencode/qmd-test/.config \
       XDG_CACHE_HOME=/tmp/opencode/qmd-test/.cache \
       QMD_MAX_THREADS=8

qmd collection add ./notes --name notes --mask '**/*.md'
qmd collection add ./zh    --name notes-zh --mask '**/*.md'
qmd context add qmd://notes    "English engineering and project notes"
qmd context add qmd://notes-zh "中文生活与技术笔记"
qmd update
qmd embed                       # 8 chunks in 10s
```

采用官方 `qmd bench`（四后端并行评测，指标 P@k / recall / MRR / F1），fixture 见 `/tmp/opencode/qmd-test/fixtures-en.json`、`fixtures-zh.json`。

---

## 四、结果

### 4.1 `qmd bench` 汇总

| 后端 | 说明 | EN P@k / MRR | ZH P@k / MRR |
| --- | --- | --- | --- |
| `bm25` | 纯关键词（FTS5） | 0.667 | 0.250 |
| `vector` | 纯向量 | **1.000** | **1.000** |
| `hybrid` | BM25 + 向量融合 | 1.000 | 1.000 |
| `full` | 全链路（+扩展+重排） | 1.000 | 1.000 |

**读法**：

- BM25 秒级（1–4 ms）但漏召——英文漏掉两个语义 needle（0.667），中文几乎全漏（0.250，FTS5 不切中文词，多字词无法命中）。
- 向量把 BM25 的缺口全部补齐；hybrid/full 保持 1.000。
- 中文用**默认 embeddinggemma**（官方说它是英文优化）在全对。**但这只说明语料太小、三篇主题互斥，不能外推到真实大中文语料**。

> 延迟列不可直接横比：每个后端首次调用含模型加载（向量首行 2.1 s，之后 15–27 ms）。

### 4.2 单条语义 needle（英文）

查询 “how to avoid being rate limited by the LLM provider”，目标 `provider-throttling.md`：

| 命令 | 耗时 | 命中 |
| --- | --- | --- |
| `qmd search`（bm25） | 2 ms | 无结果 |
| `qmd vsearch`（含扩展） | 5.4 s | ✅ 榜首，score 50% |
| `qmd query`（混合+重排） | 16.0 s | ✅ 榜首，score **100%** |

### 4.3 MCP / HTTP（对 agent 最有用）

```bash
qmd mcp --http --port 8181     # localhost:8181
```

- `GET /health` → `{"status":"ok","uptime":0}`
- `POST /query`（结构化，绕过内置扩展）返回 `qmd://` URI + docid + snippet，例如中文 query 返回：

```
1. provider-throttling.md   score 0.75
2. 西藏自驾.md               score 0.56   <- 正确答案
```

**注意**：结构化单一 `vec` 查询因缺少 query expansion，排序会偏；官方也建议结构化查询由 LLM 自己给多组 `lex/vec/hyde` 变体。用内置扩展的 `qmd vsearch`/`qmd query` 则正常。

---

## 五、成本与性能

| 项 | 实测 |
| --- | --- |
| 磁盘 | 模型 2.2 GB + 索引（8 篇 ~144 KB） |
| 内存 | 三模型同时驻留约 2 GB 量级 |
| CPU | 线程补丁后 `QMD_EMBED_PARALLELISM` 默认；重排是主要开销 |
| 延迟 | 纯向量 ~20 ms；`vsearch` ~5 s；`query` ~16 s；`embed` 8 chunks 10 s |
| 网络 | 首次拉模型 2.2 GB，之后全本地、无外部调用 |

无 GPU 时，重排（`full` 后端）单条 2–3 s，是交互体验的主要瓶颈。

---

## 六、结论与建议

### 可用性

- ✅ 本容器可安装、可运行；BM25/向量/混合/重排/MCP 全链路验证通过。
- ✅ 检索效果符合官方描述：BM25 快但漏召，hybrid/full 补齐语义。
- ⚠️ **必须**给 node-llama-cpp 限线程（`maxThreads≈8`），否则会被误判为卡死；这是本容器的 cgroup 配额问题，非 qmd bug。

### 接入建议

1. **给 opencode agent 用**：优先走 `qmd mcp`（stdio 或 HTTP），比让模型调 CLI 更省 token，且 `--json/--files` 结构对 agent 友好。
2. **长期化线程修复**：在 `scripts/install-tools.sh` 或 entrypoint 里对 qmd 打幂等补丁（或等上游支持 maxThreads），避免每次 redeploy 失效。
3. **中文真实场景**：本次语料太小不足以定论。若中文语料占比高，按官方建议改用 `QMD_EMBED_MODEL=hf:Qwen/Qwen3-Embedding-0.6B-GGUF/...` 并 `qmd embed -f` 重建，再评测。

### 未做 / 局限

- 未在真实中文大语料上对比默认 embeddinggemma 与 Qwen3-Embedding。
- 语料仅 8 篇、主题互斥，bench 数值偏乐观，不代表真实知识库表现。
- 未测并发与 MCP daemon 长稳。

---

## 附：复现步骤

```bash
# 1. 安装（含脚本放行）
npm install -g \
  --allow-scripts=node-llama-cpp,tree-sitter-go,tree-sitter-python,tree-sitter-rust,tree-sitter-typescript,tree-sitter-javascript \
  @tobilu/qmd

# 2. 打线程补丁（dist/llm.js 的 getLlama 选项加 maxThreads）
#    maxThreads: Number(process.env.QMD_MAX_THREADS) || undefined,

# 3. 隔离环境变量（避免污染 $XDG_CONFIG_HOME）
export XDG_CONFIG_HOME=/tmp/opencode/qmd-test/.config \
       XDG_CACHE_HOME=/tmp/opencode/qmd-test/.cache \
       QMD_MAX_THREADS=8

# 4. 建库
cd /tmp/opencode/qmd-test
qmd collection add ./notes --name notes --mask '**/*.md'
qmd collection add ./zh    --name notes-zh --mask '**/*.md'
qmd update && qmd embed

# 5. 检索
qmd search  "cache write price"
qmd vsearch "how to avoid being rate limited by the LLM provider"
qmd query   "how do I stop getting throttled by an API provider"

# 6. 评测
qmd bench fixtures-en.json -c notes
qmd bench fixtures-zh.json -c notes-zh

# 7. MCP HTTP
qmd mcp --http --port 8181
curl -s http://localhost:8181/health
```
