# 链接总表

**核验时间 2026-11-14，方式：`curl -L -A "Mozilla/5.0"` 拉取 HTTP 状态码（70 条，65 条 200）。**
标 `403` 的三类站点（Nexus、TaleWorlds 论坛、steamdb）是 Cloudflare 挡自动化请求，浏览器里正常，本文件没有浏览器复核。
版本文档类链接会随游戏更新变动，长期看以 `https://apidoc.bannerlord.com/` 与游戏目录里的 DLL 为准。

---

## 1. 官方文档（TaleWorlds）

| 链接 | 内容 | 状态 |
|---|---|---|
| https://moddocs.bannerlord.com/ | 官方 modding 文档首页，按主题分区，2026 年已覆盖 War Sails | 200 |
| https://moddocs.bannerlord.com/asset-management/quickguide_create_a_mod/ | **必读**：模块结构、SubModule 与各文件夹职责 | 200 |
| https://moddocs.bannerlord.com/asset-management/faq/ | 必读：装 Kit、进编辑器、改不了 Native、编辑器打不开 | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/overriding_assets/ | 覆盖原版资源 | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/meshes/ | 模型 | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/materials/ | 材质 | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/textures/ | 贴图 | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/asset_naming_conventions/ | 命名约定（不遵守会"资源找不到"） | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/path/ | 资源路径规则 | 200 |
| https://moddocs.bannerlord.com/asset-management/asset-types/scripts/ | 场景脚本 | 200 |
| https://moddocs.bannerlord.com/bestpractices/xslt_usage_tutorial/ | **XSLT 批改原版 XML** | 200 |
| https://moddocs.bannerlord.com/bestpractices/merging_module_xml_files_with_native/ | 与 Native 合并的正确做法 | 200 |
| https://moddocs.bannerlord.com/bestpractices/sealed_class_extension/ | 扩展 sealed 类的技巧 | 200 |
| https://moddocs.bannerlord.com/bestpractices/scene_performance_guide/ | 场景性能 | 200 |
| https://moddocs.bannerlord.com/editor/scene-editor/terrain_creation/ | 地形 | 200 |
| https://moddocs.bannerlord.com/editor/scene-editor/nav_mesh/ | 导航网格 | 200 |
| https://moddocs.bannerlord.com/editor/scene-editor/editor_shortcuts/ | 编辑器快捷键 | 200 |
| https://moddocs.bannerlord.com/authoring-mission-scenes/villages/ | 村庄场景要求 | 200 |
| https://moddocs.bannerlord.com/authoring-mission-scenes/sieges/ | 攻城场景要求 | 200 |
| https://moddocs.bannerlord.com/authoring-mission-scenes/arenas/ | 竞技场场景要求 | 200 |
| https://moddocs.bannerlord.com/authoring-mission-scenes/hideouts/ | 藏身处场景要求 | 200 |
| https://moddocs.bannerlord.com/audio-modding/audio-modding-overview/ | FMOD 音频工作流 | 200 |
| https://moddocs.bannerlord.com/war-sails/ship_creation/ | War Sails 造船 | 200 |
| https://moddocs.bannerlord.com/steam-workshop/uploading_updating_mod/ | **必读**：Publish Module + WorkshopCreate.xml + `SteamWorkshop.exe` | 200 |
| https://apidoc.bannerlord.com/ | 官方 API 文档（按版本；2026-11-14 只到 1.4.8，落后于 1.5.7） | 200 |
| https://apidoc.bannerlord.com/v/1.4.8/ | 单个版本入口示例 | 200 |
| https://github.com/TaleWorlds/Documentations | 官方文档源码，可提 PR 纠错 | 200 |
| https://forums.taleworlds.com/index.php?forums/the-smithy-mod-development.643/ | 官方 mod 开发论坛（The Smithy） | 403（Cloudflare） |

## 2. 社区文档

| 链接 | 内容 | 状态 |
|---|---|---|
| https://docs.bannerlordmodding.com/ | 社区文档首页（有简体中文） | 200 |
| https://docs.bannerlordmodding.com/_intro/getting-started | 入门：工具清单、建模块 | 200 |
| https://docs.bannerlordmodding.com/_intro/folder-structure | 模块目录结构详解 | 200 |
| https://docs.bannerlordmodding.com/_xmldocs/submodule | **SubModule.xml 逐字段说明** + 合并/覆盖语义 | 200 |
| https://docs.bannerlordmodding.com/_tutorials/basic-csharp-mod | **官方教程之外最好的 C# 入门**（Hello World + 调试参数） | 200 |
| https://docs.bannerlordmodding.com/_tutorials/packing_mods_for_vortex | 打包给 Vortex 用 | 200 |
| https://docs.bannerlordmodding.com/zh/_intro/getting-started | 上面同样内容的**中文版** | 200 |
| https://docs.bannerlordmodding.lt/ | 社区 wiki，颗粒度最细（按 API/实体/编辑器分区） | 200 |
| https://docs.bannerlordmodding.lt/modding/mbsubmodulebase/ | `MBSubModuleBase` 生命周期 | 200 |
| https://docs.bannerlordmodding.lt/modding/save_system/ | 存档系统 / `SyncData` | 200 |
| https://docs.bannerlordmodding.lt/modding/harmony/ | Harmony 在本作里的用法 | 200 |
| https://docs.bannerlordmodding.lt/3d/workflow/ | 3D 资产工作流入口（Blender → Editor） | 200 |
| https://docs.bannerlordmodding.lt/resources/version_changes/ | 各版本 API 变化记录 | 200 |
| https://modding.wiki/en/mountandblade2bannerlord | 另一个 modding wiki 的入口页 | 200 |
| https://butr.github.io/documentation/ | BUTR 文档（Harmony 调试、崩溃分析、CI 发布） | 200 |
| https://butr.github.io/documentation/advanced/publishing-on-github/ | **GitHub Actions 一次发 Nexus/Workshop/NuGet** | 200 |
| https://butr.github.io/documentation/advanced/using-butterlib-crash-dump/ | 用 ButterLib 崩溃转储定位问题 | 200 |
| https://butr.github.io/documentation/info/using-taleworld-crash-dump/ | 官方崩溃转储怎么读 | 200 |
| https://bannerlordapi.butr.link/ | 社区维护的 API 索引（按游戏版本生成） | 200 |

