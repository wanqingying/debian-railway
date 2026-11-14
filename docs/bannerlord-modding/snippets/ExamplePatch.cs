// ExamplePatch.cs — 用 Harmony patch 改原版行为。
//
// 前提（缺一不可）：
//   1. SubModule.xml 里 <DependedModule Id="Bannerlord.Harmony" DependentVersion="..."/>
//   2. csproj 用 NuGet 的 Lib.Harmony，且不要把 0Harmony.dll 拷进自己的 bin
//   3. OnSubModuleLoad 里 Harmony.PatchAll()（或手工 Harmony.Patch）
//
// 未编译验证。Harmony 语法权威：
//   https://harmony.pardeike.net/articles/patching.html
// 本作里 Harmony 模块的装法（版本编码、加载顺序）：
//   https://github.com/BUTR/Bannerlord.Harmony
using HarmonyLib;

namespace MyMod.Patches
{
    /// <summary>
    /// Prefix 在目标方法**之前**执行，返回 false 可以跳过原方法。
    /// 大部分"改数值/改判定"用 Postfix 改 __result 更安全。
    /// </summary>
    [HarmonyPatch(typeof(TaleWorlds.CampaignSystem.Campaign), "get_CurrentTime")]
    internal static class CampaignCurrentTimePatch
    {
        // private static bool Prefix(ref TaleWorlds.CampaignSystem.CampaignTime __result)
        // {
        //     // 返回 false = 不执行原方法
        //     return true;
        // }

        private static void Postfix(ref TaleWorlds.CampaignSystem.CampaignTime __result)
        {
            // 示例：观测调用点，别在这里改逻辑
            // TaleWorlds.Library.Debug.Print($"[MyMod] CurrentTime asked: {__result}");
        }
    }
}

// 常用取值方式速查：
//   __instance  —— 目标实例（实例方法）
//   __result    —— 返回值，可写
//   __0, __1    —— 第 1/2 个参数，可写
//   ___field    —— 私有字段（三个下划线），名字必须与字段完全一致
//   命名参数    —— Prefix(out bool __state) + Postfix(bool __state) 在上后文之间传状态
//
// 三条经验：
//   * 能改数据就不 patch 代码（XML 覆盖 / XSLT 更稳）；
//   * patch 尽量"窄"：只 patch 具体类型的具体方法，不要 patch 基类虚方法的未知实现；
//   * 每次游戏更新后重跑一遍，Harmony 找不到目标方法会静默不生效（开 MONOMOD_DEBUG=1 看 harmony.log.txt）。
