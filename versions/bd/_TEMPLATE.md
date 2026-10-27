# BD-0NN

> 复制本文件到 `versions/bd/BD-<nnn>.md`，替换所有 `<...>`；写完更新 `versions/BD-INDEX.md`。

| 项 | 值 |
| --- | --- |
| 状态 | `current` / `superseded by BD-0NN` |
| 冻结日期 | `<YYYY-MM-DD>` |
| 上一个 BD | `BD-0NN` |
| 下一个 BD | 待定（窗口：`<YYYY-MM-DD>` 之后，或出现 fast-follow 事件） |
| 冻结依据 | `<为什么现在做这个 BD：窗口到期 / 跟车事件 / 上游 breaking>` |

## 版本矩阵

| 组件 | 版本 | 发布日 | 锁点 | 满足 P1（≥14 天） |
| --- | --- | --- | --- | --- |
| `@opencode/cli` | `<v>` | `<date>` | `Dockerfile` + `scripts/install-tools.sh` | ✅/❌（N 天） |
| `@openchamber/web` | `<v>` | `<date>` | `scripts/install-tools.sh` | ✅/❌ |
| `@cortexkit/opencode-magic-context` | `<v>` | `<date>` | `opencode.jsonc` + `entrypoint.sh` | ✅/❌ |

## 为什么是这些版本

### `<组件> <版本>`

- 上一 BD 的版本：`<v>`（落后 `<n>` 天 / `<n>` 个 patch）
- 升级理由：`<修了我们踩的哪条路径 / 安全 / 约束要求>`
- 证据：`<release 链接>`、`<issue 链接>`、`<compare API 结论>`
- 风险与缓解：`<breaking / migration / 观察项>`

## 与上一个 BD 的差异

| 组件 | 旧 | 新 | 类型 |
| --- | --- | --- | --- |
| `<组件>` | `<旧>` | `<新>` | 升级 / 保持 / 降级（原因） |

## 关键捆绑细节

- `<版本互相约束，例如 OpenChamber MINIMUM_OPENCODE_VERSION>`
- `<多处锁点必须同 commit 改的地方>`
- `<升级后必须同步改动的东西：配置 schema、缓存清理、文档>`

## Hold（刻意不升级）

| 组件 | 保持 | 暂不升到 | 原因 | 证据 | 解除条件 |
| --- | --- | --- | --- | --- | --- |
| `<组件>` | `<v>` | `<v>` | `<一句话>` | `<issue / PR 链接>` | `<什么情况下可以升>` |

## 验证记录

| 项 | 结果 |
| --- | --- |
| `opencode.jsonc` 对 `https://opencode.ai/config.json` | `<0 error / 0 deprecated>` |
| `magic-context.jsonc` 对 `<tag>` 的 schema | `<0 error / 0 deprecated>` |
| `bash -n` 脚本语法 | `<通过>` |
| 容器内功能清单（见手册 §6） | `<通过 / 未做>` |

## 观察项（下个 BD 必看）

- `<组件> <观察什么>`