## 3. 框架与工具（GitHub）

| 链接 | 内容 | 状态 |
|---|---|---|
| https://github.com/BUTR | **BUTR 组织总入口**，所有生态库都在这 | 200 |
| https://github.com/BUTR/Bannerlord.Module.Template | **dotnet/VS 项目模板**（`dotnet new blmodfx`），自动部署到 Modules | 200 |
| https://github.com/BUTR/Bannerlord.Harmony | 统一的 Harmony 模块；README 里有依赖声明写法与版本编码规则 | 200 |
| https://github.com/BUTR/Bannerlord.BLSE | 启动器扩展：排序、ABI 检查、崩溃拦截、`DependedModuleMetadatas` | 200 |
| https://github.com/BUTR/Bannerlord.UIExtenderEx | 多 mod 同时改界面的库 | 200 |
| https://github.com/BUTR/Bannerlord.ButterLib | 通用补丁/兼容层 | 200 |
| https://github.com/BUTR/Bannerlord.ReferenceAssemblies | 每个游戏版本的引用程序集（编译旧版本 mod 用） | 200 |
| https://github.com/BUTR/Bannerlord.PlayerSwitcher | 小而完整的参考 mod（读代码用） | 200 |
| https://github.com/Aragas/Bannerlord.MBOptionScreen | **MCM**（设置菜单库）源码；README 有 `IncludeAssets="compile"` 等要点 | 200 |
| https://mcm.bannerlord.aragas.org/articles/index.html | MCM 使用文档 | 200 |
| https://github.com/pardeike/Harmony | Harmony 上游 | 200 |
| https://harmony.pardeike.net/ | Harmony 官方文档首页 | 200 |
| https://harmony.pardeike.net/articles/patching.html | **Harmony patch 语法**（前缀/后缀/转译器） | 200 |
| https://github.com/szszss/TpacTool | 查看/导出 `.tpac` 内的原版资源 | 200 |
| https://github.com/mipen/BannerlordTweaks | 老项目，结构清晰，适合读 | 200 |
| https://github.com/sirdoombox/BannerLib | mod 间冲突规避思路 | 200 |

## 4. 发布与分发

| 链接 | 内容 | 状态 |
|---|---|---|
| https://steamcommunity.com/workshop/browse/?appid=261550 | Steam Workshop 的 Bannerlord 分区（查 Compatible Version 标签） | 200 |
| https://steamcommunity.com/sharedfiles/filedetails/?id=2859188632 | Harmony 的 Workshop 页面（示例：一个依赖库怎么发布） | 200 |
| https://www.nexusmods.com/mountandblade2bannerlord | Nexus 的 Bannerlord 分区 | 403（Cloudflare） |
| https://www.nexusmods.com/mountandblade2bannerlord/mods/2006 | Bannerlord.Harmony | 403（Cloudflare） |
| https://www.nexusmods.com/mountandblade2bannerlord/mods/612 | MCM | 403（Cloudflare） |
| https://www.nexusmods.com/mountandblade2bannerlord/mods/1 | BLSE | 403（Cloudflare） |
| https://steamdb.info/app/1393600/ | Modding Kit 的 appid（本指南引用的来源） | 403（Cloudflare） |
| https://discord.gg/ykFVJGQ | 官方 modding Discord（官方文档首页给的邀请链接） | 200 |

## 5. 已知的空白

- **中文社区**：`mountblade.cn` / `bbs.mountblade.cn` 在 2026-11-14 从本机 DNS/连接失败（`curl` 返回 000），没有收录。在 Windows 上能打开的话，把地址补进上面第 2 节。
- **视频教程**：官方文档首页列了一串 YouTube 系列（Lesser Scholar 的 19 集 C# 课、Macbeth of Gondor 的场景编辑器系列等），链接在 <https://moddocs.bannerlord.com/> 首页"Community-Made Resources"一节，本文件不重复抄（数量多、易失效）。
- **Google Docs 工作流**：官方首页还挂了 8 篇社区 Google 文档（3D 资产、材质导入、世界地图等），同样是首页转发，不摘录。
