# 骑马与砍杀 2：霸主（Bannerlord）mod 开发指南

> 编写日期 **2026-11-14**。游戏版本以当天为准：**BL 1.5.7 / WS 1.3.7**（TaleWorlds 2026-11-11 的补丁公告）。
> 本目录所有外部链接当天都用 HTTP 拉取核验过，状态见 [`links.md`](links.md)。
> 代码片段是骨架，**没有在 Windows 上编译验证过**（这里没有游戏、没有 .NET Framework），API 名字以对应版本的 apidoc 为准。

---

## 0. 先搞清楚三种 mod，再决定学什么

新手最大的浪费是拿"做大型 C# 框架"的资料去学"改几个数值"。先选路线：

| 路线 | 能做什么 | 需要 C# | 需要 Modding Kit | 典型产物 |
|---|---|---|---|---|
| **A. 纯 XML 数据 mod** | 新增/修改兵种、装备、文化、势力、聚落、文本翻译、开局设置 | 不需要 | 不需要 | 一个新兵种、一把新武器、一套汉化 |
| **B. C# 行为 mod** | 加规则（税收、战斗机制、事件）、加界面、patch 游戏原逻辑 | 需要 | 不需要（但需要游戏的 DLL 作引用） | 外交类、经济类、AI 类 mod |
| **C. 资源/场景 mod** | 新模型/材质/动画、新战场、新大地图、新 UI 素材 | 可选 | **必须** | 新场景包、武器模型包 |

三条路线的最小可跑路径，本指南分别在第 2、3、4 节给出。通常的做法是 **A 起步 → B 扩展 → C 上美术**，因为 A 的产出最快能看到、B 决定 mod 的深度、C 是投入最大的部分。

