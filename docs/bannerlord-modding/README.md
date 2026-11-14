# Bannerlord mod 开发资料（本地存档）

一个自用资料夹：把"以后在 Windows 上真的会照着做"的教程和链接固化下来，避免每次重新搜。

| 文件 | 什么时候读 |
|---|---|
| [guide.md](guide.md) | **主文档**。从 0 到能跑的 mod：三条路线、SubModule.xml、C# 扩展点、框架库依赖、资源/场景、调试、发布、维护清单 |
| [links.md](links.md) | 官方文档 / 社区文档 / 框架库 / 发布平台的全部链接，标注了 2026-11-14 的 HTTP 核验状态 |
| [snippets/](snippets/) | 可直接抄的模板：`SubModule.xml`、入口类、CampaignBehavior、Harmony patch、csproj |

## 建议的阅读顺序

1. `guide.md` 第 0–1 节（选路线 + 装环境）；
2. 第 2 节跟着做完，看到一个自己改的武器进游戏；
3. 第 3 节起 C# 工程（用 `dotnet new blmodfx` 模板，别手搓）；
4. 卡住时查第 4 节（框架库依赖，90% 的"和别的 mod 一起装就崩"在这）和第 6 节（排错对照表）；
5. `links.md` 只用来点链接，不当正文读。

## 版本事实（读数前先对齐）

| 项 | 值 | 来源 |
|---|---|---|
| 游戏本体 | BL **1.5.7** | TaleWorlds 2026-11-11 补丁公告（Steam 新闻） |
| War Sails 资料片 | WS **1.3.7** | 同上 |
| 官方 API 文档 | 只列到 **1.4.8** | apidoc.bannerlord.com 首页（2026-11-14 核验） |
| Modding Kit | Steam 工具库里的免费工具，appid `1393600` | steamdb sub 页面 |

API 文档落后于游戏本体这件事本身就值得记住：**查签名以 dnSpy 打开游戏 DLL 为准**。

## 这份资料的边界

- 代码片段**没有编译验证**（写这份资料的环境是 Linux 容器，没有游戏和 .NET Framework）。它们的作用是"结构和写法"，签名以 apidoc / dnSpy 为准。
- 版本号会过期。看到这份资料时先对一下上面的版本表，再决定要不要查一遍 `links.md` 里的"Version Changes"。
- 中文社区（骑砍中文站）当时连不上，没收录；能打开的话补进 `links.md` 第 2 节。

## 怎么更新

- 想加链接：只改 `links.md`，用同一张表、同一列顺序，状态列写核验日期或"未核验"。
- 想加教程内容：写进 `guide.md` 对应章节，别在 `links.md` 里写正文。
- 想加代码：放 `snippets/`，文件名用类名，文件头一行注明适用版本和"是否编译验证过"。
