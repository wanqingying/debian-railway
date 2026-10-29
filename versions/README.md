# 版本锁定指导手册（BD）

> 一句话：这套开发环境里**所有开源组件**的版本被打包成一组、整体验证、整体升级。这一组版本叫一个 **BD（Bundle Distribution，捆绑版本）**。

本目录回答三个问题：**锁了什么**（组件清单）、**为什么锁这个版本**（`bd/` 下的 BD 文档）、**下次怎么升**（本手册的流程）。版本改动请先读这里，再动 `Dockerfile` / `scripts/install-tools.sh` / `opencode-config/`。

---

## 0. 为什么要锁

容器每次 redeploy 都会重建 `/usr`，组件全靠 npm / apt / 二进制下载安装。**不写版本号 = 每次构建都是一次没人评审过的升级**，而这条链上任何一个环节坏掉，表现都是"AI 栈静默失效"，不是明显的报错。已经踩过的坑：

| 事故 | 现象 | 根因 |
| --- | --- | --- |
| magic-context 停在 0.42.6 | 在 OpenCode 2 上发图片后，该会话**每一轮**都失败 | opencode 会把解析到的插件版本缓存进 `~/.cache/opencode/npm/<pkg>@<spec>/` 且不再重新解析 `@latest`（上游 #517，0.43.0 才修） |
| OpenChamber 升到 2.5.2 | 侧边栏 Tree 视图消失，多 worktree 项目基本没法用 | 上游改版**故意**移除（upstream #5669） |
| `@opencode/cli` 跟 `latest` | 某次 redeploy 后 OpenChamber 报 `Configured OpenCode binary not found`，降级成无 agent 模式 | v1/v2 包混用 + 版本对不齐 |

结论：**锁版本不是保守，是让故障面可预测**。要升级就升一整组（BD），并且能说清为什么升。

---

## 1. 三条原则

### P1 只锁「已经跑过一段时间」的版本

候选版本必须**已发布 ≥ 14 天**（大版本 `x.y.0` 需 ≥ 21 天），期间没有针对它的回归 issue。

理由：上游的 patch 往往在发布后 1~3 天内密集出现（本仓库实测 magic-context 0.49.x 连续 11 个 patch），半个月足以把"新版本自己引入的新问题"暴露在 issue 里。

### P2 落后 latest 约半个月

不做"追最新"，也不做"长期不动"。**目标 = 最新版往前推约 15 天的那个版本**。这样：
- 上游的问题已经在 issue 区被别人的血踩出来；
- 我们又不会落后到需要跨越 breaking change（配置迁移、DB schema、API 契约）。

### P3 只跟「影响本环境」的修复

不是所有 patch 都值得为它动一个 BD。判定标准：

| 情况 | 动作 |
| --- | --- |
| 安全漏洞（CVE / npm audit 高危）、数据损坏、会话静默中断、认证失败 | **立即跟车**（fast-follow，不等 BD 窗口） |
| 修的是本环境正在用的路径（OpenCode 2 宿主、openai-compatible provider、配置 schema、会话库） | 跟，记入 BD |
| 只修 Pi / Oh My Pi / Windows / 其它 harness、我们不用的 provider | **不跟**，攒到下一个 BD |
| 纯新功能 | 不主动跟；顺带进下一个 BD |

> 判断"只修别的 harness"要靠得住的证据，不能靠 release notes 的口气 —— 用 §3.4 的 compare API 看真实改动文件。

---

## 2. 需要锁定的组件清单

**跟随级别**定义：L0 = 改版即改变日常使用行为；L1 = 平时无感、出事才痛；L2 = 跟基础镜像走，只在故障时处理。

