# 飞书 / Lark CLI（lark-cli）

飞书官方命令行工具（[larksuite/cli](https://github.com/larksuite/cli)，MIT），覆盖消息、云文档、多维表格、电子表格、日历、邮箱、任务、会议等 18 个业务域、200+ 命令。镜像里钉住 **`1.0.99`**（BD-004），安装与锁点见 [versions/bd/BD-004.md](../versions/bd/BD-004.md)。

它是 agent 读写飞书的首选通道——**不要**自己拼开放平台 HTTP 请求，CLI 已经处理好鉴权、分页、scope 与错误信封。

## 常用命令

```bash
lark-cli auth status                                   # 身份与已授权 scope
lark-cli --version                                     # 注意是 --version，没有 version 子命令

# 读文档（docx 与 wiki 链接都直接可用，不必先换 token）
lark-cli docs +fetch --doc "<URL>" --doc-format markdown

# 搜云文档 / 知识库 / 表格
lark-cli docs +search --query "关键词" --page-size 10

# 其他域
lark-cli <域> --help                                   # 域：docs / im / base / sheets / calendar / task / drive / wiki …
lark-cli schema <service>.<resource>.<method>          # 某个 API 的参数、scope、示例
lark-cli skills read <name>                            # 读内嵌 skill（比 --help 更完整的用法说明）
```

## 输出约定（容易踩）

- 成功 `{ok: true, identity, data}` 写 **stdout**、退出码 0；失败 `{ok: false, error: {type, subtype, code, message, hint}}` 写 **stderr**、退出码非 0。**判成功看 `ok` 或退出码，不要看 `code`**——成功信封里没有这个字段。
- `--jq` 的路径要按信封写：读正文是 `.data.document.content`，写 `.data.content` 会得到 `null`。
- 正文里的表格保留为 HTML `<table>`（含 `colgroup`），单元格内的 @人 是 `<cite type="user" …>`，要人名得自己转。
- 身份显式化：文档操作建议 `--as user`，发消息可 `--as bot`。

## 凭证：在卷上，跨重部署有效

CLI 把 `config.json`、应用密钥密文、用户 token、DPoP 密钥和 `master.key` 放在两个**硬编码**路径——`~/.lark-cli`（配置）与 `~/.local/share/lark-cli`（凭证），既不认 `XDG_CONFIG_HOME` 也不认 `XDG_DATA_HOME`。而 `$HOME` 每次重部署清空，所以 `entrypoint.sh` 把两者软链到卷：

| 容器内路径 | 实际位置 |
| --- | --- |
| `~/.lark-cli` | `$XDG_DATA_HOME/lark-cli/config` |
| `~/.local/share/lark-cli` | `$XDG_DATA_HOME/lark-cli/data` |

`master.key` 与 `*.enc` 必须同时在卷上，缺一个就解不开。当前授权：应用 `cli_aa037cd604b85cc9`（就是 feishu-bot 那个应用）+ 用户 `qingying`。

## 重新授权（需要人扫码）

只有 `auth status` 显示未登录或 scope 不足时才做，**不要随手重登**。

```bash
lark-cli auth login --recommend --no-wait     # 立刻返回 verification_url + device_code
lark-cli auth qrcode "<verification_url>" --output /tmp/lark-qr.png   # 把二维码给用户
lark-cli auth login --device-code "<device_code>"                      # 用户确认后再执行
```

- 每次重试都会**作废上一轮的 device code**，不要用短超时反复重试。
- 需要指定权限：`--domain calendar,task` 或 `--scope "docs:document.content:read"`。
- 用户要在浏览器里完成：容器里的 VNC 浏览器（`docs/interactive-browser.md`）或用户自己的手机扫码都可以。

## Agent skills

镜像只烤了三个：`lark-shared`（配置/认证/身份，其余 skill 的前置）、`lark-doc`（文档读写）、`lark-wiki`（知识空间与节点）。

仓库里共 28 个 skill，全部烤入会让每个 skill 的 `description` 都进每一轮上下文（约 1.2 万字符、≈3.5k token/轮），所以其余用 `lark-cli skills read <name>` 按需读——它们内嵌在二进制里，永远与 CLI 版本一致。要长期常用的，照 `opencode-config/opencode/skills/lark-*` 的样子把仓库 `skills/<name>/` 拷进来再部署。

## 已知限制

- 上游明确提示：这个工具可被 AI Agent 调用，存在幻觉、执行不可控、提示词注入风险，建议只当私人助手用，不要拉进群聊或允许他人与之交互。
- 风控信号默认开启（每次请求带 OS 类型与设备型号，用于识别异常调用）。`config risk-control off` 可关，**默认不要关**。
- `vc:meeting.realtime:read` 是企业管理员禁止申请的权限，`--recommend` 会报告它未授予——正常，不要重试。
- npm 包本体只是 JS 启动器，真正的 Go 二进制由 postinstall 从 GitHub Releases 拉取；构建期偶发 504 会让 `railway up` 失败一次，重试即可。

## 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `{"ok": false, "error": {"type": "config", "subtype": "not_configured"}}` | 没配置应用，或 `~/.lark-cli` 软链断了：检查 `ls -l ~/.lark-cli`，应指向 `$XDG_DATA_HOME/lark-cli/config` |
| 授权后重部署又要重登 | 卷上缺 `master.key` 或 `*.enc`，或软链没建立（看 `entrypoint.sh` 的 lark-cli 段日志） |
| `unknown command "version"` | 用 `--version` |
| `jq error: cannot iterate over: null` | `--jq` 路径写错，正文在 `.data.document.content` |
| `code: 99991672 / permission denied` | 该域 scope 未授权：`auth login --domain <域>` 重新授权 |
