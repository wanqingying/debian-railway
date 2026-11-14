# AI 编程模型：成本公式与选型方法

本文件分三部分：

1. **成本公式**——把「缓存读/写 + 输入/输出」的 token 分布换算成统一的真实成本。
2. **选型方法**——Pareto 前沿 + ICER + 拐点，把质量与价格分开，客观排序。
3. **数据流水线**——如何取模型列表、补齐缓存价、拉榜单、算结果。

> 价格和榜单排名随时间变化，本文只固定**方法与过程**；具体结论用文末脚本现跑现取。

---

# 一、成本公式

## 1.1 符号

| 符号 | 含义 |
| --- | --- |
| `Pin` | 输入单价（$/1M token） |
| `Pout` | 输出单价（$/1M token），通常 ≈ 4~5 × Pin |
| `Cr` | 缓存读单价 |
| `Cw` | 缓存写单价 |
| `h` | 输入侧缓存命中率 = `cache_read / (cache_read + cache_write + fresh_input)`，默认 **0.98** |
| `k` | 输出 token ÷ **总输入** token（含缓存读），agent 场景 ≈ **0.004**（典型请求：50K 缓存读 + 800 新增 + 200 输出）|

> `h` 与 `k` 描述**工作负载**（你怎么用），不是模型属性：长上下文多轮 agent 取上述默认；短问答的 `k` 会高得多。可用 `--from-sessions` 从真实会话实测（见 3.3）。

## 1.2 公式

每 1M 输入 token 的真实成本（含输出摊薄）：

```
P(1M in) = h · Cr + (1 − h) · Cw + k · Pout
```

其中输入部分：`h` 的命中量按 `Cr` 计，`(1−h)` 的新写量按 `Cw` 计。这就是脚本 `scripts/model-cost.py` 使用的形式，`Cr`/`Cw` 优先取模型的**实际缓存价**（见流水线）。

> **`k` 的分母是总输入（含缓存读），不是新增输入。** agent 长会话里每轮重读整个上下文，缓存读占绝对多数，输出相对总量很小——Command Code 的"典型请求"为 50K 缓存读 + 800 新增输入 + 200 输出，故 `k = 200/(50000+800) ≈ 0.004`。若误把 `k` 当成"输出÷新增输入"（那种口径约 0.05~0.15），输出项会被高估 25 倍，月度用量估算随之偏小近一个数量级。

当没有实际缓存价、退回经验系数时：`Cr = 0.1·Pin`，`Cw` 按缓存模式取（h=0.98）：

| 缓存模式 | `Cw` | 输入系数 `Cw·(1−h) + 0.1·h` |
| --- | --- | --- |
| **自动缓存**（默认，多数：DeepSeek/OpenAI/Google/开源托管）| `1.0·Pin` | **0.118·Pin** |
| 显式缓存（Anthropic `cache_control`）| `1.25·Pin` | 0.123·Pin |

```
P(1M in) = 0.118·Pin + k·Pout          ($/1M 输入 token，自动缓存默认)
```

每"混合 token"均价（输出摊进输入，便于不同 k 对比）：

```
P̄ = P(1M in) / (1 + k)
```

## 1.3 缓存写价的两种模式

`Cw` 不是一个常数，取决于 provider 的缓存机制：

| 缓存模式 | 代表 | `Cw` |
| --- | --- | --- |
| **显式缓存**（`cache_control`） | Anthropic | `1.25 × Pin`（5min TTL）/ `2 × Pin`（1h） |
| **自动缓存** | OpenAI、DeepSeek、Google、多数开源托管 | `1 × Pin`（写就是普通输入，无溢价） |

`Cr` 一般 ≈ `0.1 × Pin`，但也以实际数据为准（如 MiMo 的缓存读低至 Pin 的 2%）。流水线会先取实际值，缺失时才按上表推导。

## 1.4 敏感度

| h | 输入系数 `1.25(1−h)+0.1h`（Anthropic 式）|
| --- | --- |
| 90% | 0.215 |
| 96% | 0.146 |
| **98%** | **0.123** |
| 99% | 0.112 |

> h 每 +6 个百分点 ≈ 输入成本再降约 1/4。**缓存工程（保持前缀稳定、控制每轮新增量）比选模型更能决定账单。** k 越大（thinking / 长输出）真实成本越高。