| 组件 | 包 / 来源 | 当前 BD 版本 | 锁点（唯一真值） | 级别 |
| --- | --- | --- | --- | --- |
| OpenCode（agent 本体） | `@opencode/cli` | `2.1.4` | `Dockerfile` 的 `npm i -g …@opencode/cli@<v>` + `scripts/install-tools.sh` 的 `OPENCODE_VERSION` | L0 |
| OpenChamber（Web UI / 托管 opencode） | `@openchamber/web` | `2.5.1` | `scripts/install-tools.sh` 的 `OPENCHAMBER_VERSION` | L0 |
| magic-context（上下文/记忆插件） | `@cortexkit/opencode-magic-context` | `0.49.21` | `opencode-config/opencode/opencode.jsonc` 的 `plugins` + `entrypoint.sh` 的 `MC_PLUGIN_CACHE_SPEC` | L0 |
| codegraph（代码索引 MCP） | `@colbymchenry/codegraph` | `1.6.2` | `Dockerfile` 的 `@colbymchenry/codegraph@<v>` + `scripts/install-tools.sh` 的 `CODEGRAPH_VERSION` | L1 |
| playwright（浏览器自动化：CLI + library） | `playwright` | `1.64.1` | `Dockerfile` 的 `playwright@<v>` + `playwright-cli` shim；接管入口 `scripts/pw` | L1 |
| pnpm | corepack | `11.22.0` | `scripts/install-tools.sh` 的 `corepack prepare pnpm@<v>` | L1 |
| Python / uv | apt + uv installer | Python `3.12.x` / uv 取 latest | `scripts/install-tools.sh` | L1 |
| Node.js | NodeSource `setup_24.x` | `24.x`（构建时最新 minor） | `Dockerfile` | L2 |
| Debian 基础镜像 | `debian:bookworm-slim` | 按 digest 钉住（`@sha256:99c0b25c…`） | `Dockerfile` `FROM` | L2 |
| ttyd | GitHub release 二进制 | `1.7.3` | `Dockerfile` | L2 |
| KasmVNC | GitHub release `.deb` | `1.5.0` | `scripts/install-tools.sh` 的 `KASMVNC_VERSION` | L2 |
| Doppler / Railway CLI / gh / neon | 各家 npm / apt | 启动时 latest | `scripts/install-tools.sh` | L2 |

**不锁的东西**（不要试图钉住）：模型 ID 与模型行为、`opencode-config/opencode/AGENTS.md` 里的提示词约定、各项目自己的依赖、QConfig 之类的远端配置。

> **一个版本出现在多处时，必须同 commit 一起改**：opencode 同时出现在 `Dockerfile`（真正生效）和 `install-tools.sh`（缺失时兜底）；magic-context 同时出现在 `opencode.jsonc`（装什么）和 `entrypoint.sh`（清缓存时保留哪个）。

---

## 3. 怎么判定「最新稳定版」

按顺序做，全程只读。命令都是本机可直接跑的（`curl` + `python3`，无需额外工具）。

### 3.1 先拉时间线

npm 包的发布时间线（判断"落后多少天"、patch 密度）：

```bash
curl -s https://registry.npmjs.org/@opencode/cli | python3 -c '
import json,sys
d=json.load(sys.stdin); t=d["time"]
for v,ts in sorted(((v,t[v]) for v in d["versions"] if v.startswith("2.")), key=lambda x:x[1]):
    print(v, ts[:19])'
```

GitHub 项目的 release 列表（正文才有"有没有 migration / breaking"）：

```bash
curl -s "https://api.github.com/repos/cortexkit/magic-context/releases?per_page=20" | python3 -c '
import json,sys
for r in json.load(sys.stdin):
    print(r["tag_name"], r["published_at"][:10], (r.get("body") or "").splitlines()[:2])'
```

### 3.2 release notes 只找三类信号

读的时候只关心：

1. **Breaking / Migration**：`breaking`、`migration`、`schema`、`no longer`、`removed`、`renamed`。出现即升级成本上升，宁可留在当前版本。
2. **我们踩的路径**：OpenCode 2 宿主、`openai-compatible` provider（我们的 commandcode）、配置文件形状、会话库、`opencode serve`。
3. **不影响我们的**：Pi / Oh My Pi / Windows / 其它 harness / 我们没开的 feature。这类越多，越说明这个版本对我们没价值。

### 3.3 扫 issue：候选版本有没有回归

按创建时间倒序看 open issue，标题里带版本号的优先：

```bash
curl -s "https://api.github.com/repos/cortexkit/magic-context/issues?state=open&per_page=50&sort=created&direction=desc" | python3 -c '
import json,sys
for i in json.load(sys.stdin):
    if i.get("pull_request"): continue
    print(i["number"], i["created_at"][:10], i["title"][:100])'
```

关注两类：**(a) 标题里写着候选版本号的 bug**；**(b) 我们的使用形态**（OpenCode 2 / 单实例 / 我们的 provider）。别人的 OMP、Windows、多实例问题可以忽略，但要在 BD 文档里记一句"已知、与我们无关"。

### 3.4 用 compare API 看真实改动范围

release notes 说"只修 Pi"，也要验证。这是判断"这个 patch 对我们是否为空"最硬的证据：

```bash
curl -s "https://api.github.com/repos/cortexkit/magic-context/compare/v0.49.21...v0.49.23" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("commits", d["total_commits"], "files", len(d["files"]))
for f in d["files"]: print(f["additions"], f["deletions"], f["filename"])'
```

判读：改动全落在我们不用的 harness 目录（如 `packages/pi-plugin`）、且主包只动了 `version` 字段 → 对我们**等价**，可以选更老、soak 更久的那个。

### 3.5 配置兼容性必须校验

升级 magic-context / opencode 后，配置文件要对着**该 tag 的 schema** 校验，不能只看"能启动"：

