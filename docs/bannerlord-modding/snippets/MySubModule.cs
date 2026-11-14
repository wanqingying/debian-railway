// MySubModule.cs — C# mod 的入口类。
// 适用：BL 1.5.x。未编译验证；签名以 https://apidoc.bannerlord.com/ 或 dnSpy 打开
// TaleWorlds.MountAndBlade.dll 为准。
using TaleWorlds.CampaignSystem;
using TaleWorlds.Core;
using TaleWorlds.Library;
using TaleWorlds.Localization;
using TaleWorlds.MountAndBlade;

namespace MyMod
{
    /// <summary>
    /// SubModule.xml 里 &lt;SubModuleClassType&gt; 指向的类，一个 DLL 一个。
    /// 生命周期顺序大致是：
    ///   OnSubModuleLoad（加载模块，最早，用来 PatchAll / 读配置）
    ///   OnBeforeInitialModuleScreenSetAsRoot（主菜单出现前）
    ///   OnGameStart（点开始游戏、进入 Campaign 或 Mission 时）
    ///   OnApplicationTick（每帧；慎用，别做重活）
    /// </summary>
    public class MySubModule : MBSubModuleBase
    {
        protected override void OnSubModuleLoad()
        {
            base.OnSubModuleLoad();

            // 打 Harmony patch（需要 Bannerlord.Harmony 作硬依赖，见 SubModule.xml）
            // new Harmony("com.example.mymod", "1.0.0").PatchAll();

            // 标题界面加一个按钮（官方 Hello World 的写法，逐字来自官方教程）
            Module.CurrentModule.AddInitialStateOption(new InitialStateOption(
                "MyModMessage",
                new TextObject("MyMod: hello"),
                9990,
                () => InformationManager.DisplayMessage(new InformationMessage("Hello from MyMod")),
                () => (false, null)));
        }

        protected override void OnGameStart(Game game, IGameStarter gameStarter)
        {
            base.OnGameStart(game, gameStarter);

            // 只有战役模式才挂 CampaignBehavior；竞技场/自定义战斗里没有 Campaign
            if (game.GameType is Campaign)
            {
                ((CampaignGameStarter)gameStarter).AddBehavior(new MyBehavior());
            }

            // 战场行为挂在 Mission 上，不是这里：
            //   Mission.Current.AddMissionBehavior(new MyMissionBehavior());
        }

        protected override void OnSubModuleUnloaded()
        {
            // 释放你自己的资源；Harmony patch 通常不用手动撤销（进程会退）
            base.OnSubModuleUnloaded();
        }
    }
}