## 1.5 公式自检（示意输入，h=0.98、k=0.004，自动缓存 Cw=Pin）

| 模型 | Pin | Pout | 无缓存成本 | h=98% 成本 | 节省 |
| --- | --- | --- | --- | --- | --- |
| gpt-5.6-luna | $0.20 | $1.20 | $0.205 | **$0.0284** | 86% |
| Claude Sonnet 4.6 | $3 | $15 | $3.06 | **$0.414** | 86% |
| gpt-5.6-sol | $4 | $20 | $4.08 | **$0.552** | 86% |
| DeepSeek V4.1 Flash | $0.15 | $0.60 | $0.152 | **$0.0083** | 95% |

无缓存成本 = `Pin + k·Pout`（每 1M 输入全按新价，即 h=0）；h=98% 把输入侧压到 11.8%。前三行按自动缓存经验系数；DeepSeek 末行用实际缓存读 $0.003，故节省更多。

---

# 二、选型方法：Pareto + ICER + 拐点

## 2.0 为什么不揉成一个"性价比分数"

把质量与价格相除（`质量/价格`）看似直观，但不严谨：

- Elo 分是序数 / 对数几率尺度，美元是比率尺度，**相除等于拼接两种量纲**；换一种同样合理的质量映射（原始分、胜率、log-odds），排名就变，没有唯一答案。
- 质量门槛（"最低可用分"）是主观的，藏进系数里会产出"假精确"。
- Arena 分有投票噪声，公式却把噪声内的差异当确定值排序。

下面这套方法把**主观部分显式化**，其余全部客观淘汰。

## 2.1 综合价格

用第一部分的公式算出每个模型的 `P(1M in)`。

## 2.2 Pareto 前沿（零主观）

在「价格（越低越好）× 分数（越高越好）」平面上，只保留**不被任何模型支配**的点。若存在模型 A 使

```
price_A ≤ price_i  且  score_A ≥ score_i   （至少一项严格）
```

则 i 被淘汰。

- **不需要任何基线**，纯客观。
- 前沿之外的模型任何场景都不该选（总有更便宜且更好的）。

## 2.3 ICER（增量成本效果比）

把前沿按价格升序排列，相邻两点的 `Δ价格 / Δ分数` 即**升级一格质量要多花多少钱**（$/质量点）：

```
ICER(A→B) = (price_B − price_A) / (score_B − score_A)
```

## 2.4 拐点（Knee）

对每个前沿内部点，取「右侧 ICER ÷ 左侧 ICER」，比值最大处即**拐点**——越过它之后，每多一分质量的成本急剧上升。拐点以下都是"便宜的质量"，拐点以上由你决定值不值。

## 2.5 Top-N 短名单（放宽"被支配即淘汰"）

严格 Pareto 淘汰会把被支配模型一次丢光。放宽做法是**迭代取最优**：

```
ranked = []
remaining = 全部合格模型
while remaining:
    pick = F(remaining)        # 本轮最优：拐点；不足 3 个前沿点时退化为最便宜的前沿点
    ranked.append(pick)
    remaining.remove(pick)     # 只移除这一个
```

关键：**每轮只移除选中的那一个**。优胜者被移走后，它原先支配的模型可能重新成为前沿，从而在后续轮次入选，短名单不被"第一层前沿"锁死。

## 2.6 两个人类友好列

- `xlow`：综合价相对**当前展示集最低价**的倍数（如 `2.2x`）
- `dlow`：分数相对**当前展示集最低分**的差距（如 `+154`）

## 2.7 性价比值（value）——仅作短名单启发式

2.0 说明「质量/价格」不是严格的排序量纲，因此**曲线选型用 Pareto/ICER**（2.2–2.5）。但当需要一个**大批量短名单**（如生成工具菜单）时，可按性价比值取一个粗筛：

```
value = score / price        # score 为质量分（CC intelligence 或 Arena 分）
```

它单调等价于"每美元质量"，仅用于**取前 N% 的候选集合**，不用于精细排名。`model-cost.py` 提供：

```bash
--sort value          # 按 value 降序列表
--top-percent 50      # 只保留前 50%（配合 --sort value）
```

注意 `price=0`（免费模型）会得到无限 value，应单独保留而非参与除法。

