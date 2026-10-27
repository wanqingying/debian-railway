# BD 索引

> 当前生效的 BD 与历史时间线。**判断"这台容器应该跑什么版本"只看本文件**；细节去 `bd/BD-<nnn>.md`。

## 当前生效

| 项 | 值 |
| --- | --- |
| BD | [BD-001](bd/BD-001.md) |
| 冻结日期 | 2026-10-27 |
| 状态 | `current`（观察期至 2026-11-03） |

## 时间线

| BD | 冻结日期 | opencode | OpenChamber | magic-context | 状态 | 下游同步（devcontainer-demo） | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [BD-001](bd/BD-001.md) | 2026-10-27 | 2.1.4 | 2.5.1 | 0.49.21 | `current` | ✅ 已同步 | 首次冻结：锁住容器当时实际在跑的组合 |

> 「下游同步」= 同一组锁点已落到 `trn-bff-devcontainer-demo`（顺序与核对项见[手册 §9](README.md)）。没打勾说明该 BD 只在 railway 生效，两个容器行为会不一致。

## 活跃 Hold（刻意不升级）

| 组件 | 保持 | 暂不升到 | 原因 | 解除条件 |
| --- | --- | --- | --- | --- |
| OpenChamber | `2.5.1` | `2.5.2` | 2.5.2 的 works 侧边栏移除了 Tree/List 切换（project → worktree → sessions），多 worktree 项目的日常使用体验明显变差；上游 [#5669](https://github.com/openchamber/openchamber/issues/5669) 已确认是**故意改版**，目前无恢复方案 | 上游重新提供 Tree 视图 / worktree 分组排序，或被我们接受的替代方案 |
| codegraph | 未锁 | — | 构建取 latest、`CODEGRAPH_UPGRADE=1` 时每次启动再升级。属于 L1 工具，故障可见（`codegraph status` 直接报错），暂不纳入 BD | 出现"静默失败"类故障时改为精确版本 |

## 观察项（下个 BD 必看）

| 组件 | 观察什么 |
| --- | --- |
| opencode | 2.1.x 是否出现回归 issue；`@opencode/cli` 的 patch 密度 |
| OpenChamber | 2.5.2 之后是否恢复 Tree 视图；`MINIMUM_OPENCODE_VERSION` 是否抬升 |
| magic-context | 0.49.21 在 OpenCode 2.1.4 上的长期表现（尤其 openai-compatible provider 路径）；上游是否有 0.50 线 |
| codegraph | 是否需要从"跟随升级"改成"精确锁定" |
