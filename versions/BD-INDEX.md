# BD 索引

> 当前生效的 BD 与历史时间线。**判断"这台容器应该跑什么版本"只看本文件**；细节去 `bd/BD-<nnn>.md`。

## 当前生效

| 项 | 值 |
| --- | --- |
| BD | [BD-001](bd/BD-001.md) |
| 冻结日期 | 2026-10-27 |
| 状态 | `current`（观察期至 2026-11-03） |

## 时间线

| BD | 冻结日期 | opencode | OpenChamber | magic-context | codegraph | 状态 | 下游同步（devcontainer-demo） | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [BD-001](bd/BD-001.md) | 2026-10-27 | 2.1.4 | 2.5.1 | 0.49.21 | —（当时未锁） | `current` | ✅ 已同步 | 首次冻结：锁住容器当时实际在跑的组合 |
| [BD-001](bd/BD-001.md)（修订 r1） | 2026-10-29 | 2.1.4 | 2.5.1 | 0.49.21 | **1.6.2** | `current` | ✅ 已同步 | codegraph 从"未锁、每次启动跟随上游"改为精确锁定；`CODEGRAPH_UPGRADE` 默认改为 `0` |

> 「下游同步」= 同一组锁点已落到 `trn-bff-devcontainer-demo`（顺序与核对项见[手册 §9](README.md)）。没打勾说明该 BD 只在 railway 生效，两个容器行为会不一致。

## 活跃 Hold（刻意不升级）

| 组件 | 保持 | 暂不升到 | 原因 | 解除条件 |
| --- | --- | --- | --- | --- |
| OpenChamber | `2.5.1` | `2.5.2` | 2.5.2 的 works 侧边栏移除了 Tree/List 切换（project → worktree → sessions），多 worktree 项目的日常使用体验明显变差；上游 [#5669](https://github.com/openchamber/openchamber/issues/5669) 已确认是**故意改版**，目前无恢复方案 | 上游重新提供 Tree 视图 / worktree 分组排序，或被我们接受的替代方案 |

> codegraph 曾在 Hold 表里（"未锁、跟随上游，L1 工具故障可见"）。那条已于 **2026-10-29 撤销**并改为精确锁定 `1.6.2`：
> 一个未锁版本、又每次启动自我升级的工具，等于一个容器里两个变量；一次 redeploy 就能悄悄改变 agent 的代码索引方式，
> 而且这种变化不会报错。烘焙镜像的前提是"镜像即真值"，所以它现在和其他组件一样走 BD 流程升级。

## 观察项（下个 BD 必看）

| 组件 | 观察什么 |
| --- | --- |
| opencode | 2.1.x 是否出现回归 issue；`@opencode/cli` 的 patch 密度 |
| OpenChamber | 2.5.2 之后是否恢复 Tree 视图；`MINIMUM_OPENCODE_VERSION` 是否抬升 |
| magic-context | 0.49.21 在 OpenCode 2.1.4 上的长期表现（尤其 openai-compatible provider 路径）；上游是否有 0.50 线 |
| codegraph | 1.6.2 是否出现索引/查询回归；上游发布节奏（它曾长期快速迭代，锁定后需要定期主动评估是否升级） |
