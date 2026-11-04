# Skill 设计指南

创建、优化、修改 skill 时遵循的原则。依据见文末来源；仓库里现有的 skill 不是范本。

## 核心认识

- **skill 只写模型不知道、不写就会做错的东西。** 人从真实踩坑中提炼的 skill 有效（SkillsBench：通过率 +16.6 pp），LLM 凭通用知识写的基本无效（SkillAxe）。
- **短而聚焦胜过大而全。** 正文只放每次都需要的内容，场景细节放 references 按需读。
- **调用不是理所当然的。** 只靠 description，召回率实测常在 20%–50%。触发和执行是两件事，要分别保证、分别验证。
- **skill 是会演化的资产。** 从几行加一条踩坑开始，每纠正一次模型就补一条；没人用的要删。

## 选对载体

- 每次会话都要遵守的规则、横向知识 → `AGENTS.md`
- 一类任务的专门流程、本地知识、踩坑清单 → skill
- 确定性的单一动作 → 插件工具 / MCP
- 必须 100% 执行的约束 → hook、CI、校验脚本强制，skill 只负责说明

相关场景合并成一个 skill，不要拆成多个职责重叠的小 skill：它们会互相抢触发、指令冲突。

## description：决定会不会被调用

- 写**触发条件**，不写内容摘要。"何时使用"只能写在这里，正文在触发前看不到。
- 用用户的说法（含中文口语），覆盖用户没点名领域的情况；语气果断（"在……时使用""遇到……一律调用"）。
- 加该 skill **独有的锚点**（文件扩展名、产物名、内部系统名）；不要用"评审""分析"这类通用动词做锚点，它们只会抢走别的 skill 的触发。
- 有相邻 skill 时写清边界。
- 1–3 句、≤ 1024 字符，单行带引号，不用 `>-` 多行块。
- 模型需要自主调用的 skill，在 AGENTS.md 里加一行"任务类型 → skill 名"的路由，这是实测最稳定的手段。

## 正文：决定调用后能不能做对

- **删减测试**：删掉这句模型行为不变，就删。不解释常识。
- **踩坑清单优先**：反直觉的环境事实价值最高，放正文里，让模型在踩坑前读到。
- **按脆弱程度定约束**：默认写目标和约束，给模型留判断空间；只在破坏性、顺序固定、必须一致的地方写死步骤。
- **解释原因，少用全大写 MUST**：模型理解目的，才能处理规则没覆盖的情况。
- **给默认，不给菜单**：一个默认方案 + 必要的例外。
- **教方法，不给某一题的答案**：要能泛化到这一类任务。
- 正文 ≤ 500 行 / 约 5000 token（中文约 1 字 1 token）；引用写清"什么情况读哪个文件"，只引一层。
- 确定、重复、要求精确的操作写成脚本：非交互、结构化输出、错误可操作、依赖锁版本。

## 验证

- 先找出不带 skill 时模型错在哪，再写内容；改已有 skill 先快照旧版做基线。
- 触发和执行分开测：触发用应触发 / 近似干扰项两类真实口吻的 prompt；执行先点名调用排除触发因素。
- 带 skill 与基线对照，每次用干净上下文，多跑几次；读执行轨迹，不只看结果。
- 改了一个 skill 的 description，相邻 skill 也要复测。
- 在实际会执行它的模型上测。

## 安全与维护

- 第三方 skill 当作外部代码：装之前通读全部文件，正文里的指令也可能有恶意。
- 不写入密钥；最小权限。
- 每个 skill 有负责人；模型升级后重跑评测；定期删掉没人用的。

## 本容器约束

- Railway：`opencode-config/opencode/skills/<name>/`，启动时同步到卷上，**只覆盖不删除**，删除或改名要在 `entrypoint.sh` 里清理旧目录。
- devcontainer-demo：`.devcontainer/opencode/skills/`，与 Railway 互不同步，两边都用的要两边都改（Railway 先）。
- 不建同名 command，它会遮蔽 skill。
- OpenCode 忽略 `allowed-tools`、`disable-model-invocation` 等 Claude Code 扩展字段，不要依赖。
- skill 的持久数据写到 `/workspace` 卷上；skill 目录会被镜像版本覆盖。
- 引入第三方 skill 保留 LICENSE，本地适配写成文件开头的前言，便于重新同步上游。

## 来源

- 规范与最佳实践：[agentskills.io](https://agentskills.io/skill-creation/best-practices)、[Anthropic skill authoring](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)、[OpenCode skills](https://opencode.ai/docs/skills/)
- 论文：[SkillsBench](https://arxiv.org/abs/2602.12670)、[SkillAxe](https://arxiv.org/abs/2606.10546)
- 实践：[Thariq / Anthropic](https://claude.com/blog/lessons-from-building-claude-code-how-we-use-skills)、[Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)（[HN 讨论](https://news.ycombinator.com/item?id=46809708)）、[Sam McLeod](https://smcleod.net/2026/07/writing-and-reviewing-agent-skills-common-pitfalls)、[UiPath 触发实测](https://www.reddit.com/r/claudeskills/comments/1waq4j9/)