> 官方对 A 和 B 的分界话说得很直白：`SubModule.xml` 是唯一必需的东西，DLL 是可选的；没有 DLL 的 mod 也能改掉几乎所有数据（[官方 Quick Guide](https://moddocs.bannerlord.com/asset-management/quickguide_create_a_mod/)）。

---

## 1. 环境准备

### 1.1 游戏与版本

- 游戏本体：Steam / GOG / Epic / Xbox Game Pass 都有。**mod 必须和游戏主版本号对齐**，小版本（1.5.x）之间通常还能用，跨大版本（1.4 → 1.5）基本一定要重编。
- **War Sails** 是资料片，它有自己的一套版本号（WS 1.3.7）和补丁节奏，与本体（BL 1.5.7）分开记。涉海战的内容要按 WS 的版本对。
- 想长期做 mod，建议**关掉 Steam 自动更新**，或者复制一份游戏出来当开发环境——否则你调试到一半游戏被更新，mod 直接不加载。

### 1.2 Modding Kit（只有 C 路线必需）

Steam 库里把筛选切到 **工具（Tools）**，搜 `Mount & Blade II: Bannerlord - Modding Kit` 装上（appid `1393600`，来源：steamdb 的 sub 页面，见 `links.md`）。装它的两个硬性条件来自官方 FAQ：

- **工具和游戏的版本必须一致**（它直接复用游戏下载的文件）；
- **必须装在同一个盘**（跨盘会找不到资源）。

装完后：启动器进单人模式 → 主界面按 `Ctrl+E` 或点 Editor 进入编辑器。编辑器里有 `File → Create New Module` 直接生成一个带示例 XML 的模块骨架。

### 1.3 C# 工具链

- **Visual Studio 2022**（Community 够用），工作负载勾 **.NET 桌面开发**。
- **目标框架 .NET Framework 4.7.2**（官方教程的取值；4.8 一般也行，但别低于游戏自己的运行时）。
- 反编译/查 API：**dnSpy** 或 **ILSpy**，直接打开 `bin\Win64_Shipping_Client\TaleWorlds.*.dll`。
- 文本编辑：VS Code / Notepad++（改 XML 比 VS 快）。
- 强烈建议装 **BUTR 的 dotnet 模板**，一条命令生成可编译、能自动部署到游戏 `Modules` 的工程（见第 3.1 节）。

### 1.4 目录约定

```
<游戏根>\Mount & Blade II Bannerlord\
├─ bin\Win64_Shipping_Client\      ← 游戏 DLL，C# 项目引用它们（不是自己模块里的）
├─ Modules\
│  ├─ Native\  SandBoxCore\  Sandbox\  StoryMode\  CustomBattle\   ← 官方模块
│  └─ MyMod\                        ← 你的模块（文件夹名 = SubModule.xml 的 Id）
│     ├─ SubModule.xml
│     ├─ bin\Win64_Shipping_Client\MyMod.dll
│     ├─ ModuleData\*.xml
│     └─ GUI\  SceneObj\  AssetPackages\ ...
└─ ...
```

把 `BANNERLORD_GAME_DIR` 设为游戏根目录，工程文件里就只写 `$(BANNERLORD_GAME_DIR)`，换机器不用改路径（BUTR 模板就是这么设计的）。

模块里各文件夹的用途（来源：官方 Quick Guide 的 Module Hierarchy + 社区文档的 Folder Structure）：

| 文件夹 | 放什么 | 发布时要带吗 |
|---|---|---|
| `bin\Win64_Shipping_Client` | 编译出的 DLL（Game Pass 版是 `Gaming.Desktop.x64_Shipping_Client`） | 带 |
| `ModuleData` | 兵种/装备/文化/文本等 XML，由 `project.mbproj` 或 `SubModule.xml` 的 `<Xmls>` 注册 | 带 |
| `GUI\Prefabs`、`GUI\Brushes` | Gauntlet 界面 prefab 与图片 | 带 |
| `SceneObj` | 场景数据 | 带 |
| `AssetPackages` | 打包后的 `.tpac` 资源 | 带 |
| `AssetSources`、`Assets`、`SceneEditData` | 编辑器的中间产物（源文件、导入结果、地形编辑数据） | 可剔除 |
| `Atmospheres`、`Prefabs`、`NavMeshPrefabs` | 氛围、prefab、导航网格模板 | 视情况 |

---

## 2. 第一个 mod：纯 XML（30 分钟）

目标是**新增一把武器**，不写一行 C#。全流程不需要 Modding Kit。

### 2.1 建模块

在 `Modules\` 下新建文件夹 `MyMod`，里面放 `SubModule.xml`：

```xml
<Module>
    <Name value="My Mod"/>
    <Id value="MyMod"/>
    <Version value="v1.0.0"/>
    <SingleplayerModule value="true"/>
    <MultiplayerModule value="false"/>
    <DependedModules>
        <DependedModule Id="Native"/>
        <DependedModule Id="SandBoxCore"/>
        <DependedModule Id="Sandbox"/>
        <DependedModule Id="CustomBattle"/>
        <DependedModule Id="StoryMode"/>
    </DependedModules>
    <SubModules/>
    <Xmls>
        <XmlNode>
            <XmlName id="Items" path="mymod_items"/>
        </XmlNode>
    </Xmls>
</Module>
```

要点（都来自官方/社区文档，见 `links.md`）：

- `Id` **不能有空格**，且通常与文件夹名一致；
- `<SubModules>` **不写 DLL 就留空**，这是合法的（官方 Quick Guide 明说 SubModule 元素是可选的）；
- `<Xmls>` 里的 `id` 是**数据类型名**（`Items`、`SPCultures`、`NPCCharacters`…），`path` 是 `ModuleData` 下的文件名（不带 `.xml`）。

### 2.2 加数据

`ModuleData\mymod_items.xml`，抄一件官方物品改 id：

```xml
<Items>
  <Item id="my_sword" name="{=mymod_sword}My Sword"
        mesh="sword_a" culture="Culture.vlandia"
        weight="1.5" value="420" difficulty="12"
        Type="OneHandedWeapon">
    <ItemComponent>
      <Weapon weapon_class="OneHandedSword"
              weapon_length="95" swing_damage="38" swing_damage_type="Cut"
              thrust_damage="20" thrust_damage_type="Pierce" speed_rating="96"/>
    </ItemComponent>
    <Flags/>
  </Item>
</Items>
```

`{=key}文本` 是本地化写法；不给 key 直接写文本会显示原文（不推荐，玩家换语言就露馅）。

> 上面这些字段名是**示意**：最稳的做法是打开 `Modules\Native\ModuleData\items.xml` 抄一件同类武器，改 id 和数值。不同大版本之间字段有增删（比如 `item_usage`、`UsingTeamColor`），以你版本里的原版文件为准。

### 2.3 关键语义：**同名 XML 合并，同名 id 覆盖**

这是整个数据层最需要记住的一条（[社区文档 SubModule 页](https://docs.bannerlordmodding.com/_xmldocs/submodule)原文）：

- 不同 mod 里 id 相同的 XML **会合并**，不会互相覆盖掉整个文件；
- **但文件里同 id 的对象会按加载顺序覆盖**——后加载的赢；
- 所以"改原版装备数值" = 在自己的 XML 里写一个**同 id** 的 `<Item>`；"加新装备" = 换一个新 id。

由此推出一条实务规则：改原版数据时**只写你要改的那几个字段所在的完整对象**，不要复制整个原版文件（复制了就把原版那一类数据整体冻结在旧版本，游戏一更新就漂移）。

> 具体的"改一支箭的名字/数量、新增一支箭"的完整操作（含本地化 key 的坑）：[howto-items.md](howto-items.md)。

### 2.4 运行

启动器 → Singleplayer → Mods → 勾上 `MyMod` → Play。看不到 mod 就检查：文件夹名/`Id` 是否一致、XML 是否 well-formed、`<Xmls>` 的 `path` 是否拼错。

### 2.5 XSLT：想"批量改"而不是"逐个覆盖"时

官方提供了 XSLT 支持，可以在加载时对原版 XML 做变换（改数值、过滤条目），比手写覆盖对象更耐版本更新。教程：[XSLT Usage Tutorial](https://moddocs.bannerlord.com/bestpractices/xslt_usage_tutorial/)。另外官方推荐的做法页：[Merging Module XML Files with Native](https://moddocs.bannerlord.com/bestpractices/merging_module_xml_files_with_native/)。

---

## 3. 第一个 C# mod

### 3.1 用模板起工程（推荐）

```powershell
dotnet new --install Bannerlord.Templates
dotnet new blmodfx --name "MyMod"      # 或 blmodsdk；--help 看可选项
```

模板会生成：`_Module` 目录（原样拷进输出）、带 `$modulename$`/`$version$` 占位符的 `SubModule.xml`、正确的引用与构建后自动部署到 `Modules` 的逻辑。两个概念要先懂（模板 README 原文）：

- **硬依赖（hard dependency）**：写进 `SubModule.xml` 的 `<DependedModules>`，DLL **不**打进你的 bin，游戏保证对方先加载。**框架库都该是硬依赖**，否则同一个库里会出现两份。
- **软依赖（soft dependency）**：不写进 XML，DLL 直接打进你的 bin。只适合"别人不装也能跑"的东西。

### 3.2 手搓工程（理解原理用）

1. VS 新建 **类库 (.NET Framework) 4.7.2**，名字与 `SubModule.xml` 的 `Id` 一致；
2. 输出路径改成 `...\Modules\MyMod\bin\Win64_Shipping_Client`；
3. 引用游戏根 `bin\Win64_Shipping_Client` 下的 `TaleWorlds.*.dll`，以及每个官方模块 `Modules\<官方模块>\bin\Win64_Shipping_Client` 里的 DLL；
4. 调试（官方教程的推荐方式）：项目属性 → 调试 → 启动外部程序 `Bannerlord.exe`，工作目录设为游戏 `bin\Win64_Shipping_Client`，命令行参数：

   ```
   /singleplayer _MODULES_*Native*SandBoxCore*CustomBattle*SandBox*StoryMode*MyMod*_MODULES_
   ```

   这样 F5 直接带着你的模块进游戏，断点能停。

### 3.3 最小可跑代码（官方 Hello World，逐字来自官方教程）

```csharp
using TaleWorlds.Library;
using TaleWorlds.Localization;
using TaleWorlds.MountAndBlade;

namespace MyMod
{
    public class MySubModule : MBSubModuleBase
    {
        protected override void OnSubModuleLoad()
        {
            base.OnSubModuleLoad();
            Module.CurrentModule.AddInitialStateOption(new InitialStateOption(
                "Message",
                new TextObject("Message", null),
                9990,
                () => InformationManager.DisplayMessage(new InformationMessage("Hello World!")),
                () => (false, null)));
        }
    }
}
```

`SubModule.xml` 里对应：

```xml
<SubModules>
  <SubModule>
    <Name value="MyMod"/>
    <DLLName value="MyMod.dll"/>
    <SubModuleClassType value="MyMod.MySubModule"/>
    <Tags>
      <Tag key="DedicatedServerType" value="none"/>
      <Tag key="IsNoRenderModeElement" value="false"/>
    </Tags>
  </SubModule>
</SubModules>
```

`SubModuleClassType` 必须是**命名空间.类名**，写错就是"点开始游戏没反应"（游戏日志里会说找不到类型）。

### 3.4 主要的扩展点

| 基类 | 你在哪一层 | 常用方法 | 适合做什么 |
|---|---|---|---|
| `MBSubModuleBase` | 模块生命周期 | `OnSubModuleLoad`、`OnBeforeInitialModuleScreenSetAsRoot`、`OnGameStart`、`OnApplicationTick` | 注册行为、加载配置、全局初始化 |
| `CampaignBehaviorBase` | 战役（大地图） | `RegisterEvents(CampaignGameStarter)`、`OnSessionLaunched`、`OnGameLoaded`、`OnNewGameCreated`、`SyncData(IDataStore)` | 加规则、加菜单、加事件、存自定义数据 |
| `MissionBehavior` / `MissionLogic` | 战场（3D 场景） | `OnBehaviorInitialize`、`OnMissionTick`、`OnAgentBuild` | 战斗机制、士气、AI |
| `MissionView` | 战场 UI | `OnMissionScreenInitialize`、`AfterAddTeam` | 战场 HUD |
| `GameState` | 界面状态机 | `OnActivate`/`OnDeactivate` | 自定义界面（整屏） |
| Gauntlet prefab + `ViewModel` | UI | XML + C# ViewModel | 界面改造（**优先用 UIExtenderEx**，见 4.1） |

一个存档安全的 `CampaignBehavior` 骨架（`SyncData` 是自定义存档数据的唯一正确入口）：

```csharp
using TaleWorlds.CampaignSystem;
using TaleWorlds.SaveSystem;

namespace MyMod
{
    public class MyBehavior : CampaignBehaviorBase
    {
        private int _myCounter;

        public override void RegisterEvents()
        {
            CampaignEvents.DailyTickEvent.AddNonSerializedListener(this, OnDailyTick);
        }

        private void OnDailyTick()
        {
            _myCounter++;
        }

        public override void SyncData(IDataStore dataStore)
        {
            dataStore.SyncData("MyMod_Counter", ref _myCounter);   // 读档时自动同步
        }
    }
}
```

在 `MBSubModuleBase` 里注册它（`OnGameStart`）：

```csharp
protected override void OnGameStart(Game game, IGameStarter gameStarter)
{
    if (game.GameType is Campaign)
        ((CampaignGameStarter)gameStarter).AddBehavior(new MyBehavior());
}
```

`SyncData` 的两个陷阱值得提前知道：

1. **删字段 = 老存档崩**。要删就把字段留着不再使用，或者接受"新存档"；
2. 数据的 key 一旦发布**不要改名**，改名等于丢数据（老存档里还是旧 key）。

---

## 4. 和框架库共存（新手最容易炸的地方）

Bannerlord 的 mod 生态高度依赖四个社区库，它们的关系不是"随便装一个"，而是**一个栈**：

```
Bannerlord.Harmony        ← 提供唯一的 0Harmony.dll（mod 之间共享，避免多份 Harmony）
  └─ Bannerlord.ButterLib  ← 通用补丁/兼容层、崩溃转储
       └─ Bannerlord.UIExtenderEx ← 多个 mod 同时改同一个界面
            └─ MCM (Bannerlord.MBOptionScreen) ← 设置菜单
```

### 4.1 什么时候需要它们

| 你要做的事 | 需要的库 | 备注 |
|---|---|---|
| Harmony patch 原版方法 | `Bannerlord.Harmony` **硬依赖** | 你的 bin 里不要放 `0Harmony.dll` |
| 改/插游戏界面 | `UIExtenderEx` | 比直接 patch UI 稳 |
| 想更安全的崩溃信息、通用工具 | `ButterLib` | 可选但推荐 |
| 给自己的 mod 加设置菜单 | `MCM` | 需要上面三个都装 |

### 4.2 依赖要怎么声明

Harmony 的做法（Bannerlord.Harmony README 原文）：NuGet 引用 `Lib.Harmony` **仅编译用**，运行时由模块提供；`SubModule.xml` 里加：

```xml
<DependedModules>
  <DependedModule Id="Bannerlord.Harmony" DependentVersion="v2.10.1"/>
</DependedModules>
```

MCM 的做法（MCM README 原文）：`PackageReference` 必须带 `IncludeAssets="compile"`，否则会把库打进你的输出（README 里写的版本号是它发布时的示例值，取最新请看 nuget.org）：

```xml
<PackageReference Include="Bannerlord.MCM" Version="4.3.16" IncludeAssets="compile"/>
```

**加载顺序**：`Bannerlord.Harmony` 必须排在最前；MCM、ButterLib、UIExtenderEx 依次在其后，你的 mod 在最后。（原版启动器手动拖，或者用 BLSE 的 `LauncherEx` 自动排序。）

### 4.3 更细的依赖/排序声明：`DependedModuleMetadatas`

原版只认"有依赖/没依赖"，BLSE 扩展了一套更细的元数据（BLSE README 原文），支持 `order`、`optional`、`version` 通配、`incompatible`：

```xml
<DependedModuleMetadatas>
  <DependedModuleMetadata id="Bannerlord.Harmony" order="LoadBeforeThis"/>
  <DependedModuleMetadata id="Native" order="LoadAfterThis" version="e1.5.*"/>
  <DependedModuleMetadata id="StoryMode" order="LoadAfterThis" optional="true"/>
  <DependedModuleMetadata id="SomeOtherMod" incompatible="true"/>
</DependedModuleMetadatas>
```

用 `order="LoadBeforeThis"` 省掉"玩家没按顺序装就崩"的一大类问题。另外 BLSE 还定义了 `<Url>`（关联 Nexus 页面，崩溃报告能自动归因到 mod）。

### 4.4 版本号怎么理解

`SubModule.xml` 的 `<Version>` 与游戏的 `e1.5.7` 是两套东西；`DependentVersion` 里写的是**模块自己的版本**，不是游戏版本。Harmony 模块的版本号还有自己的编码规则（`2.0.2.22` = Harmony 2.0.2.0 + Build 22），见 Harmony README。

---

## 5. 资源与场景（C 路线）

这条路必须用 Modding Kit，官方文档覆盖得比代码部分好得多：

- **资产导入总流程**：[Adding & Overriding Assets](https://moddocs.bannerlord.com/asset-management/asset-types/overriding_assets/)、[Meshes](https://moddocs.bannerlord.com/asset-management/asset-types/meshes/)、[Textures](https://moddocs.bannerlord.com/asset-management/asset-types/textures/)、[Materials](https://moddocs.bannerlord.com/asset-management/asset-types/materials/)
- **命名/路径约定**（不遵守会出现"资源找不到"）：[Naming Conventions](https://moddocs.bannerlord.com/asset-management/asset-types/asset_naming_conventions/)、[Paths](https://moddocs.bannerlord.com/asset-management/asset-types/path/)
- **场景编辑器**：[Terrain Creation](https://moddocs.bannerlord.com/editor/scene-editor/terrain_creation/)、[Navmesh](https://moddocs.bannerlord.com/editor/scene-editor/nav_mesh/)、[Editor Shortcuts](https://moddocs.bannerlord.com/editor/scene-editor/editor_shortcuts/)
- **什么样的场景才算"能用"**：[Village](https://moddocs.bannerlord.com/authoring-mission-scenes/villages/) / [Siege](https://moddocs.bannerlord.com/authoring-mission-scenes/sieges/) / [Arena](https://moddocs.bannerlord.com/authoring-mission-scenes/arenas/) / [Hideout](https://moddocs.bannerlord.com/authoring-mission-scenes/hideouts/)
- **音频**：[FMOD Studio 工作流](https://moddocs.bannerlord.com/audio-modding/audio-modding-overview/)
- **海战（War Sails）**：[Ship Creation](https://moddocs.bannerlord.com/war-sails/ship_creation/)
- **性能**：[Scene Performance Guide](https://moddocs.bannerlord.com/bestpractices/scene_performance_guide/)

社区侧最全的美术工作流是 **BannerlordModding.LT** 的 3D 分区（Blender → FBX → Editor，含 LOD、权重、碰撞体、布料）：[3D Workflow](https://docs.bannerlordmodding.lt/3d/workflow/)。查 `.tpac` 里的原版资源用 [TpacTool](https://github.com/szszss/TpacTool)。

两条经验（来自社区文档，不是官方）：

1. **不要直接改 `Native` 模块**——官方 FAQ 明确说不可改，只能在自己的模块里覆盖；
2. 场景 mod 的发布包要**剔除 `SceneEditData`、`Assets`、`AssetSources`**，否则包体可能大好几倍。

---

## 6. 调试与排错

### 6.1 先看日志

| 日志 | 位置 / 打开方式 |
|---|---|
| 游戏日志 | 启动器 → 或者 `%USERPROFILE%\Documents\Mount and Blade II Bannerlord\logs\` |
| Harmony 调试输出 | 环境变量 `MONOMOD_DEBUG=1`（或 mod 内 `Harmony.Debug`），输出 `harmony.log.txt`；Bannerlord.Harmony 还带了 `Ctrl+Alt+H` 的调试界面 |
| 崩溃转储 | ButterLib 的 crash dump（[用法](https://butr.github.io/documentation/advanced/using-butterlib-crash-dump/)）、TaleWorlds 自带崩溃报告（[用法](https://butr.github.io/documentation/info/using-taleworld-crash-dump/)） |

### 6.2 高频故障对照

| 现象 | 最常见原因 | 处理 |
|---|---|---|
| 启动器里看不到 mod | 文件夹名 ≠ `Id`；XML 不合法 | 对齐名字、用 XML 校验 |
| 勾上 mod 但游戏里毫无变化 | `<SubModules>` 缺 `DLLName`/`SubModuleClassType` 写错 | 看日志里的类型加载错误 |
| 进游戏立刻崩，栈里有 `0Harmony` | bin 里放了第二份 Harmony | 删掉自己 bin 里的 `0Harmony.dll`，改硬依赖 |
| 和别的 mod 一起装就崩 | 加载顺序 / 两份同版本库 | 用 BLSE LauncherEx 排顺序，统一依赖版本 |
| 编辑器打不开 | 装了带 DLL 的 mod，但没把 DLL 复制到 `Win64_Shipping_wEditor`；或 Kit 与游戏版本不一致 | 官方 FAQ 的对应条目 |
| 上传 Workshop 后自己的 mod 不生效 | 游戏优先从 `Modules` 读，不从 workshop 目录读 | 测试时先把本地模块目录挪走（官方文档明确写了） |
| 存档打过一次就崩 | 改了 `SyncData` 的字段/key | 回滚字段名，或换新档 |

### 6.3 找 API 的正确顺序

1. **apidoc**（官方、按版本）：<https://apidoc.bannerlord.com/> —— 注意它**有滞后**：2026-11-14 我核验时它列到 `1.4.8`，而游戏已经 `1.5.7`；
2. **dnSpy/ILSpy 直接看游戏 DLL**（永远和你的版本一致，最可靠）；
3. **BUTR 的 Reference Assemblies**（每个游戏版本的引用程序集，便于编译旧版本）：<https://github.com/BUTR/Bannerlord.ReferenceAssemblies>；
4. 社区 API 索引：<https://bannerlordapi.butr.link/>。

---

## 7. 发布

### 7.1 Steam Workshop（官方流程）

1. Modding Kit 里 `File → Publish Module`，勾 `Client`（玩家用）、按需 `Dedicated Server` / `Editor`，**确认 Module 下拉框选的是自己的模块**（不选会打包 Native，耗时极长）；
2. 生成一份 `WorkshopCreate.xml`，填 `ModuleFolder`、`ItemDescription`、`Tags`（Type/Setting/GameMode/Compatible Version）、`Image`（<1MB）、`Visibility`；
3. 到 `bin\Win64_Shipping_Client` 里执行：

   ```
   TaleWorlds.MountAndBlade.SteamWorkshop.exe c:\path\WorkshopCreate.xml
   ```

4. 更新时用 `WorkshopUpdate.xml`（带 `ItemId` 和 `ChangeNotes`）。**Steam Cloud 必须开着**，否则上传会失败。

### 7.2 Nexus Mods

Nexus 是 C# mod 的主要分发地（Workshop 对 DLL mod 有限制，玩家也常用 Vortex 管理）。发布前把包整理成"解压即 `Modules\<Id>\`"的结构，Vortex 才能正确识别；社区教程：[Packing your mods for Vortex](https://docs.bannerlordmodding.com/_tutorials/packing_mods_for_vortex)。

### 7.3 自动化（进阶）

BUTR 提供 GitHub Actions 模板，一次构建同时发 Nexus / Workshop / NuGet：[Publishing Mods on GitHub Actions](https://butr.github.io/documentation/advanced/publishing-on-github/)。适合已经稳定、需要频繁发版的库或大型 mod。

---

## 8. 每次游戏更新要做什么（维护清单）

1. 改 `<DependedModuleMetadatas>` 里的 `version` 通配（如 `e1.5.*`），或确认 `DependedModules` 仍成立；
2. 针对新版本 DLL 重新编译（引用路径不变，但要重新拉最新 DLL）；
3. 检查自己覆盖的原版 XML 是否新增/改名了字段（用 dnSpy 或直接 diff 新版本 Native 的 XML）；
4. 跑一遍进游戏 → 读档 → 触发自己 feature 的冒烟测试；
5. 更新 mod 版本号、Workshop 的 Compatible Version 标签、Nexus 的版本说明；
6. 大版本（1.4 → 1.5）之后，`SyncData` 的兼容性要专门验证：老档进新版本 mod。

---

## 9. 学习路径（按顺序，别乱跳）

1. 官方 Quick Guide 建模块 → 本指南第 2 节做完，能看到自己改的武器；
2. 官方 Basic C# Mod 教程（Hello World 按钮）→ 理解 `MBSubModuleBase`；
3. 用 `dotnet new blmodfx` 起一个模板工程 → 理解硬/软依赖与自动部署；
4. 抄一个 `CampaignBehavior`（每日 tick 加钱）→ 理解 `RegisterEvents` + `SyncData`；
5. 学 Harmony：官方文档的 [patching 章节](https://harmony.pardeike.net/articles/patching.html)，配 `Bannerlord.Harmony`；
6. 加 MCM 设置菜单（按 MCM 文档）；
7. 需要界面就用 UIExtenderEx，不要硬 patch Gauntlet；
8. 需要美术再上 Modding Kit（这一节的学习成本最高，留到最后）。

参考实现比教程更有用：BUTR 的 [PlayerSwitcher](https://github.com/BUTR/Bannerlord.PlayerSwitcher)（小而完整）、[BannerlordTweaks](https://github.com/mipen/BannerlordTweaks)（老但结构清晰）、[BannerLib](https://github.com/sirdoombox/BannerLib)（多 mod 冲突规避）。

---

## 10. 术语速查

| 词 | 含义 |
|---|---|
| Module / SubModule | 一个 mod 叫 Module；Module 里的一个 DLL 入口叫 SubModule |
| `SubModule.xml` | 模块清单：Id、版本、依赖、DLL、注册的 XML |
| Gauntlet | 游戏的 UI 框架（XML prefab + C# ViewModel） |
| `.tpac` | TaleWorlds 资源包格式（Warband 的 BRF 的替代） |
| `MBSubModuleBase` | C# mod 的入口类 |
| `CampaignBehaviorBase` | 大地图规则/事件的挂载点 |
| `MissionBehavior` | 战场内的行为挂载点 |
| `SyncData` | 自定义存档数据的读写入口 |
| BL / WS | 本体（Base）版本 / War Sails 资料片版本 |
| BLSE / BUTRLoader | 社区启动器扩展（排序、兼容检查、崩溃拦截） |
| MCM / MBOptionScreen | 统一的 mod 设置菜单库 |
| Harmony | 运行时方法 patch 库（modding 的事实标准） |

---

## 11. 诚实的边界

- 本指南的**代码骨架没有编译过**：容器里没有 Windows、没有 .NET Framework、没有游戏 DLL。`MBSubModuleBase`/`CampaignBehaviorBase` 的签名按 1.4–1.5 的公开资料写，**以 apidoc 或 dnSpy 为准**；Harmony 与 MCM 的示例只演示结构与依赖写法，不作为可编译代码。
- 版本号（BL 1.5.7 / WS 1.3.7）来自 2026-11-11 的官方补丁公告；apidoc 只到 1.4.8，这个滞后是官方文档的现状，不是笔误。
- 中文社区链接（骑砍中文站等）在 2026-11-14 从这台机器**连不上**（DNS/连接失败），所以没有收录；如果你在 Windows 上能开，补进 `links.md` 即可。
- 官方论坛与 Nexus 对 curl 返回 403（Cloudflare），浏览器可正常访问——`links.md` 里标了"自动化拉取 403"。
