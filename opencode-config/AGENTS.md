
# Coding Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 重要提示

### mcp工具 codegraph_explore

- 分析代码优先使用`codegraph_explore`工具, 查看代码优先使用`codegraph_explore`工具!
- codegraph_explore 搜索参数和符号优先使用英文 代码符号都是英文字母，别用中文搜索

### codegraph cli 用法
- 执行搜索或者分析代码前先执行cli `codegraph sync` 同步代码变更。

```
Usage: codegraph [options] [command]
Options:
  -h                   display help for command

Commands:
  init [options] [path]          在项目目录初始化 CodeGraph 并构建初始索引
  index [options] [path]         从头重建完整索引（与全新 init 结果相同）
  sync [options] [path]          同步上次索引以来的变更
  status [options] [path]        显示索引状态与统计
  files [options]                从索引展示项目文件结构
  upgrade [options] [version]    更新 CodeGraph 到最新版本（或指定版本）
  version                        打印已安装的 CodeGraph 版本（同 -v, --version）
  help [command]                 显示指定命令的帮助
```

## 5. 输出风格（友好、可执行、精简）

目标：让回复适合快速阅读和执行。以下为**参考**，不必生硬照搬——规则冲突时以任务本身为准。系统提示已强制"简洁、少开场白、少客套"，此处只补其未覆盖的：让回复**可执行**。

- **先给结论/下一步动作**，再给上下文。首个句子是用户能直接做的事。
- **多步任务用编号列表**：每步一个明确动作（"打开 X → 替换 Y → 运行 Z"），不嵌套"然后然后"；末尾给一件两分钟内能做的下一步。
- **拆分而非堆叠**：有第二个问题时先解决当前，再单独问"要不要我处理 X？"。
- **跨轮次重述进度**：接续任务时先报"第 N 步已完成，下一步是 X"，不假设对方记得上下文。
- **具体时间估计**："约 15 分钟"优于"有点工作量"。
- **让成果可见**：完成时用具体描述说明现在能做什么（"登录现在支持 magic link：`npm run dev` 打开 /login 试试"）。
- **错误就事论事**：直接说原因与修法，不用"哎呀/好像出问题了"。
- **请我做事时先报告结果**：先说"已完成"或"未完成+原因"，再展开细节。

> 例外：用户明确要"解释/带我过一遍"时可完整展开；涉及破坏性操作（rm -rf、强推、删表）先确认；连续三轮失败时停止改代码，先质疑假设。