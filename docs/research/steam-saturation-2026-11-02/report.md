# Steam 品类饱和度：哪些赛道已经挤满

**问题：** 当前 Steam 各品类的市场饱和度如何？哪些应该避开？
**日期：** 2026-11-02  **口径：** 全站存量 + 2026 新作 + 中位收入 + 自采样本

## 一句话

**“在售数量”不是饱和度，`<$5k 占比` 才是。** 一个 tag 里有多大比例的游戏连 5,000 美元毛收入都拿不到，直接说明新进入者被淹没的概率。

按这个口径，最该避开的是：**PvP、2D Platformer、PvE、极简主义、线性、街机、俯视、3D、Casual、物理**——它们的 `<$5k 占比` 在 76%–86%，中位收入 $150–$400。

相对最宽松的是：**Sandbox（55%）、Management（57%）、Co-op（57%）、Open World（57%）、Story Rich（58%）**——但“不拥挤”往往意味着“体量大”或“门槛在别处”，不是免费的机会。

## 方法

三个独立指标，缺一不可：

1. **存量供给**：该 tag 在 Steam 上的在售游戏数（games-stats 全站统计）[S2]。
2. **需求水平**：该 tag 的中位毛收入（不是平均——平均被头部拉爆）[S2][S1]。
3. **淘汰率**：该 tag 中毛收入低于 $5,000 的游戏占比 [S2]。**这是最接近“饱和度”的单一数字。**
4. **交叉验证**：我们自己采集的 646 款 2026 年 Indie 样本，按 tag 统计“零评测率”[S4]——衡量的是“能不能被看见”，与收入互补。

补充背景：2026 上半年 Steam 上线近 1.2 万款新作，**67% 毛收入低于 $1,000**，中位 $196；只有 1.2% 超过 100 万美元 [S3]。所以“避开拥挤”不是为了提高上限，是为了不成为那 67%。

## 一、全站存量与淘汰率（在售 ≥ 1 万款的 tag）

按 `<$5k 占比` 从低到高排列（越低越宽松）：

| tag | 在售数 | 中位毛收入 | <$5k 占比 | 判断 |
|---|---:|---:|---:|---|
| Sandbox | 12,639 | $2,900 | **55%** | 最宽松，但体量大 |
| Management | 13,609 | $2,500 | **57%** | 宽松，系统型友好 |
| Co-op | 13,571 | $2,300 | 57% | 宽松，但要做联机 |
| Open World | 14,535 | $2,100 | 57% | 宽松是假象：成本极高 |
| Story Rich | 34,243 | $2,500 | 58% | 需求稳，吃文本与演出 |
| Female Protagonist | 18,125 | $2,200 | 59% | 标签红利，非品类 |
| Anime | 20,584 | $2,000 | 60% | 吃美术 |
| Visual Novel | 15,714 | $2,000 | 62% | 吃美术与文本 |
| RPG | 36,889 | $1,400 | 63% | 大盘，竞争重 |
| Resource Management | 12,103 | $1,500 | 64% | 系统型友好 |
| Simulation | 45,083 | $1,300 | 65% | 大盘，中位尚可 |
| Psychological Horror | 15,539 | $1,500 | 65% | 中位不错，但靠氛围 |
| Action RPG | 11,316 | $960 | 66% | 动作门槛 |
| Roguelite | 15,121 | $1,100 | 67% | 已挤 |
| Horror | 23,104 | $1,100 | 68% | 已挤，且音频门槛 |
| Roguelike | 15,528 | $1,100 | 68% | 已挤 |
| FPS | 12,340 | $760 | 68% | 手感门槛 |
| First-Person | 33,272 | $920 | 69% | 大盘 |
| Adventure | 77,005 | $1,100 | 69% | 超大池子 |
| Survival | 15,582 | $760 | 69% | 已挤 |
| Strategy | 42,450 | $690 | 70% | 大盘，中位偏低 |
| Point & Click | 12,650 | $960 | 70% | 小众稳定 |
| Action Roguelike | 11,268 | $570 | 73% | 重度拥挤 |
| Action | 81,224 | $570 | 74% | 最大池子之一 |
| Shooter | 20,922 | $420 | 74% | 拥挤 |
| 2D | 68,959 | $460 | 76% | 介质标签，非品类 |
| Puzzle | 35,980 | $610 | 76% | 量大价低 |
| Physics | 15,469 | $400 | 76% | 拥挤 |
| 3D | 56,932 | $380 | 77% | 介质标签，非品类 |
| Platformer | 18,690 | $400 | 77% | 拥挤 |
| Casual | 84,758 | $400 | 79% | 最挤的大池子 |
| Top-Down | 20,945 | $310 | 80% | 视角标签 |
| Arcade | 27,057 | $300 | 81% | 拥挤 |
| PvE | 18,375 | $230 | 81% | 拥挤 |
| 2D Platformer | 15,163 | $230 | 83% | 最不赚钱的常见品类 |
| Linear | 17,288 | $290 | 84% | 拥挤 |
| Minimalist | 13,000 | $270 | 86% | 最拥挤 |
| PvP | 15,324 | $150 | 78% | 中位最低 |

