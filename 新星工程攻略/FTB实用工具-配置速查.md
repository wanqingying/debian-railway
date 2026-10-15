# FTB 实用工具（FTB Utilities）配置速查

> 适用 1.12.2（本包 **FTBU 5.4.1.131** + FTB Library 5.4.7.2）。
> ⚠️ **下表默认值来自官方/教程示例，本包很可能已改动——请以你实例里文件的实际内容为准**。改前先备份。
> 认领/强加载、`/sethome`、`/home`、`/tpa`、`/back`、`/spawn`、`/warp`、`/rtp`、聊天、AFK 全由它管。

---

## 0. 两个文件在哪

| 文件 | 管什么 | 单人档位置 | 服务端位置 |
| --- | --- | --- | --- |
| `config/ftbutilities.cfg` | **主配置**：命令开关、区块/出生点、聊天、AFK、登录… | `.minecraft/config/ftbutilities.cfg` | 根目录 `config/ftbutilities.cfg` |
| `local/ftbutilities/ranks.txt` | **权限/列组**：家数量、冷却、前摇、认领/加载上限、传送权限… | `.minecraft/local/ftbutilities/ranks.txt` | 根目录 `local/ftbutilities/ranks.txt` |

- 找不到 `ranks.txt` → **至少启动一次游戏**后生成。
- 改 `ranks.txt` 后：游戏内 `/ranks reload`；改 `.cfg` 需**重进游戏**。
- 游戏内也可用（需 OP/作弊）：`/ranks set_permission player <节点> <值>`，按 `Tab` 补全节点名。

---

## 1. `config/ftbutilities.cfg`（主配置）

### commands —— 命令开关（最重要）
`B:<名字>=true/false`，先在这里**打开你要用的命令**，再去 ranks 配权限。

| 键 | 示例默认 | 对应命令 |
| --- | --- | --- |
| `B:home` | false | `/home` `/sethome` `/delhome` |
| `B:back` | false | `/back` |
| `B:spawn` | false | `/spawn` `/setspawn` |
| `B:tpa` | false | `/tpa` `/tpaccept`… |
| `B:warp` | false | `/warp` `/setwarp`… |
| `B:rtp` | false | `/rtp`（随机传送） |
| `B:tpl` | false | `/tpl`（传送到坐标） |
| `B:fly` `B:god` `B:heal` `B:inv` `B:nick` `B:mute` `B:kickme` `B:killall` | false | 作弊/管理类 |
| `B:chunks` | true | `/chunks` |
| `B:ranks` | true | `/ranks` |
| `B:leaderboard` | true | `/leaderboard` |
| `B:rec` | true | `/rec`（录制回放） |
| `B:nbtedit` | true | `/nbtedit` |
| `B:trash_can` | true | `/trash_can` |

> ⚠️ **别照抄**：示例里 `home/back/spawn/tpa/warp` 是 `false`，但你既然能用 `/sethome`，说明**本包已把它们设成 true**。把你要用的保持 `true`，不用的一律 `false`。

### afk —— 挂机计时
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:enabled` | true | 是否开启 AFK 计时 |
| `B:enabled_singleplayer` | false | **单人档是否也启用**（想单人也能挂机显示就改 true） |
| `B:log_afk` | true | 进出 AFK 是否打控制台日志 |
| `S:notification_timer` | `5m` | 多久后提示"进入 AFK" |

### auto_shutdown —— 定时关服
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:enabled` | false | 是否启用 |
| `B:enabled_singleplayer` | false | 单人是否启用 |
| `S:times` | `04:00` `16:00` | 到点关服（HH:MM，服务器时间） |

### chat —— 聊天
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:add_nickname_tilde` | false | 改过昵称的名字前加 `~` |
| `B:replace_tab_names` | false | 用昵称替换 Tab 名字 |

### debugging
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:log_chunkloading` | true | 每次强加载/取消都打日志——**建议改 false 防刷屏** |

### login —— 登录
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:enable_event_badges` | true | 节日徽章 |
| `B:enable_global_badges` | true | 全局徽章 |
| `B:enable_motd` | false | 进服欢迎信息 |
| `B:enable_starting_items` | false | 进服送物品 |
| `S:motd` | `"Hello player!"` | 欢迎信息内容 |
| `S:starting_items` | 示例 | 送物品（`/print_item` 取手上 NBT） |

### ranks —— 列组系统
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:enabled` | true | 启用列组（关了就只剩 command.* 权限） |
| `B:override_chat` | false | 列组控制聊天颜色/前缀 |
| `B:override_commands` | false | 列组控制命令（用其它权限模组时设 false） |