---

# 三、数据流水线

```
① 拉价格目录    fetch-model-prices.py    → docs/models-prices.json
② 拉榜单匹配    arena-cost.py            → scripts/models-arena-<category>.json
③ 算 Pareto/ICER model-cost.py          → 终端输出 Top-N + 拐点
④ 拉 GOAT 目录  fetch-goat-models.py     → scripts/models-goat-catalog.json
⑤ 生成配置      gen-commandcode-config.py → opencode.jsonc 的模型列表
```

五个脚本都自包含：无参数直接跑即自动下载缺失数据、合并、计算。下载缓存在 `/tmp/opencode`，`--refresh` 强制重拉。

## 3.1 获取模型列表与价格（models.dev）

[models.dev](https://models.dev/) 提供公开目录 `https://models.dev/api.json`，含 200+ provider、7000+ 模型，每个模型带：

| 字段 | 含义 |
| --- | --- |
| `cost.input` / `cost.output` | 输入/输出价（$/1M token）|
| `cost.cache_read` / `cost.cache_write` | 缓存读/写价 |
| `limit.context` / `limit.output` | 上下文 / 输出上限 |
| `tool_call` / `reasoning` / `attachment` / `open_weights` | 能力标记 |
| `modalities` | 输入/输出模态 |
| `release_date` / `last_updated` | 时间 |

`scripts/fetch-model-prices.py` 的流程：

1. 下载 `models.dev/api.json` → `docs/models.dev.json`
2. 下载三个补充源，补 models.dev 缺失的缓存价：

   | 源 | 地址 | 缓存字段 |
   | --- | --- | --- |
   | Requesty | `router.requesty.ai/v1/models` | `cached_price` / `caching_price` |
   | OpenRouter | `openrouter.ai/api/v1/models` | `input_cache_read` / `input_cache_write` |
   | LiteLLM | GitHub `model_prices_and_context_window.json` | `cache_read_input_token_cost` / `cache_creation_input_token_cost` |

3. 按归一化模型名合并（去掉 provider 前缀、`:free`/`:thinking` 等后缀、effort/harness/日期变体），**任一源有值即采用**
4. 仍缺失的按 1.3 节规则推导：`cache_read → 0.1×input`；`cache_write → Anthropic 1.25×input，其余 = input`

```bash
python3 scripts/fetch-model-prices.py            # 用缓存
python3 scripts/fetch-model-prices.py --refresh  # 重新下载
```

产出 `docs/models-prices.json`（把 models.dev 的缓存价覆盖率从 ~61%/20% 提到 ~98%）。

> **单位陷阱**：少数聚合 provider 在 models.dev 里存的是"每 token"而非"每 1M token"（如 `5e-12`）。匹配时对同名模型取**所有 provider 输入价的中位数**，自动滤掉这些离群值。

## 3.2 从榜单取质量分

`scripts/arena-cost.py` 抓 Arena WebDev 榜单页面，从内嵌 JSON 解析每个模型的 `rating`（质量分）、`votes`、`rank`：

```bash
python3 scripts/arena-cost.py                     # 默认 overall，Top 10
python3 scripts/arena-cost.py --category frontend
python3 scripts/arena-cost.py --top 5
python3 scripts/arena-cost.py --exclude Contributor
python3 scripts/arena-cost.py --refresh
```

流程：

1. 抓 `arena.ai/leaderboard/code/webdev/<category>`，正则提取 `modelKey`/`modelDisplayName`/`rating`/`votes`
2. 按归一化名匹配 `docs/models-prices.json`，未匹配的只报告、不参与计算
3. 写出 `scripts/models-arena-<category>.json`（含 `pin/pout/cr/cw/score/rank/votes`）
4. 调 `model-cost.py` 输出结果

## 3.3 计算（model-cost.py）

`scripts/model-cost.py` 是核心计算器，输入一份模型 JSON（含 `pin/pout`，可选 `cr/cw/score/budget`）：

```bash
python3 scripts/model-cost.py --file scripts/models-arena-overall.json --top 10
python3 scripts/model-cost.py --all                    # 全部，按选择顺序
python3 scripts/model-cost.py --exclude Contributor    # 排除 Contributor 模型
python3 scripts/model-cost.py --min-win 0.6 --ref 1450 # 可选质量门槛
python3 scripts/model-cost.py --h 0.9 --k 0.01         # 调缓存命中率/输出比
python3 scripts/model-cost.py --from-sessions          # 用真实会话实测 h/k
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--h` | 0.98 | 缓存命中率 |
| `--k` | 0.004 | 输出/总输入 token 比（输入含缓存读）|
| `--from-sessions` | 关 | 从 opencode 会话库实测 `h`/`k`，覆盖 `--h`/`--k` |
| `--sessions-db PATH` | 自动探测 | 会话库路径 |
| `--sessions-model SUBSTR` | 全部 | 只统计 model 字段匹配 SUBSTR 的会话 |
| `--ref` | 1350 | 胜率参照的基线分（配合 `--min-win`）|
| `--scale` | 400 | 胜率换算的 Elo 尺度 |
| `--min-win` | 0（关）| 质量门槛：胜率低于此值的模型先剔除 |
| `--top N` | 3 | 短名单大小 |
| `--exclude SUBSTR` | — | 按名称排除，可重复（不区分大小写）|
| `--sort price\|value` | — | 按综合价 / 性价比值列出全部模型 |
| `--top-percent PCT` | — | 配合 `--sort value`，只保留前 PCT% |
| `--budget` | — | 月额度，输出产能 `capM`（百万输入 token）|
| `--all` | — | 按选择顺序列出全部模型（含被支配）|
| `--file` | `models-arena-overall.json` | 输入模型 JSON（存在时）|

计算步骤：综合价 → Pareto 前沿 → ICER → 拐点 → Top-N 短名单。输出含 `xlow` 与 `dlow`。

### 实测 h / k（--from-sessions）

`h` 和 `k` 描述的是**工作负载**，不是模型，所以最好用你自己的会话数据实测。opencode 把每个会话的 token 统计存在 SQLite 的 `session` 表（`tokens_input`=新增输入、`tokens_cache_read`、`tokens_cache_write`、`tokens_output`），脚本据此计算：

```
total_input = tokens_input + tokens_cache_read + tokens_cache_write
h = tokens_cache_read / total_input
k = tokens_output     / total_input
```

```bash
python3 scripts/model-cost.py --from-sessions
python3 scripts/model-cost.py --from-sessions --sessions-model deepseek
python3 scripts/model-cost.py --from-sessions --sessions-db /path/opencode.db
```

会话库路径默认按 `$XDG_DATA_HOME/opencode/opencode.db` → `~/.local/share/opencode/opencode.db` → `/workspace/.opencode/data/**/opencode.db` 依次探测。实测值（本仓库环境 67 个会话）为 **h≈0.977、k≈0.0017**，与默认值 0.98/0.004 同量级。

> `tokens_input` 在库里是**新增（未命中缓存）输入**，与 CC 的"fresh prompt"一致。若某 provider 的计数口径不同（把缓存算进 input），实测 `h` 会被低估，此时用 `--sessions-model` 单独核对。

## 3.4 价格敏感场景怎么读结果

方法给出的是前沿与拐点，最终选谁取决于你的**质量底线**：

```
在 Pareto 前沿上，选「分数 ≥ 你的底线」里最便宜的那个
```

`--min-win` / `--ref` 可把底线显式化（低于门槛者先剔除），门槛内即是最便宜的合格模型。

**唯一剩下的主观输入**是"愿意为拐点之上的质量付多少"，这是业务决策，工具不替你决定。

## 3.5 更新 opencode 的模型配置

把选定的模型写进镜像的 opencode 配置（`opencode-config/opencode/opencode.jsonc`，`provider.commandcode.models`），让 opencode 能显示价格、成本估算与能力图标。

**模型集合怎么选**（可由脚本自动完成）：对 GOAT 目录按 `value = score/price` 取前 50%（`--exclude Contributor` 排除数据换价模型），再补上 Command Code 尚未评分但重要的新模型，以及零成本免费模型。`scripts/gen-commandcode-config.py` 一步生成：

```bash
python3 scripts/gen-commandcode-config.py             # 打印选中的模型（dry run）
python3 scripts/gen-commandcode-config.py --write     # 改写 opencode.jsonc 的 models 块
python3 scripts/gen-commandcode-config.py --top-percent 30 --write
```

它只替换 `provider.commandcode.models` 这一段，文件其余部分保持不变；自动从 Command Code API 取真实 `id`、从 `docs/models-prices.json` 补 `reasoning/tool_call/modalities/limit/release_date`。

**数据来源：**

| 字段 | 来源 |
| --- | --- |
| `cost.input` / `output` / `cache_read` / `cache_write` | GOAT 计划页 `https://commandcode.ai/docs/plans/goat` 的模型表（$/1M，低谷价；高峰 2 倍）|
| `id` | Command Code Provider API 的 `models` 端点，或 `commandcode.ai/models/<slug>` |
| `reasoning` / `tool_call` / `attachment` / `modalities` / `limit` / `release_date` | `docs/models-prices.json`（按归一化名匹配）|

**每个模型条目：**

```jsonc
"deepseek-v4-1-flash": {              // 内部 key（provider 后的名字）
  "name": "DeepSeek V4.1 Flash",      // 显示名
  "id": "deepseek/deepseek-v4.1-flash",// 发给 API 的真实 model id
  "release_date": "2026-09-10",
  "reasoning": true,                  // 是否推理模型
  "attachment": true,                 // 是否支持附件/图片输入
  "tool_call": true,                  // 是否支持工具调用（不是 "tools"）
  "modalities": { "input": ["text", "image"], "output": ["text"] },
  "limit": { "context": 1000000, "output": 32768 },
  "cost": { "input": 0.15, "output": 0.60, "cache_read": 0.003 }
}
```

**注意事项：**

- 字段名是 **`tool_call`**，不是 `tools`。写成 `tools` 会被静默忽略（opencode 不报错，但该模型被当作不支持工具调用）。这是配置里最容易搞错的一处。
- `cost` 必填 `input` / `output`，`cache_read` / `cache_write` 可选（Command Code 未单列缓存写时不填）。
- `limit` 必填 `context` / `output`。
- 默认模型在文件顶部的 `"model"` 与 `"small_model"` 字段（格式 `commandcode/<key>`）。

**改完后的验证与生效：**

```bash
# 1. JSONC 合法性（去掉纯注释行后解析）
python3 -c "import json;l=[x for x in open('opencode-config/opencode/opencode.jsonc').read().splitlines() if not x.strip().startswith('//')];json.loads('\n'.join(l));print('ok')"

# 2. 同步到运行卷（root FS 每次重启重置，烘焙配置才是持久源）
cp opencode-config/opencode/opencode.jsonc /workspace/.opencode/config/opencode/opencode.jsonc

# 3. 确认模型已加载
opencode models | grep commandcode/

# 4. 重启 opencode（配置不热重载）
```

> 镜像里 `/opt/opencode-config/` 是烘焙源，`entrypoint.sh` 启动时同步到 `$XDG_CONFIG_HOME/opencode/`。改仓库文件后需 commit + `railway up` 重新部署才会在线上生效；本地验证可直接 cp 到运行卷再重启。

---

# 四、脚本速查

| 脚本 | 作用 |
| --- | --- |
| `scripts/fetch-model-prices.py` | 拉 models.dev + Requesty/OpenRouter/LiteLLM，合并补齐缓存价 → `docs/models-prices.json` |
| `scripts/arena-cost.py` | 抓 Arena 榜单 + 匹配价格 → `scripts/models-arena-<category>.json`，并调用计算 |
| `scripts/model-cost.py` | 成本公式 + Pareto/ICER/拐点 + Top-N 输出 |
| `scripts/fetch-goat-models.py` | 抓 GOAT 计划页模型表 → `scripts/models-goat-catalog.json`（含价格/上下文/CC 智能分/速度）|
| `scripts/gen-commandcode-config.py` | 按 `value=score/price` 前 N% 选出模型 → 改写 opencode.jsonc 的 `models` 块 |

## 数据来源

- models.dev ：`https://models.dev/api.json`
- Arena WebDev 榜单：`https://arena.ai/leaderboard/code/webdev/<overall|frontend|fullstack>`
- 缓存定价规则：Anthropic 缓存读 = 10% 输入、缓存写（5min）= 125% 输入、1h = 200%；OpenAI 等自动缓存读 = 10% 输入、写 = 输入价