```bash
# magic-context：仓库里的 schema 与其 docs 是同一份
curl -s https://raw.githubusercontent.com/cortexkit/magic-context/<tag>/assets/magic-context.schema.json -o /tmp/mc.schema.json
# opencode：
curl -s https://opencode.ai/config.json -o /tmp/oc.schema.json
```

再用 JSON Schema 校验器跑一遍（去注释 → `jsonschema`），同时扫一遍 **已废弃键**：OpenCode 2 对每个退役键**每次解析配置**都会重新诊断，留着会刷爆日志并吃满 CPU（本仓库曾因此 ~750 行/秒）。

### 3.6 判定表

| 证据 | 结论 |
| --- | --- |
| ≥14 天、无同版本回归 issue、改动落在我们在用的路径且是修复 | **可以进下一个 BD** |
| ≥14 天、但改动全在无关 harness | 可以进，但优先级最低（等下一个 BD 顺带） |
| <14 天 | **观望**，记入 BD 文档"观察项"，下次再看 |
| 有同版本回归 issue 未修 | **不升**；若已升则准备回滚 |
| 带 breaking / migration | 单独立项评估，不要混在常规 BD 里 |

---

## 4. 更新流程（SOP）

1. **确定窗口**：距上一个 BD ≥ 4 周，或出现 §P3 的跟车事件。
2. **候选清单**：按 §3 对每个 L0 组件跑一遍，得到"候选版本 + 证据链接"。
3. **组合校验**：先查版本互相约束 —— 例如 OpenChamber 的 `server/lib/opencode/compatibility.js` 里有 `MINIMUM_OPENCODE_VERSION`；magic-context 对 OpenCode 有最低版本要求（0.49.17 起才支持 OpenCode 2.1.x）。**约束不满足时降 OpenCode，不要单独升 OpenChamber**。
4. **落地**：按下表把该改的地方一次改完（漏一处 = 版本分裂）。
5. **验证**：按 §6 清单在容器里过一遍。
6. **写 BD 文档**：`versions/bd/BD-<nnn>.md`（从 `_TEMPLATE.md` 复制），更新 `versions/BD-INDEX.md`。
7. **观察期**：部署后 3~7 天。出现回归 → 先回滚 BD，再把原因写进 BD 文档的"已知问题"，避免下个 BD 再踩。
8. **同步下游**：观察期无回归后，把同一组锁点搬到 `trn-bff-devcontainer-demo`（见 §9），并在 `BD-INDEX.md` 的「下游同步」列打勾。

### 锁点同步清单

| 升级对象 | 必须一起改 |
| --- | --- |
| opencode | `Dockerfile` 的安装行、`scripts/install-tools.sh` 的 `OPENCODE_VERSION` |
| OpenChamber | `scripts/install-tools.sh` 的 `OPENCHAMBER_VERSION` |
| magic-context | `opencode-config/opencode/opencode.jsonc` 的 `plugins`、`entrypoint.sh` 的 `MC_PLUGIN_CACHE_SPEC` |
| 任何一个 L0 | `versions/bd/BD-<nnn>.md`、`versions/BD-INDEX.md`、`README.md` 的版本表、`AGENTS.md` 的版本说明 |

---

## 5. 跟车（fast-follow）

只有 §P3 第一档（安全 / 数据损坏 / 会话中断 / 认证）走这条路：

1. 不改 BD 号，直接在当前 BD 上打补丁版本，BD 文档记一行 `fast-follow: <日期> <组件> <旧→新> <原因 + 链接>`。
2. 只升**那一个**组件，不做顺带升级。
3. 上线后 24 小时内确认核心链路（聊天一轮、技能调用、会话持久化）。

---

## 6. 验证清单

改完版本后，在容器里按顺序过：

```bash
# 1) 版本是否真的生效（注意：Dockerfile 的烘焙安装通常才是真正生效的那个）
opencode --version; openchamber --version; node -v; pnpm -v
cat /workspace/.opencode/config/opencode/opencode.jsonc | grep -A2 '"plugins"'

# 2) 配置诊断：0 error、0 deprecated key（启动日志里不应有 configuration normalization diagnostic）
# 3) magic-context 实际加载的版本（缓存的目录名就是钉住的 spec）
ls -d ~/.cache/opencode/npm/@cortexkit/opencode-magic-context@*/ 2>/dev/null
```

功能面（人工）：

- [ ] OpenChamber 能打开，侧边栏布局符合预期（Tree / works 视图，见 BD 的 Hold 清单）
- [ ] 新建会话 → 发一条消息 → 正常返回
- [ ] 会话库持久化：重启容器后历史仍在
- [ ] magic-context：`/ctx-status` 正常；发一张图片不炸会话
- [ ] codegraph MCP：`codegraph status` 可用
- [ ] 终端 / 浏览器（KasmVNC）可用

---

## 7. 回滚

