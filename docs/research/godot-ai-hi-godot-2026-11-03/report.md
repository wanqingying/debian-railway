# hi-godot/godot-ai：工具清单与评估

**仓库：** https://github.com/hi-godot/godot-ai · MIT · v4.4.1 · 3,357★ · 最近推送 2026-11-03
**要求：** Godot **4.7+** + `uv`（跑 Python 服务器）+ MCP 客户端
**官网自报：** 21,000+ 月活安装、近三个月 3,000 万次工具调用（匿名遥测，排除关闭者）

## 一句话

**它不是一个"驱动编辑器"的服务器，而是一个"住在编辑器里"的完整工具面**：GDScript 插件跑在 Godot 内部暴露命令，Python MCP 服务器（`uvx` 拉起）在中间，客户端通过 `godot-ai attach` 接进来。所以它能截图、能往运行中的游戏注入输入、能跑测试、能读编辑器报错、能同时管多个编辑器会话——这些 Coding-Solo 都没有。

## 架构

```
MCP client ──stdio──> godot-ai attach ──> Python server (fastmcp) ──WebSocket──> Godot 插件 ──> EditorPlugin API
```

## 工具总数

**47 个工具**（文档写 46，实际按源码与插件内 `tool_catalog.gd` 数出来是 47）：

- 4 个常驻核心
- 15 个高频独立动词
- 28 个 `<domain>_manage` 汇总工具（合计 194 个 `op`）

## 一、常驻核心（不可关闭）

| 工具 | 作用 |
|---|---|
| `editor_state` | 版本、项目名、当前场景、就绪状态、播放状态、游戏是否存活 |
| `scene_get_hierarchy` | 分页遍历场景树（深度 / 偏移 / 上限） |
| `node_get_properties` | 节点的完整属性快照 |
| `session_activate` | 把后续调用固定到某个已连接的编辑器 |

## 二、高频独立动词（15）

| 工具 | 作用 |
|---|---|
| `batch_execute` | 多条命令原子执行，首个失败整体回滚 |
| `node_create` / `node_set_property` / `node_find` | 建节点 / 设属性 / 搜索 |
| `scene_open` / `scene_save` | 开、存场景 |
| `script_create` / `script_attach` / `script_patch` | 建脚本、挂脚本、按锚点改代码（GDScript 会校验，C# 只做文本） |
| `project_run` | 运行项目并等游戏存活（默认自动保存内存中的改动） |
| `test_run` | 在编辑器里跑 GDScript 测试套件（`McpTestSuite`） |
| `logs_read` | 读插件/游戏/编辑器/合并日志；`source="editor"` 能拿到解析错误、reload 警告、`push_error`、Debugger Errors 面板的行 |
| `editor_screenshot` | **截 4 种画面**：编辑器 3D 视口、编辑器 2D 视口、Camera3D 电影渲染、运行中游戏的帧缓冲；支持 `save_to="res://captures/x.png"` 落盘，或内联返回（自动降采样） |
| `editor_reload_plugin` | 重载插件并等重连 |
| `animation_create` | 建 Animation 片段（缺 AnimationPlayer 会自动补） |

## 三、域汇总工具（28 个，194 个 op）

按用途分组：

**场景与节点**
| 工具 | op 数 | 关键 op |
|---|---:|---|
| `scene_manage` | 4 | `create`, `save_as`, `close`, `get_roots` |
| `node_manage` | 10 | `get_children`, `get_groups`, `delete`, `duplicate`, `rename`, `move`, `reparent`, `set_editable_children`, `add_to_group`, `remove_from_group` |
| `signal_manage` | 3 | `list`, `connect`, `disconnect` |
| `script_manage` | 3 | `read`, `detach`, `find_symbols`（.gd 与 .cs） |
| `autoload_manage` | 3 | `list`, `add`, `remove` |
| `input_map_manage` | 6 | `list`, `add_action`, `ensure_action`, `remove_action`, `bind_event`, `ensure_binding` |
| `session_manage` | 1 | `list` |

**运行时与验证**
| 工具 | op 数 | 关键 op |
|---|---:|---|
| `game_manage` | 13 | `get_scene_tree`, `get_node_info`, `get_ui_elements`, `suspend`, `resume`, `next_frame`, `debug_status`, **`input_key` / `input_mouse` / `input_gamepad` / `input_action` / `input_sequence` / `input_state`** |
| `test_manage` | 1 | `results_get` |
| `editor_manage` | 7 | `state`, `selection_get/set`, `monitors_get`, `quit`, `logs_clear`, `game_eval` |
| `filesystem_manage` | 10 | `read_text`, `write_text`, `import_get/set`, `reimport`, `scan`, `search`, `move`, `rename`, `remove` |

**内容与表现**
| 工具 | op 数 | 关键 op |
|---|---:|---|
| `ui_manage` | 5 | `set_anchor_preset`, `set_text`, `set_richtext`, `build_layout`, `draw_recipe` |
| `theme_manage` | 10 | 颜色/常量/字号/字体/图标/StyleBox 全套 + `apply` |
| `material_manage` | 16 | `create`, `set_param`, `apply_to_node`, **`shader_create` / `shader_patch` / `shader_validate` / `visual_shader_*`** |
| `resource_manage` | 14 | `search`, `load`, `inspect`, `assign`, `create`, `sprite_frames_create`, `curve_set_points`, `environment_create`, `physics_shape_autofit`, `gradient_texture_create`, `noise_texture_create` |
| `animation_manage` | 31 | AnimationPlayer/Tree/Library 全套、转场、轨道，**含 4 个预设**：`preset_fade/slide/shake/pulse` |
| `particle_manage` | 7 | `create`, `set_main/process/draw_pass`, `restart`, `apply_preset` |
| `camera_manage` | 8 | `create`, `configure`, 2D 边界/阻尼/跟随、`apply_preset` |
| `audio_manage` | 14 | 总线增删改、效果器、Player、`play/stop` |
| `tilemap_manage` | 4 | `tilemap_set_cell`, `set_cells_rect`, `clear`, `get_cells` |
| `tileset_manage` | 3 | `tileset_create_atlas`, `get_atlas_tiles`, `get_atlas_image` |
| `gridmap_manage` | 5 | `gridmap_set_item`, `fill`, `clear`, `get_used_cells`, `list_library_items` |
| `navigation_manage` | 2 | `bake`, `path_get` |
| `csg_manage` | 2 | `csg_create`, `csg_set_operation` |