## 二、四个象限

把“中位收入”和“淘汰率”交叉：

|  | 淘汰率低（<65%） | 淘汰率高（≥70%） |
|---|---|---|
| **中位 ≥ $1,500** | **机会区**：Sandbox、Management、Co-op、Story Rich、Anime、Visual Novel、Resource Management、Psychological Horror | **头部区**：Horror、Roguelike 的部分子类（靠爆款，中位被拉低） |
| **中位 < $1,500** | **稳定区**：Simulation、RPG、Adventure、Point & Click | **红海**：Action、Casual、Puzzle、Platformer、PvP、PvE、Arcade、Physics、Top-Down |

- **机会区**不是“没人做”，而是“做的人少 + 中位还行”。代价通常是：要么体量大（Sandbox/Open World/Co-op），要么吃某种专门能力（Story Rich 吃写作，Anime/VN 吃美术）。
- **红海**的特征是“进入成本低 + 中位极低”，AI 还在加速供给（2024–2026 新作增长里 60–90% 是 AI 披露游戏）。

## 三、为什么“数量少”不等于“不拥挤”

三个反例：

1. **Open World**：`<$5k` 只有 57%，看起来宽松；但它中位 $2,100 是团队级预算撑起来的，单人进入等于用 1/10 的资源打同一场仗。
2. **Co-op**：57%，但联机、同步、匹配、反作弊是另一条工程线。
3. **Visual Novel / Anime**：60%–62%，但这两个 tag 的竞争力几乎全在美术与文本，正是 AI 难以差异化、玩家最容易一眼分辨的地方。

反过来，**Management / Sandbox / Resource Management** 是少数“淘汰率低、中位尚可、且不靠美术”的交集——这也是上一份 3D 低模报告里 T1 品类的数据来源。

## 四、怎么自己判断一个 tag 挤不挤

按顺序看四个数：

1. **`<$5k 占比`**：>75% 直接放弃；<60% 再往下看。
2. **近 12 个月新增数**：存量少但新增暴涨 = 正在变挤（AI 让供给曲线变陡）。
3. **头部集中度**：前 1% 拿走 90%+ 收入的 tag，中位收入再高也与你无关。
4. **价格带**：如果该 tag 的主流价格在 $5 以下，说明玩家把它当“消耗品”，你的 ¥30 定价会被直接对比。

## 五、给“避开拥挤”的三条可执行结论

1. **不要选 Action / Casual / Puzzle / Platformer / PvP / PvE / Arcade 作为主 tag**：淘汰率 74%–86%，中位 $150–$610，且 AI 供给还在涌入。
2. **不要被“Open World / Co-op 淘汰率低”骗**：那是预算与工程量的问题，不是机会。
3. **在“机会区”里找细分，而不是在“红海”里找差异化**：Management 里找“某个具体行业”、Sandbox 里找“某种物理”、Resource Management 里找“某种物流”——细分能让你的商店页被准确归类，而不是和大池子抢同一个推荐位。

## 局限

- 中位收入与淘汰率来自第三方估算（games-stats 基于全站在售游戏），误差可能有 ±20–30%；tag 之间大量重叠，同一款游戏会计入多个 tag。
- 存量包含多年历史，不等于“今年的竞争”；新增速度要用近 12 个月数据单独看。
- 我们的 646 款样本是 2026 年 Indie 新作，tag 级 n=12–189，单 tag 置信区间约 ±8–15pp。
- 统计不能告诉你“哪个品类缺一个好游戏”——那需要看差评内容与愿望单，而不是看中位数。

## Sources

| ID | Source |
|---|---|
| S1 | [What does the median game in your genre earn on Steam? — Immutable（107 个细分 tag 中位销量/收入）](https://www.immutable.com/insights/steam-genre-revenue-benchmarks) |
| S2 | [Steam Tags Stats — games-stats（全站 tag 数量、中位收入、<$5k 分布）](https://games-stats.com/steam/tags/) |
| S3 | [Steam Genre Benchmark — App2top（2026 上半年新作与收入分布）](https://app2top.com/analytics/steam-genre-benchmark-inequality-index-oversaturated-niches-top-grossing-categories-anomalies-and-perennial-underdogs-295050.html) |
| S4 | 自采：`docs/research/steam-ai-revenue-2026-11-02/`（646 款 2026 Indie 样本的 tag 级零评测率） |
| S5 | [Rethinking Steam Saturation — Game Oracle（销量 vs 竞争密度）](https://www.game-oracle.com/blog/surprising-undersaturated-steam-categories) |