- 整组回滚：`git revert <BD commit>` 后重新 `railway up`。
- 单组件临时回滚（不改代码）：`OPENCODE_VERSION=<v>` / `OPENCHAMBER_VERSION=<v>` 环境变量覆盖启动安装；opencode 若走的是 Dockerfile 烘焙副本，还要重新构建。
- 插件回滚：只改 `opencode.jsonc` 的 `plugins` spec 即可，`entrypoint.sh` 会自动清掉不匹配的缓存。

---

## 8. 已知陷阱

- **`@latest` 插件的缓存会永久钉住**：opencode 解析一次就把版本写进 `~/.cache/opencode/npm/<pkg>@<spec>/`，不再重新解析。所以插件一律写**精确版本**；`entrypoint.sh` 里还保留了"清掉非当前版本缓存"的兜底。
- **OpenChamber 有最低 OpenCode 版本门禁**：不满足时 UI 能开、发消息无响应。
- **不要把退役的 v1 配置键加回 `opencode.jsonc`**（`provider`/`plugin`/`permission`/`autoupdate`、模型上的 `release_date`/`reasoning`/`attachment` 等）。
- **magic-context 与 opencode 的会话库代际绑定**：v1 的 `opencode.db` 会被拒绝（`expected v2, found v1`），`entrypoint.sh` 会自动改名备份。
- **`tool_output`/`watcher` 之类字段名在 v2 没变，但 `tui.jsonc` → `cli.json` 变了**：终端侧配置不在本仓库维护范围内。

---

## 9. 跨项目同步：一个 BD 要落到两个仓库

BD 登记册只在 `debian-railway`，但**同一组版本要在两个项目里同时生效**：

| 项目 | 定位 | 谁先动 |
| --- | --- | --- |
| `debian-railway`（本仓库） | BD 的**定义**所在：登记册 + 生产容器的镜像与启动脚本 | **先升级这个** |
| `trn-bff-devcontainer-demo` | 团队开发容器的**下游消费方**（`.devcontainer/`），同一套 opencode / OpenChamber / magic-context | 等这里的 BD 合并、观察期无回归后，再同步过去 |

**顺序不能反**：railway 是 BD 的真值所在，先在这里把版本、锁点、验证、记录全部定下来；devcontainer 只做"照抄锁点"。反过来先改 devcontainer，就会出现"开发容器跑的版本在 BD 里查不到"，下次升级没人知道基线是什么。

### 同步映射（改一处就要改另一处）

| 组件 | `debian-railway` 锁点 | `trn-bff-devcontainer-demo` 锁点 |
| --- | --- | --- |
| opencode | `Dockerfile` 安装行 + `scripts/install-tools.sh` 的 `OPENCODE_VERSION` | `.devcontainer/init.sh` 的 `OPENCODE_VERSION` |
| OpenChamber | `scripts/install-tools.sh` 的 `OPENCHAMBER_VERSION` | `.devcontainer/init.sh` 的 `OPENCHAMBER_VERSION` |
| magic-context | `opencode-config/opencode/opencode.jsonc` 的 `plugins` + `entrypoint.sh` 的 `MC_PLUGIN_CACHE_SPEC` | `.devcontainer/opencode/opencode.jsonc` 的 `plugins` + `.devcontainer/init.sh` 的 `MC_PLUGIN_CACHE_SPEC` |
| 版本说明 | `README.md` 版本表 + `AGENTS.md` | `README.md` 的「自动升级」行 |

### 同步后的核对

- `plugins` 的 spec **逐字符一致**（含版本号），两边都不能写 `@latest`。
- 两边都用"删掉非当前 spec 的缓存"实现（不是只删 `@latest` 目录）。
- 三处版本说明（railway `README.md` / railway `AGENTS.md` / devcontainer `README.md`）与 `BD-INDEX.md` 的当前 BD 一致。
- 两个仓库的提交各自独立，但**同一个 BD 里要成对出现**；`BD-INDEX.md` 的「下游同步」列记录 devcontainer 是否已跟上。

---

## 10. 目录与命名

```
versions/
├── README.md          # 本手册（原则、清单、流程）
├── BD-INDEX.md        # BD 时间线 + 当前生效 BD + 活跃 Hold 清单
└── bd/
    ├── _TEMPLATE.md   # 新 BD 从这里复制
    └── BD-001.md      # 每个 BD 一份：版本矩阵 + 为什么 + 验证 + Hold
```

- **BD 编号**：`BD-001`、`BD-002`… 单调递增，**不复用、不重排**；日期写在文档头部，编号不承载日期语义。
- **BD 文档只增不改**：升级后旧 BD 文档保持原样，把状态改成 `superseded by BD-0NN`。它是历史证据，不是当前状态。
- **当前状态**永远看 `BD-INDEX.md`。
