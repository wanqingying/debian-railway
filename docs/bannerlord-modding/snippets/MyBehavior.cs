// MyBehavior.cs — 大地图（战役）行为的骨架。
// 适用：BL 1.5.x。未编译验证；事件名以 apidoc 为准（CampaignEvents 的成员随版本增删）。
using TaleWorlds.CampaignSystem;
using TaleWorlds.SaveSystem;

namespace MyMod
{
    /// <summary>
    /// CampaignBehaviorBase 是"在地图上持续存在、跟着存档走"的挂载点。
    /// 两条铁律：
    ///   1. 所有要进存档的字段必须走 SyncData，否则读档后回到默认值。
    ///   2. SyncData 的 key 一旦发布不要改名；删字段会让老存档反序列化失败。
    /// </summary>
    public class MyBehavior : CampaignBehaviorBase
    {
        private int _daysSinceMyEvent;

        public override void RegisterEvents()
        {
            // 用 AddNonSerializedListener：监听器本身不进存档（读档后重新注册）
            CampaignEvents.DailyTickEvent.AddNonSerializedListener(this, OnDailyTick);
            CampaignEvents.OnSessionLaunchedEvent.AddNonSerializedListener(this, OnSessionLaunched);
        }

        private void OnDailyTick()
        {
            _daysSinceMyEvent++;

            if (_daysSinceMyEvent >= 7)
            {
                _daysSinceMyEvent = 0;
                // 示例动作：给玩家一点钱；真实逻辑放这里或拆成别的服务类
                // Hero.MainHero.Gold += 100;
            }
        }

        private void OnSessionLaunched(CampaignGameStarter starter)
        {
            // 加菜单/对话/任务的地方（AddPlayerLine / AddDialogLine / AddGameMenu）
        }

        public override void SyncData(IDataStore dataStore)
        {
            dataStore.SyncData("MyMod_DaysSinceEvent", ref _daysSinceMyEvent);
        }
    }
}