### world —— 世界/区块/出生点
| 键 | 示例默认 | 说明 |
| --- | --- | --- |
| `B:chunk_claiming` | true | **允许认领区块** |
| `B:chunk_loading` | true | **允许强加载**（claiming=false 时此项无效） |
| `I:blocked_claiming_dimensions` | 空 | 禁止认领的维度 ID 列表 |
| `B:disable_player_suffocation_damage` | false | 卡墙不掉血 |
| `S:disabled_right_click_items` | 空 | 禁用右键的物品（`modid:item:meta`） |
| `S:enable_explosions` | `FALSE` | 领地内爆炸（`TRUE/FALSE/DEFAULT`） |
| `S:enable_pvp` | `TRUE` | 领地内 PVP |
| `I:forced_spawn_dimension_time` | -1 | 锁定出生维度时间（-1 不锁，6000 正午…） |
| `I:forced_spawn_dimension_weather` | -1 | 锁定出生维度天气（-1 不锁） |
| `D:rtp_max_distance` | 100000.0 | `/rtp` 最大距离 |
| `D:rtp_min_distance` | 1000.0 | `/rtp` 最小距离 |
| `I:rtp_max_tries` | 200 | `/rtp` 尝试次数 |
| `B:safe_spawn` | false | 出生点安全区（免爆炸/免敌对/免互殴） |
| `B:show_playtime` | false | 左上角显示在线时长 |
| `B:spawn_area_in_sp` | false | 单人是否启用出生点范围 |
| `I:spawn_dimension` | 0 | 出生维度（0=主世界） |
| `I:spawn_radius` | 0 | 出生半径（需把 `server.properties` 的出生保护设为 0） |
| `B:unload_erroring_chunks` | true | 卸载出错区块 |

`world.logging {` —— 方块破坏/放置/玩家操作日志（`B:block_broken` / `B:block_placed` / `B:enabled` / `B:include_creative_players` / `B:include_fake_players` / `B:item_clicked_in_air`），默认基本都 true、`enabled=false`。

---

## 2. `local/ftbutilities/ranks.txt`（权限节点）

文件是 HOCON 风格，列组写成 `[player]` `[admin]` … 段落；每条 `节点: 值`。
列组可**继承**（`parent`），**power 高**的列组同节点优先。

### 列组基本
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `power` | 1 | 权力值，高者优先 |
| `default_player_rank` | true | 是否为新玩家的默认列组 |
| `default_op_rank` | - | OP 默认列组 |
| `parent` | "" | 继承的父列组 |

### 家 `/home`
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `ftbutilities.homes.max` | **1** | 家的数量 |
| `ftbutilities.homes.cooldown` | **5m** | 冷却 |
| `ftbutilities.homes.warmup` | **5s** | 前摇（读条时移动会打断） |
| `ftbutilities.homes.cross_dim` | true | 允许跨维度回家 |

### 返回 `/back`
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `ftbutilities.back.back` | false | 允许 `/back` |
| `ftbutilities.back.cooldown` / `.warmup` | 3m / 5s | 冷却 / 前摇 |
| `ftbutilities.back.respawn` | true | 允许回到重生点 |
| `ftbutilities.back.home` / `.spawn` / `.tpa` / `.warp` / `.rtp` | false | `/back` 能回到对应点 |
| `ftbutilities.back.infinite` | false | 无限 `/back` |

### 传送 `/tpa`
`ftbutilities.tpa.cooldown`(3m) / `.warmup`(5s) / `.cross_dim`(true)

### 出生点 `/spawn`
`ftbutilities.spawn.cooldown`(1m) / `.warmup`(5s)

### 传送点 `/warp`
`ftbutilities.warps.cooldown`(1m) / `.warmup`(5s)

### 随机传送 `/rtp`
`ftbutilities.rtp.cooldown`(10m) / `.warmup`(5s)

### 认领区块 `ftbutilities.claims.*`
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `ftbutilities.claims.max_chunks` | **100** | 最大认领区块 |
| `ftbutilities.claims.bypass_limits` | false | 无视上限 |
| `ftbutilities.claims.block.edit` | false | 让**外人**能改方块 |
| `ftbutilities.claims.block.interact` | false | 让**外人**能交互方块 |
| `ftbutilities.claims.block.interact.minecraft.crafting_table` / `.anvil` / `.wooden_door` 等 | true | 白名单：外人可用工作台/铁砧/门… |
| `ftbutilities.claims.attack_animals` | false | 外人能否攻击动物 |
| `ftbutilities.claims.item` | true | 外人能否丢/用物品 |
| `ftbutilities.claims.item.minecraft.bucket` / `.water_bucket` / `.lava_bucket` / `.end_crystal` | false | 白名单：外人可用桶/末影水晶… |

### 强加载区块
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `ftbutilities.chunkloader.max_chunks` | **50** | 最大强加载区块 |

### 对他人操作 `ftbutilities.other_player.*`
`claims.claim` / `claims.load` / `claims.unclaim` / `claims.unload` / `claims.see_info`、`heal`、`homes.list` / `homes.teleport`（默认给 OP）

### 聊天 `ftbutilities.chat.*`
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `ftbutilities.chat.formatting` | true | 允许格式化 |
| `ftbutilities.chat.name_format` | `"<{name}>"` | 名字格式 |
| `ftbutilities.chat.speak` | true | 能发言 |
| `ftbutilities.chat.nickname.set` / `.colors` | false | 改昵称 / 彩色昵称 |
| `ftbutilities.chat.text.color` | white | 字体颜色 |

