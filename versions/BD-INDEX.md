# BD 索引

> 当前生效的 BD 与历史时间线。**判断"这台容器应该跑什么版本"只看本文件**；细节去 `bd/BD-<nnn>.md`。

## 当前生效

| 项 | 值 |
| --- | --- |
| BD | [BD-003](bd/BD-003.md)（r1） |
| 冻结日期 | 2026-11-09 |
| 状态 | `current`（观察期 3~7 天，见[手册 §4](../README.md)） |

## 时间线

| BD | 冻结日期 | opencode | OpenChamber | magic-context | codegraph | playwright | 状态 | 下游同步（devcontainer-demo） | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [BD-001](bd/BD-001.md) | 2026-10-27 | 2.1.4 | 2.5.1 | 0.49.21 | —（当时未锁） | — | `superseded by BD-002` | ✅ 已同步 | 首次冻结：锁住容器当时实际在跑的组合 |
| [BD-001](bd/BD-001.md)（r1） | 2026-10-29 | 2.1.4 | 2.5.1 | 0.49.21 | **1.6.2** | — | `superseded by BD-002` | ✅ 已同步 | codegraph 从"未锁、每次启动跟随上游"改为精确锁定；`CODEGRAPH_UPGRADE` 默认改为 `0` |
| [BD-001](bd/BD-001.md)（r2） | 2026-10-29 | 2.1.4 | 2.5.1 | 0.49.21 | 1.6.2 | **1.64.1** | `superseded by BD-002` | ✅ 已同步 | 新增 `playwright`（L1）：CLI + library，不下载浏览器，只用 CDP 接管容器内 KasmVNC 的 Chromium |
| [BD-002](bd/BD-002.md) | 2026-11-03 | **2.2.5** | 2.5.3 | **0.49.34** | 1.6.2 | 1.64.1 | `superseded by BD-002 (r1)` | —（下游直接跳到 r2） | 首次按"证据判定、不看发布天数"的规则组合：两个 L0 各因一个未修重大 bug 取次新版本。已实际部署并验证运行正常 |
| [BD-002](bd/BD-002.md)（r1） | 2026-11-03 | 2.2.5 | **2.6.0** | 0.49.34 | 1.6.2 | 1.64.1 | `superseded by BD-002 (r2)` | —（下游直接跳到 r2） | owner 决定 OpenChamber 直接跟 latest：解除它的 Hold，两个未修回归改为"已知并接受"（#6131 问答表单、#6084 git 探测风暴） |
| [BD-002](bd/BD-002.md)（r2） | 2026-11-03 | 2.2.5 | **2.6.0（fork 构建）** | 0.49.34 | 1.6.2 | 1.64.1 | `superseded by BD-003` | ✅ 已同步（2026-11-04） |
| [BD-003](bd/BD-003.md) | 2026-11-09 | **2.2.6** | **2.7.0（fork 构建）** | **0.49.43** | 1.6.2 | **1.65.0** | `superseded by BD-003 (r1)` | ⏳ 待同步 | 一次跳到当时全部 latest：两个旧 Hold（#838、#6131）均解除；fork 补丁零冲突 rebase 到 v2.7.0 |
| [BD-003](bd/BD-003.md)（r1） | 2026-11-09 | 2.2.6 | **2.7.0（fork 构建，第 2 个补丁）** | 0.49.43 | 1.6.2 | 1.65.0 | `current` | ⏳ 待同步（新 sha256） | 版本矩阵不变，只换 fork 产物：新增 `fix(ui-blocks): write root last in the guidance and its examples`（3fdff97fc），tarball sha256 `22ec02bd…` |

> 「下游同步」= 同一组锁点已落到 `trn-bff-devcontainer-demo`（顺序与核对项见[手册 §9](README.md)）。没打勾说明该 BD 只在 railway 生效，两个容器行为会不一致。

## 活跃 Hold（刻意不升级）

当前**无活跃 Hold**。

上一条（magic-context 停在 `0.49.34`、不升 `0.49.35`）已解除：其阻断项 [#838](https://github.com/cortexkit/magic-context/issues/838)（host fold 给无历史子会话写空摘要，OpenCode 2.2 每轮被 `Schema validation failed` 拒绝）于 2026-11-06 关闭，BD-003 直接取 `0.49.43`，并拿回 host fold 的长会话提速（25k 消息会话实测 1.3–2.0s → 0.33–0.49s/step）。[#834](https://github.com/cortexkit/magic-context/issues/834)（每 pass 复制全量历史 2–3 次）仍 open，但已不阻断升级。

> **BD-002 起接受的取舍**：OpenChamber 的侧栏 Tree/List 切换在 2.5.2 被上游**故意**移除（[#5669](https://github.com/openchamber/openchamber/issues/5669)），而 2.5.1 装不上 opencode 2.2，所以升级 opencode 就必须接受"works"式侧栏。BD-002 r1 起跑 2.6.0，它的自定义 sections（可按项目分组、可按 `kind=worktree` 过滤）就是这条取舍的替代方案；此外还有**钉住 worktree**与**按分支命名 worktree**。r2 起镜像装的是**本仓库 fork 的 2.6.0 构建**：2.6.0 源码 + `sidebarGroupRootWorktrees`（worktree 分组开关，默认开），因此不再依赖 sections 绕开混排。

> **r1 的取舍由谁定**：2.6.0 的两个未修回归（#6131、#6084）在 r0 时被写进 Hold；r1 由 owner 判断"BD 可回退、新 UI 值得"，解除 Hold 并改为"已知并接受"（记录在 `BD-002.md`）。这不是规则失效——规则仍是默认，override 必须落到 BD 文档里留痕。

## 观察项（下个 BD 必看）

| 组件 | 观察什么 |
| --- | --- |
| OpenChamber | #6084（主进程 ~3 git/s）是否修（2.7.0 仍 open，盯 `pids.current`）；上游 #5669（Tree 视图）是否重开或给出分组方案，届时可评估丢弃 fork 补丁；`MINIMUM_OPENCODE_VERSION` 是否再次抬升（2.7.0 仍是 2.2.4）；2.7.x 新增的 `sherpa-onnx-node` / `7zip-bin` 对镜像体积与常驻内存的实际影响 |
| magic-context | #834（每 pass 全量复制）是否修；0.50 线何时出现；host fold 重新开启后长会话与**子会话**是否稳定（#838 的触发路径，本 BD 观察期的重点） |
| opencode | 2.2.x 的 patch 密度与同版本回归 issue；`@opencode/ai` / OpenTUI 的 breaking 是否波及我们的本地插件（`sysinfo`、`session-search`）；2.2.6 的 MCP `pool: true` 是否值得为内网网关开启 |
| codegraph / playwright | 两者当前都是 latest；codegraph 1.6.2 自 10-03 未动，留意上游发布节奏 |
