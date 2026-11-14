# 物品修改与新增：以"箭"为例

> 目标：**改原版箭的名字**、**改一袋箭的支数**、**新增一支自己的箭**。全程不写 C#。
> 适用 BL 1.5.x。所有字段说明来自官方/社区文档（链接在每节末尾），**没有在游戏里实跑验证**——这台机器没有游戏。
> 上一层的总览见 [guide.md](guide.md)；本文只讲物品这一件事。

---

## 0. 三句话版

| 想做 | 做法 | 关键字段 |
|---|---|---|
| 改原版箭的名字 | 写一个**同 id** 的 `<Item>`，只改 `name`，且**换一个新的字符串 key** | `id` 不变、`name="{=你的新key}新名字"` |
| 改一袋箭的支数 | 同 id 覆盖，只改武器组件里的 `stack_amount` | `<Weapon weapon_class="Arrow" stack_amount="40" .../>` |
| 新增一支箭 | **新 id** + 抄原版全部字段 + 新 key + 注册 XML | `id="my_arrows"`、`<Xmls>` 注册 |

三件事可以写进**同一个文件**，见 [snippets/arrows_items.xml](snippets/arrows_items.xml)。

---

## 1. 先找到原版箭定义在哪

物品定义不在单个 `items.xml` 里，而是在**一个目录**下按类别分文件：

```
<游戏根>\Modules\SandBoxCore\ModuleData\items\
    weapons.xml
    head_armors.xml
    horses_and_others.xml
    ...
```

（社区文档：`Folder` 一节写的是 `\Modules\SandBoxCore\ModuleData\items`，示例里 `head_armors.xml` 就在这个目录下。）

**Windows 上最快的定位方法**（不用装 rg，PowerShell 自带）：

```powershell
$items = "$env:BANNERLORD_GAME_DIR\Modules\SandBoxCore\ModuleData\items\*.xml"
Select-String -Path $items -Pattern 'weapon_class="Arrow"' |
    Select-Object Filename, LineNumber, Line
```

输出会告诉你「哪个文件、第几行」。然后打开该文件，往上找到最近的那个 `<Item id="...">`，那就是原版箭的物品 id（装备/兵种 XML 里用 `Item.<id>` 引用它）。

