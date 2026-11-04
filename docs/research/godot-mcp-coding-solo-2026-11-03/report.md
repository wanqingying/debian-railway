# Coding-Solo/godot-mcp：全部工具清单与实测

**仓库：** https://github.com/Coding-Solo/godot-mcp · MIT · TypeScript · 6,485★ · 最后推送 2026-04-16
**npm：** `@coding-solo/godot-mcp@0.1.1`（2026-02-03 发布）
**实测环境：** Godot 4.7.2-stable，2026-11-03

## 一、14 个工具（`tools/list` 实测，与源码一致）

| # | 工具 | 参数（* = 必填） | 作用 |
|---|---|---|---|
| 1 | `launch_editor` | `projectPath*` | 打开 Godot 编辑器 |
| 2 | `run_project` | `projectPath*`, `scene` | 以调试模式运行项目并捕获输出 |
| 3 | `get_debug_output` | — | 取回上一个进程的 stdout / stderr |
| 4 | `stop_project` | — | 杀掉正在运行的项目 |
| 5 | `get_godot_version` | — | 读已安装的 Godot 版本 |
| 6 | `list_projects` | `directory*`, `recursive` | 在目录里找 Godot 项目 |
| 7 | `get_project_info` | `projectPath*` | 读项目元数据（名称、主场景、目录结构） |
| 8 | `create_scene` | `projectPath*`, `scenePath*`, `rootNodeType` | 新建场景（默认 `Node2D`） |
| 9 | `add_node` | `projectPath*`, `scenePath*`, `parentNodePath`, `nodeType*`, `nodeName*`, `properties` | 往场景里加节点，可带属性 |
| 10 | `load_sprite` | `projectPath*`, `scenePath*`, `nodePath*`, `texturePath*` | 给 `Sprite2D` 贴图 |
| 11 | `export_mesh_library` | `projectPath*`, `scenePath*`, `outputPath*`, `meshItemNames` | 把场景导出成 `MeshLibrary`（给 `GridMap` 用） |
| 12 | `save_scene` | `projectPath*`, `scenePath*`, `newPath` | 保存场景，或另存为变体 |
| 13 | `get_uid` | `projectPath*`, `filePath*` | 取文件 UID（Godot 4.4+） |
| 14 | `update_project_uids` | `projectPath*` | 重存资源以刷新 UID 引用（Godot 4.4+） |

## 二、实现方式（决定了它可靠不可靠）

分两类：

**① 场景类（8–14）走 headless 脚本。** 服务器把一个 49 KB 的 `godot_operations.gd` 塞进项目，然后执行：

```bash
godot --headless --path <项目> --script <ops.gd> <操作名> '<JSON 参数>'
```

也就是说**场景是用 Godot 自己的 API 写的，不是手拼 `.tscn` 文本**——这是它比“让 agent 直接改文件”更可靠的地方。脚本内部支持 7 个操作，多出的 `resave_resources` 被 `update_project_uids` 调用。

**② 运行类（1–5）走子进程。** `run_project` 执行 `godot -d --path <项目> [场景]`，把 stdout/stderr 收进内存；`get_debug_output` 返回缓冲区；`stop_project` 直接 kill。

**路径校验**：参数里的 `..` 会被拒绝；节点类名只接受内建类名。

## 三、实测结果（Godot 4.7.2）

| 项 | 结果 |
|---|---|
| 协议握手 / `tools/list` | ✓ 14 个工具，与源码完全一致 |
| `get_godot_version` | ✓ 返回 `4.7.2.stable.official.ed1daf0bf` |
| `create_scene`（`scenes/probe_scene.tscn`, `Node3D`） | ✓ 写出合法 `.tscn` |
| `add_node`（`MeshInstance3D` 子节点 + position） | ✓ 写出正确层级，带 `unique_id` |
| `run_project` | ✗ 本容器内子进程 SIGABRT |
| 崩溃时的诊断 | ✗ 只返回 “No active Godot process.”，**丢掉了崩溃日志** |

`run_project` 失败的原因不在这个 MCP：容器 `pids.max=1000`、当时 `pids.current=833`，Godot 软件渲染要开几十个线程，线程创建 `EAGAIN` → `std::system_error: Resource temporarily unavailable` → SIGABRT。同样的命令手工跑（少一层 Node 进程）就能活。

**但它暴露了一个真实缺陷**：进程一早退出时，`get_debug_output` 直接报“没有活动进程”，**把已经捕获到的 stderr 丢了**。对 agent 来说这就是“黑屏无报错”，最难调试的情形。

## 四、能力缺口

| 缺什么 | 后果 |
|---|---|
| 截图（编辑器/运行中） | agent **看不见画面**，无法判断“看起来对不对” |
| 输入注入（键鼠/手柄） | agent **不能玩**，无法验证玩法 |
| 删除 / 移动 / 重挂节点 | 只能加，不能改结构，改错了只能手改文件 |
| 走编辑器 undo | 所有改动不进 `Ctrl+Z` |
| `.tres` 资源编辑、动画、UI 专用工具 | 复杂内容仍要回编辑器 |
| 导出 / 打包 | 不能自动出包 |
| LSP / 诊断 | 语法错误只能靠跑一次才知道 |

## 五、两个坑

1. **npm 包名**：`npm i godot-mcp` 装到的是**另一个包**（0.1.0，2025-07 发布，与仓库无关）；正确的是 `@coding-solo/godot-mcp@0.1.1`。
2. **停更 6 个多月**：最后推送 2026-04-16，而 Godot 已到 4.7.2。本次实测场景类工具仍然可用，但没有人跟进新 API。

## 六、结论

它是“最容易起步”的那个没错——一行 `npx`，能跑、能读报错、能用 Godot API 建场景。

但它回答不了“**跑起来对不对**”。对弱美术的项目，缺的恰恰是眼睛：封面、画面、UI 布局、光照，全都验证不了。

选它，等于保留人工看画面这一步；要闭环，得换 `godot-ai`（含截图与输入）或 `satelliteoflove`（冻结时钟的确定性回放）。