### 其它
| 节点 | 默认 | 说明 |
| --- | --- | --- |
| `ftbutilities.afk.timer` | 0s | AFK 判定时间 |
| `ftbutilities.leaderboard.*` | true | 排行榜地标 |
| `ftbutilities.display.admin_info` | false | 显示管理信息 |
| `ftbutilities.badge` | "" | 徽章 |
| `admin_panel.ftbutilities.crash_reports.view` / `.delete` | OP:true | 管理员面板：崩溃报告 |
| `admin_panel.ftbutilities.edit_world.gamerules` | OP:true | 管理员面板：改 gamerule |
| `command.*` / `command.ftbutilities.*` | 视列组 | 控制每条命令是否可用 |

---

## 3. 单人/自用"推荐配置"

### 3.1 游戏内一键（OP，改完即时生效）
```
/ranks set_permission player ftbutilities.homes.max 20
/ranks set_permission player ftbutilities.homes.cooldown 0s
/ranks set_permission player ftbutilities.homes.warmup 0s
/ranks set_permission player ftbutilities.homes.cross_dim true
/ranks set_permission player ftbutilities.back.back true
/ranks set_permission player ftbutilities.back.infinite true
/ranks set_permission player ftbutilities.back.cooldown 0s
/ranks set_permission player ftbutilities.back.warmup 0s
/ranks set_permission player ftbutilities.tpa.cooldown 0s
/ranks set_permission player ftbutilities.tpa.warmup 0s
/ranks set_permission player ftbutilities.spawn.cooldown 0s
/ranks set_permission player ftbutilities.claims.max_chunks 10000
/ranks set_permission player ftbutilities.chunkloader.max_chunks 10000
```
> 时间**必须带单位** `s`/`m`，不写按 tick 算（1s=20t）。

### 3.2 `config/ftbutilities.cfg` 建议
```hocon
commands {
    B:home=true      # 若本包默认已是 true 就别动
    B:back=true
    B:spawn=true
    B:tpa=true
    B:warp=true
    B:tpl=true
}
afk      { B:enabled_singleplayer=true }
debugging{ B:log_chunkloading=false }     # 防日志刷屏
world    {
    B:chunk_claiming=true
    B:chunk_loading=true
    S:enable_explosions=FALSE             # 保护自己的领地
    B:show_playtime=true
}
chat     { B:replace_tab_names=true }     # 可选
```

### 3.3 `ranks.txt` 的 `[player]` 段落模板
```hocon
[player]
power: 1
default_player_rank: true
ftbutilities.homes.max: 20
ftbutilities.homes.cooldown: 0s
ftbutilities.homes.warmup: 0s
ftbutilities.homes.cross_dim: true
ftbutilities.back.back: true
ftbutilities.back.infinite: true
ftbutilities.back.cooldown: 0s
ftbutilities.back.warmup: 0s
ftbutilities.tpa.cooldown: 0s
ftbutilities.tpa.warmup: 0s
ftbutilities.tpa.cross_dim: true
ftbutilities.spawn.cooldown: 0s
ftbutilities.spawn.warmup: 0s
ftbutilities.warps.cooldown: 0s
ftbutilities.warps.warmup: 0s
ftbutilities.claims.max_chunks: 10000
ftbutilities.chunkloader.max_chunks: 10000
```

---

## 4. 常用命令速查

### 语法拆解
```
/ranks  set_permission  <列组|玩家>  <权限节点>  <值>
  │          │              │            │         │
  │          │              │            │         └─ 值：数字 / 时间(带 s·m·h) / true·false
  │          │              │            └─ 权限节点，改哪一项
  │          │              └─ 目标：列组名或玩家名（player = 默认玩家列组）
  │          └─ 子命令：设置权限
  └─ FTB Utilities 列组/权限命令
```
- **值类型**：数量直接写数字；**时间必须带单位 `s`/`m`/`h`**（不写按 tick 算，1s=20t）；开关写 `true`/`false`。
- **列组 vs 玩家**：写 `player` 改的是**默认玩家列组**（影响所有玩家）；写具体游戏名只改那一个人。

### 命令表
| 命令 | 作用 |
| --- | --- |
| `/ranks set_permission <列组|玩家> <节点> <值>` | 改权限 |
| `/ranks reload` | 重载 ranks.txt |
| `/ranks info <列组|玩家>` | 看某列组权限 |
| `/ranks create [父列组]` / `/ranks add <列组|玩家>` / `/ranks remove …` / `/ranks delete` | 管理列组 |
| `/home` `/sethome` `/delhome` | 家 |
| `/back` `/spawn` `/warp` `/rtp` `/tpa` | 传送 |
| `/chunks` | 认领/加载区块 |
| `/inv disable_right_click` | 游戏内禁用某物品右键 |

**参考**：MC百科《启用传送命令，配置cd、家数量，配置权限》（post/2412）、《[1.12.2]FTB 实用工具配置文件简单讲解》（post/2792）、官方权限节点 gist。
