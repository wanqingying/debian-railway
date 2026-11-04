# Godot 的 Agent 辅助开发工具与 MCP 生态

**问题：** Godot 有没有给 agent 用的工具 / MCP？
**日期：** 2026-11-03 · **Godot 版本基准：** 4.7.2-stable（2026-08-18）

## 结论

**有，而且是所有引擎里 MCP 生态最拥挤的一个**（GitHub 搜 “godot mcp” 有 700+ 仓库，前十个从 300 到 6,500 star）。

但真正该问的不是“有没有”，而是**你要 agent 碰哪一层**。四层能力决定了选型：

| 层 | 能力 | 没有它会怎样 |
|---|---|---|
| ① 改项目 | 建/改场景、节点、脚本、资源 | agent 只能手改 `.tscn` 文本，易出错 |
| ② 跑起来读错误 | 启动游戏、抓 stdout / 堆栈 | agent 写完不知道能不能跑 |
| ③ 看见画面 | 截图（编辑器/运行中） | agent 无法判断“看起来对不对” |
| ④ 玩 | 注入键鼠/手柄、冻结时钟步进 | agent 无法自己验证玩法 |

**只做 ① 的服务器会把你变成它的眼睛和手。**

## 生态现状（2026-11-03 核对）

| 项目 | ★ | 许可 | 最后推送 | 工具数 | 四层覆盖 | 说明 |
|---|---:|---|---|---:|---|---|
| [hi-godot/godot-ai](https://github.com/hi-godot/godot-ai) | 3,357 | MIT | **2026-11-03** | 46 工具 / 120+ 操作 | ①②③④ | Godot 4.7+ 插件 + 旁挂 Python 服务；截图、键鼠手柄定时序列；dock 自动写客户端配置 |
| [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) | 6,485 | MIT | 2026-04-16 | 少 | ①② | 一行 `npx`，最省事；**无截图无输入**，已停更 6 个月 |
| [yurineko73/Godot-MCP-Native](https://github.com/yurineko73/Godot-MCP-Native) | 868 | — | 2026-08 | 中 | ①②③④ | 纯 GDScript 实现 MCP 服务，零外部依赖 |
| [youichi-uda/godot-mcp-pro](https://github.com/youichi-uda/godot-mcp-pro) | 641 | 插件开源/服务闭源 | 2026-09 | 162 | ①②③④ | **$15 一次性**；4.4+ |
| [tugcantopaloglu/godot-mcp](https://github.com/tugcantopaloglu/godot-mcp) | 508 | MIT | 2026-10 | 157 | ①②③④ | Coding-Solo 的加强 fork，支持 C# |
| [tomyud1/godot-mcp](https://github.com/tomyud1/godot-mcp) | 449 | MIT | 2026-10 | 69 | ①② | 资产库安装；**自带 undo 工具**（改的不进编辑器 Ctrl+Z） |
| [IvanMurzak/Godot-MCP](https://github.com/IvanMurzak/Godot-MCP) | 322 | — | 2026-11-03 | 中 | ①②③ | 作者同时维护 Unity-MCP，走 .NET 路线 |
| [satelliteoflove/godot-mcp](https://github.com/satelliteoflove/godot-mcp) | 183 | MIT | 2026-10 | 21 | ②③④ | **专为确定性回归测试设计**：冻结游戏时钟、按帧步进、读运行态 JSON |
| GDAI MCP | — | 闭源 | 2026 | ~30 | ①②③④ | **$19 一次性**，4.2+，最省心 |

> Star 数只代表注意力，不代表质量。真正要看的是**最后推送时间**——Godot 迭代快，按 4.4 写的插件在 4.7 上会炸。

## 我的选型

| 场景 | 选 |
|---|---|
| 想免费、开源、跟着 4.7 走、要截图和输入 | **godot-ai**（首选） |
| 只想“跑起来看报错”，最省安装 | Coding-Solo（但接受它停更且看不见画面） |
| 要自动化回归、可复现的玩法测试 | **satelliteoflove**（冻结时钟那套设计最认真） |
| 不想折腾、要开箱可用 | GDAI MCP（$19）或 MCP Pro（$15） |
| 不差钱、要 160+ 工具 | MCP Pro —— 但**先把工具砍到 15 个以内** |

**不要一上来装 160 个工具。** 工具越多，模型选错工具的比率越高，而且光是把工具清单读进 context 就吃掉几千 token。官方文档自己都建议按需关掉。

## 关键判断：大部分工作不需要 MCP

Godot 的项目文件全是文本——`.tscn`、`.tres`、`.gd`、`project.godot`——所以一个能读写文件和跑命令的 agent，**不做任何 MCP 集成就能完成大约 80% 的工作**：

```bash
godot --headless --path . --import          # 首次导入（CI 必备）
godot --headless --path . --check-only -s res://tools/x.gd   # 语法检查
godot --headless --path . -s res://tools/test_runner.gd      # 跑测试脚本
godot --headless --path . --quit-after 120  # 跑 N 帧后退出
godot --lsp-port 6005 --editor              # GDScript LSP（给编辑器/agent 补全与诊断）
```

MCP 真正买到的只有三样东西：

1. **走编辑器的 undo 栈**（直接改文件不进 Ctrl+Z）；
2. **结构化的场景树编辑**（不用手拼 `.tscn` 的 node 路径和 ext_resource id）；
3. **运行态截图与输入注入**（自己验证，而不是写完就说做完了）。

第 3 条才是分水岭：**没有它，agent 只能“写代码”；有它，agent 能“做游戏”。**

## 本机实测（这个容器里）

在这台机器上装了 Godot 4.7.2，验证了三件事：

| 验证项 | 结果 |
|---|---|
| 二进制可运行 | `4.7.2.stable.official.ed1daf0bf` ✓ |
| `--headless --script` 跑脚本并读输出 | ✓（打印 `HELLO-AGENT-FROM-GODOT`） |
| `DISPLAY=:1` 开真实窗口（llvmpipe 软件渲染 OpenGL 4.5） | ✓ 窗口 640×360 正常渲染 |
| 用 `scrot` 截图做视觉验证 | ✓ 截图见 `gdshot2.png` |
| 音频 | ✗ 容器无声卡，回退 dummy driver（声音无法验证） |

**这意味着：在这个容器里，agent 可以「写 → 跑 → 看 → 改」闭环**，而不是只能交代码。这对弱美术的项目尤其重要——画面是你最需要外置眼睛的地方。

注意：`/usr` 每次重部署都会重建，Godot 二进制要放 `/workspace/bin` 才能持久；MCP 插件本身装在**项目里**（`addons/`），跟着 git 走。

## 陷阱

1. **版本错配**：插件按 4.4 写、你跑 4.7 → 加载失败或 API 报错。装前看最后推送时间。
2. **安全边界**：MCP 服务器等于在你机器上执行动作。锁在项目目录内、每次会话前 commit、不用的服务器及时摘掉。
3. **工具过多**：见上，砍到 15 个以内。
4. **`--write-movie` 不能替代截图**：headless 用 dummy 渲染器，没有画面；要画面必须有真实显示驱动（本机 `DISPLAY=:1` 可以）。
5. **容器无音频**：音效/音乐只能靠人工听，或导出后在本地验证。

## 给 opencode 的最小配置

```jsonc
// opencode.jsonc → mcp.servers
"godot": {
  "type": "local",
  "command": ["npx", "-y", "@hi-godot/godot-ai"],   // 以实际包名为准
  "enabled": true
}
```

（godot-ai 的 dock 会自动写 Claude Code / Codex / Cursor 的配置；opencode 需要手工加一条，包名以仓库 README 为准。）

配套建议：加 **GUT** 或 **gdUnit4** 做无头回归（`godot --headless -s addons/gut/gut_cmdln.gd`），这样“改完能不能跑”不依赖人眼。

## Sources

| ID | Source |
|---|---|
| S1 | [hi-godot/godot-ai](https://github.com/hi-godot/godot-ai) |
| S2 | [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) |
| S3 | [satelliteoflove/godot-mcp](https://github.com/satelliteoflove/godot-mcp) |
| S4 | [The best Godot MCP server in 2026（dev.to 横向对比）](https://dev.to/orellanaed/the-best-godot-mcp-server-in-2026-depends-on-what-you-want-the-agent-to-touch-5aji) |
| S5 | [Godot 4.7.2 官方发布](https://github.com/godotengine/godot/releases/tag/4.7.2-stable) |
| S6 | [本机实测：Godot 4.7.2 headless + DISPLAY=:1 截图](/tmp/opencode/gdshot2.png) |