**项目与元信息**
| 工具 | op 数 | 关键 op |
|---|---:|---|
| `project_manage` | 4 | `stop`, `settings_get/set`, `set_main_scene` |
| `api_manage` | 1 | `get_class`（查 ClassDB：属性/方法/信号/枚举/常量/继承） |
| `client_manage` | 3 | `status`, `configure`, `remove`（配置 26 个客户端） |
| `custom_manage` | 2 | `list`, `invoke`（项目自定义工具） |

## 四、19 个 MCP 资源

除了工具，还注册了 `godot://` 资源，客户端可直接当上下文读：
`sessions`、`editor/state`、`selection/current`、`logs/recent`、`scene/current`、`scene/hierarchy`、`node/{path}/properties`、`node/{path}/children`、`node/{path}/groups`、`class/{class_name}`、`script/{path}`、`project/info`、`project/settings`、`materials`、`visual_shader/{path}`、`shader/{path}`、`input_map`、`performance`、`test/results`

**这一层被低估**：`class/{class_name}` 让 agent 不用猜 Godot API，`performance` 让它可以查帧率，`script/{path}` 省掉一次文件读。

## 五、和 Coding-Solo 的正面差别

| | Coding-Solo godot-mcp | godot-ai |
|---|---|---|
| 工具数 | 14 | **47（194 op）** |
| 运行形态 | 独立进程调 CLI | **插件住在编辑器里** |
| 截图 | ✗ | ✓ 4 种视口 + 落盘 |
| 注入输入 | ✗ | ✓ 键/鼠/手柄/动作/序列 |
| 跑测试 | ✗ | ✓ `test_run` + `McpTestSuite` |
| 读编辑器报错 | ✗ | ✓ `logs_read(source=editor)` |
| 撤销 | 不进 undo | 走 EditorPlugin，进 undo 栈 |
| 多编辑器 | ✗ | ✓ `session_*` |
| 版本 | 适配 4.7 未验证（已停更） | **要求 4.7+**，今天仍在推送 |
| 依赖 | Node | **uv + Python** |
| 工具面 | 小，好选 | 大，需要裁剪 |

## 六、安装

1. 装 `uv`（`curl -LsSf https://astral.sh/uv/install.sh | sh`）
2. 插件放 `项目/addons/godot_ai/`（AssetLib 或 GitHub Release）
3. 项目设置 → 插件 → 启用 Godot AI
4. 在 **Godot AI dock** 里点 Configure（26 个客户端之一，**含 opencode**）

**opencode 的写入位置**：`~/.config/opencode/opencode.json`（同时认 `.jsonc`，两文件合并、后者按 key 覆盖），结构是 `mcp.<name>` + `type: "local"` + `command: ["uvx", ...]`（单 argv 数组，没有独立 args 键）。

> 注意：本容器把 `XDG_CONFIG_HOME` 指到了 `/workspace/.opencode/config`，而它的模板写的是 `~/.config/opencode`。在容器里要么改 `OPENCODE_CONFIG`，要么手工加一条。

## 七、风险与坑

1. **只支持 4.7+**。4.6 及以下老项目不能用。
2. **多一层 Python 运行时**（uv + fastmcp 等一串精确 pin）。比 Coding-Solo 的 `npx` 重。
3. **工具面过大**：47 工具 + 194 op，光 schema 就吃不少 context；模型也更容易选错。必须用 `--exclude-domains` 裁剪（它自带这个开关，UI 里能勾）。
4. **v4 不能覆盖安装**：官方明说 "Never extract a new version over an existing `addons/godot_ai/`"。
5. **端口 + WebSocket**：默认 8000，客户端不能裸填 `http://127.0.0.1:8000/mcp`，必须走 `godot-ai attach`（v4 的鉴权设计）。
6. **遥测**：匿名的安装数与工具调用数，可关。
7. **文档与实现差 1 个工具**（46 vs 47）——说明计数是手写的，不致命但别当规格。

## 八、对本项目的意义

这是目前**唯一能形成闭环的免费方案**：

- 写代码 → `script_patch`；建结构 → `node_create`；连线 → `signal_manage`
- 跑起来 → `project_run`；看错误 → `logs_read(source=editor)`
- **看画面 → `editor_screenshot(viewport/game)`**
- **自己玩 → `game_manage(input_*)` + `suspend/next_frame`**
- 回归 → `test_run`

对弱美术的项目，`editor_screenshot` 就是那个"外置的眼睛"：封面、UI 布局、光照、镜头，全都变成可验证的东西。

代价是：编辑器必须开着（不能纯 headless），并且它比 Coding-Solo 重。

## 九、结论

**如果目标是"agent 自己把游戏做出来并自己验收"，选它。** 如果只是想"跑一下看看报错"，Coding-Solo 更轻。

我的建议：**用它，但一上来只开 6 个域**——`editor`（截图/日志）、`scene`、`node`、`script`、`game`（输入）、`project`。其余按需再加，避免 47 个工具把 context 和判断力都吃掉。