> 有 `rg`（ripgrep）更快：`rg -n -C 5 'weapon_class="Arrow"' "%BANNERLORD_GAME_DIR%\Modules\SandBoxCore\ModuleData\items"`
>
> 参考：[BannerlordModding.LT — Items](https://docs.bannerlordmodding.lt/modding/items/)（含"如何查 ItemID / mesh"）

---

## 2. 一支箭由哪些字段组成

外层是 `<Item>`，弹药属性在 `<ItemComponent><Weapon>` 里：

```xml
<Item id="vanilla_arrow_id" name="{=AbCd1234}Arrows"
      mesh="arrow"            <!-- 3D 模型名，界面图标也用这个 -->
      culture="Culture.vlandia"  <!-- 可选：只在同文化城镇出售 -->
      weight="0.05" value="30" difficulty="0"
      is_merchandise="true"      <!-- false + 冷门 culture = 不进商店/战利品 -->
      Type="Arrows">
  <ItemComponent>
    <Weapon weapon_class="Arrow"   <!-- 必须是 Arrow -->
            ammo_class="Arrow"
            stack_amount="25"      <!-- ★ 一袋几支 -->
            thrust_damage="2"      <!-- 每支伤害 -->
            thrust_damage_type="Pierce"
            missile_speed="75"
            item_usage="arrow_right" <!-- 挂在身上的方式：箭袋在右 -->
            physics_material="missile"
            sticking_position="0,-0.97,0"
            sticking_rotation="90,0,0"
            passby_sound_code="event:/mission/combat/missile/passby"
            flying_sound_code="event:/mission/combat/missile/foley/flying" />
  </ItemComponent>
</Item>
```

| 字段 | 作用 | 依据 |
|---|---|---|
| `id` | 物品 id；装备/兵种/商店都用它引用 | 社区文档 |
| `name` | 显示名。`{=key}文本` 里 `key` 是**全局唯一**的字符串 id，8 位随机字母数字是社区惯例 | 官方本地化文档 |
| `mesh` | 3D 模型名；和 id **通常不同**，是 Blender/TpacTool 用的名字 | 社区文档 |
| `culture` | 只在同文化市场的城镇出售；不写 = 到处都有 | 社区文档 |
| `is_merchandise` | 是否可买卖/掉进战利品。`false` + `Culture.looter` 之类 = 不进商店 | 社区文档 |
| `value` / `weight` | 价格 / 重量 | 社区文档 |
| `Type` | `ItemTypeEnum` 的成员，箭是 **`Arrows`**（枚举里有 `Arrows`、`Bolts`、`SlingStones`、`Goods`…） | apidoc 的 `ItemObject.ItemTypeEnum` |
| `weapon_class` | 取值表：`OneHandedAxe, Bow, OneHandedSword, TwoHandedPolearm, Crossbow, Stone, Arrow, Boulder, Bolt, LargeShield, Banner` | 社区文档 Weapon 页 |
| `ammo_class` | `Arrow / Bolt / Stone / Boulder` | 同上 |
| **`stack_amount`** | **"Amount of projectiles the weapon (arrows, bolts, stones) has"——一袋多少支** | 同上 |
| `thrust_damage` | 每支造成的伤害 | 同上 |
| `item_usage` | 持有姿势，箭用 `arrow_right`（也有 `arrow_top`） | 同上 |
| `physics_material` | `missile` 是弹药；近战用 `metal_weapon` 等 | 同上 |

⚠️ **`ammo_limit` 别乱设**：官方文档明确写着「Amount of ammo stored in the weapon. If set to 2 game will be closed when enter the battle」。箭的数量用 `stack_amount`，不是 `ammo_limit`（后者是弓弩本身的概念）。

参考链接：
[Items（社区）](https://docs.bannerlordmodding.com/_xmldocs/items) ·
[Weapon 属性全表](https://docs.bannerlordmodding.com/_xmldocs/items/item/itemcomponent/weapon) ·
[SubModule 注册（社区）](https://docs.bannerlordmodding.com/_xmldocs/submodule) ·
[apoic ItemTypeEnum](https://apidoc.bannerlord.com/)

---

## 3. 场景 A：改原版箭的名字

### 做法

在**你自己的模块**里写一个同 id 的 `<Item>`。注意覆盖的语义是**整对象互相覆盖**（社区文档原话："they will Overwrite each other in ModLoading Order"），**不是字段级合并**——你漏写的属性不会从原版继承，而是变成默认值。所以必须**抄全原版那一段**，再改你想改的字段：

```xml
<Item id="vanilla_arrow_id" name="{=myarrows01}我的箭"
      mesh="arrow" culture="Culture.vlandia" weight="0.05" value="30"
      is_merchandise="true" Type="Arrows">
  <ItemComponent>
    <Weapon weapon_class="Arrow" ammo_class="Arrow" stack_amount="25"
            thrust_damage="2" thrust_damage_type="Pierce" missile_speed="75"
            item_usage="arrow_right" physics_material="missile"
            sticking_position="0,-0.97,0" sticking_rotation="90,0,0"/>
  </ItemComponent>
</Item>
```

### 为什么名字要换一个新 key（重点，最容易白干的一步）

原版是 `name="{=AbCd1234}Arrows"`。这里的 `{=AbCd1234}` 指向本地化字符串：

- **英文**（游戏默认语言）用 XML 里 `{=...}` 后面那段内联文本；
- **其它语言**用 `ModuleData\Languages\<语言>\std_module_strings_xml.xml` 里同一个 id 的译文。

所以如果你**保留原 key、只改内联文本**，中文界面下显示的仍是语言文件里的旧译文——看起来"改了没生效"。

两个可靠做法：

1. **换新 key（推荐）**：`name="{=myarrows01}我的箭"`。新 key 在任何语言文件里都不存在，所以你写什么就显示什么（要给别人用再补翻译文件）。
2. 保留原 key，在自己的模块里放 `ModuleData\Languages\简体中文\std_module_strings_xml.xml`，用**同一个 id** 写新译文。这依赖"后加载的模块覆盖先加载的字符串"，**文档没写明，未验证**，所以更推荐做法 1。

> 官方本地化规则（字符串 id 全局唯一、内联文本英文、语言文件负责译文）：[Localization](https://docs.bannerlordmodding.com/_csharp-api/localization/)；语言文件目录结构：[BannerlordModding.LT — Localization](https://docs.bannerlordmodding.lt/modding/localization/)

---

## 4. 场景 B：改一袋箭的支数

同一个同 id 覆盖，只动 `stack_amount`：

```xml
<Weapon weapon_class="Arrow" ammo_class="Arrow"
        stack_amount="80"        <!-- 25 → 80 -->
        thrust_damage="2" thrust_damage_type="Pierce" missile_speed="75"
        item_usage="arrow_right" physics_material="missile"
        sticking_position="0,-0.97,0" sticking_rotation="90,0,0"/>
```

效果范围要心里有数：

- `stack_amount` 是**每件物品（每袋）的支数**，也是战场上一袋能射出多少；
- 因为按 id 覆盖，**所有用这支箭的原版兵种/玩家**都会变成新数量（这正是"改原版"的语义）；
- 想只给自己用、不影响原版，就走场景 C 新增一支。

社区里同类操作（"把 Lowland Arrows 的 `stack_amount="25"` 改成 50"）就是这个字段，例子见 [BannerlordModding.LT — Items](https://docs.bannerlordmodding.lt/modding/items/)。

---

## 5. 场景 C：新增一支自己的箭

### 5.1 物品

新 id（不要和原版撞）+ 新 key：

```xml
<Item id="my_arrows" name="{=myarrows02}My Bodkin Arrows"
      mesh="arrow"            <!-- 复用原版箭的模型，省掉美术 -->
      culture="Culture.empire"<!-- 想在帝国城镇买到就写；不写则全地图都有 -->
      weight="0.05" value="45"
      is_merchandise="true"
      Type="Arrows">
  <ItemComponent>
    <Weapon weapon_class="Arrow" ammo_class="Arrow"
            stack_amount="40" thrust_damage="4" thrust_damage_type="Pierce"
            missile_speed="80" item_usage="arrow_right"
            physics_material="missile"
            sticking_position="0,-0.97,0" sticking_rotation="90,0,0"/>
  </ItemComponent>
</Item>
```

`mesh` 直接写原版的模型名（找到原版箭那行的 `mesh="..."` 抄过来）——**不用美术也能先跑通**，之后再换成自己的模型。

### 5.2 注册（漏了就是"改了没生效"）

`SubModule.xml` 里必须把它登记进 `<Xmls>`，`path` 是 `ModuleData` 下的**文件名，不带 `.xml`**：

```xml
<Xmls>
  <XmlNode>
    <XmlName id="Items" path="my_arrows"/>
  </XmlNode>
</Xmls>
```

对应文件放 `Modules\MyMod\ModuleData\my_arrows.xml`。

> "Items are not loaded from XML" 是社区文档专门列出的常见问题——绝大多数是这一步没做或路径写错。

### 5.3 中文名（可选）

想让中文界面也显示中文，加语言文件：

```
Modules\MyMod\ModuleData\Languages\简体中文\std_module_strings_xml.xml
```

```xml
<?xml version="1.0" encoding="utf-8"?>
<base type="string">
  <tags>
    <tag language="简体中文"/>
  </tags>
  <strings>
    <string id="myarrows02" text="我的破甲箭"/>
  </strings>
</base>
```

`简体中文` 这个文件夹名/`<tag language>` 用哪个字符串取决于游戏语言列表（中文客户端是 `简体中文`），拿不准就先只写英文，验证跑通后再加。

### 5.4 让它真的能用上

新物品只写在 XML 里时，它存在于游戏中，但**不会自动出现在你的背包**。三条路：

1. **商店**：`culture` 设成你常去的势力 + `is_merchandise="true"`，等库存刷新后买；
2. **兵种装备**：在兵种/装备 XML 里给它挂上（`<equipment slot="..." id="Item.my_arrows"/>`），让士兵用它；
3. **测试用 C# 直接塞进背包**（一次性脚本就可以）：

   ```csharp
   ItemObject arrows = MBObjectManager.Instance.GetObject<ItemObject>("my_arrows");
   if (arrows != null)
       MobileParty.MainParty.ItemRoster.Add(new ItemRosterElement(arrows, 5, null));
   ```

   出处：[BannerlordModding.LT — Items / Add Item to ItemRoster](https://docs.bannerlordmodding.lt/modding/items/)

控制台/作弊命令在不同版本里不一致，本文不写，避免给你一条跑不通的命令。

---

## 6. 验证清单（按顺序，每步都能独立失败）

1. 启动器 → Mods 里能看到你的模块（看不到 = `SubModule.xml` 或文件夹名有问题）；
2. 进游戏 → 角色 → 物品栏，能看到新物品（看不到 = `<Xmls>` 注册 / 文件名 / XML 报错）；
3. 名字显示对不对（显示旧名 = 第 3 节的 key 问题；显示 `{=...}` 原文 = 语法错）；
4. 装备到远程武器槽，进战场打一发：箭袋数量是否等于 `stack_amount`；
5. 读一个**改动前**的存档，确认不崩（改物品一般安全，但把物品 id 删掉/改名会导致老档引用丢失）。

排错时看日志：`%USERPROFILE%\Documents\Mount and Blade II Bannerlord\logs\`，或者在游戏目录 `ProgramData` 那个隐藏目录里搜 `null` / `invalid`（社区文档的做法）。

---

## 7. 坑表

| 症状 | 原因 | 修法 |
|---|---|---|
| 模块在启动器里能看到，游戏里没变化 | `<Xmls>` 没注册 / `path` 写成 `my_arrows.xml` | `path` 只写文件名，不带扩展名 |
| 改了名字，中文界面还是旧名 | 沿用了原版 `{=key}`，语言文件优先 | 换新 key（推荐）见 §3 |
| 显示 `{=AbCd1234}Arrows` 这种原文 | key 语法错 / key 里有空格 | `{=8位字母数字}文本`，别用空格和特殊符号 |
| **你自己的物品文件里有一个坏物品，后面的全都不出现** | 1.2.x 起，单个 `<Item>` 解析失败会中断该文件的后续解析 | 二分法删半、看日志里 `null/invalid` 行 |
| 新箭进了背包但装不上 | `Type` 不是 `Arrows`，或 `weapon_class` 不是 `Arrow` | 两个都对照 §2 的表 |
| 商店里永远买不到 | `is_merchandise="false"`，或 `culture` 指向没有市场的势力（如 `Culture.looter`） | 改 `true` / 换文化 |
| 战场上一支箭都射不出 | 把数量写进了 `ammo_limit`（那是弓弩的字段，设成 2 会直接崩） | 用 `stack_amount` |
| 和别的物品 mod 冲突 | 双方都覆盖了同一个原版物品 id，看加载顺序谁在后 | 改用 XSLT（§8）或只覆盖各自需要的那一件 |

---

## 8. 不想覆盖原版？用 XSLT

同 id 覆盖的问题是"整对象替换"：原版更新了这支箭的某个字段，你的副本不会跟着更新。用 XSLT 可以在加载时对原版 XML 做**变换**（只改一个属性），天然跟随版本更新。

官方教程：[XSLT Usage Tutorial](https://moddocs.bannerlord.com/bestpractices/xslt_usage_tutorial/)；与 Native 合并的官方建议：[Merging Module XML Files with Native](https://moddocs.bannerlord.com/bestpractices/merging_module_xml_files_with_native/)。

一个改 `stack_amount` 的 XSLT 骨架（文件名要在 `<Xmls>` 里注册成 XSLT 节点，具体写法看官方教程原文）：

```xml
<xsl:stylesheet version="1.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="node()|@*">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
    </xsl:copy>
  </xsl:template>
  <!-- 只动箭类武器组件的 stack_amount -->
  <xsl:template match="Item/ItemComponent/Weapon[@weapon_class='Arrow']/@stack_amount">
    <xsl:attribute name="stack_amount">80</xsl:attribute>
  </xsl:template>
</xsl:stylesheet>
```

> 这段 XSLT **没有实跑验证**（需要游戏加载才能验证）。先按官方教程把第一个"改一个属性"的例子跑通，再改成上面这样。

---

## 9. 附：完整可复制文件

- [snippets/arrows_items.xml](snippets/arrows_items.xml) — 覆盖原版 + 新增物品，放在 `Modules\MyMod\ModuleData\my_arrows.xml`
- [snippets/std_module_strings_xml.xml](snippets/std_module_strings_xml.xml) — 语言文件模板
- [snippets/SubModule.xml](snippets/SubModule.xml) — 模块清单（含 `<Xmls>` 注册示例）
