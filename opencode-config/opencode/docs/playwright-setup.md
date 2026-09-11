# Playwright 使用指南：通过 SSH 反向隧道驱动本机浏览器

容器**不安装本地浏览器**：Playwright 通过 **CDP** 附着到**用户本机**的真实浏览器，页面、登录态、IP 都留在用户自己的电脑上，容器只发指令。提供两种用法：

- **Playwright MCP**（`playwright_browser_*` 工具，opencode 内置）
- **Playwright CLI**（`playwright-cli`，配合 `playwright-cli` skill，token 更省）

## 为什么这样接

- 容器在 Railway（海外机房），没有显示器；直接在容器里跑 headless Chrome 会遇到机房 IP 风控、登录态迁移、无法人工接管（验证码/二次验证）等问题。
- 复用本机浏览器 = 真实 IP + 已有登录态 + 有头可见 + 可人工接管。
- 容器与本机之间用 **SSH 反向隧道**（复用已有的 SSH 主入口）把本机的 CDP 端口映射到容器的 `127.0.0.1:9222`，全程加密，两端都无需暴露到公网。

## 拓扑

```
Win10 Chrome (127.0.0.1:9222)  ──SSH 反向隧道──▶  容器 (127.0.0.1:9222)
        ▲                                                ▲
   真实浏览器 / 登录态                    Playwright MCP / playwright-cli（无本地浏览器）
```

隧道由本机主动出站建立，两端都是 loopback，物理路径经 Railway 的 TCP proxy 中继。

## 一、本机（Windows）准备

### 1. 启动可调试的 Chrome

用**独立 profile** 启动（Chrome 136+ 若用默认 profile 会直接忽略 `--remote-debugging-port`）：

```powershell
& "E:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="E:\chrome-debug"
```

验证端口已开：

```powershell
Invoke-RestMethod http://127.0.0.1:9222/json/version
# 或浏览器打开 http://127.0.0.1:9222/json/version，看到 JSON 即成功
```

首次在这个调试 Chrome 里登录需要的网站即可；cookie 存在 `E:\chrome-debug`，长期有效。

### 2. 建立反向 SSH 隧道

```powershell
ssh -NT -o StrictHostKeyChecking=accept-new `
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 `
    -o ExitOnForwardFailure=yes `
    -R 9222:127.0.0.1:9222 -p <Railway公开端口> root@<Railway域名>
```

- `<Railway公开端口>` / `<Railway域名>` 用 `railway tcp-proxy list` 查（例如 `tokaido.proxy.rlwy.net:11838`）。这是裸 TCP 入口，不要用 HTTP 域名（`.up.railway.app` 是 HTTP 层，承载不了 SSH）。
- `-N` 只做转发、不开 shell：连上后无输出、光标不返回是正常的，保持窗口开着即可。
- 断线自动重连建议用 `autossh -M 0` 替换 `ssh`，或把 `RemoteForward 9222 127.0.0.1:9222` 写进 VS Code Remote-SSH 的 `~/.ssh/config`。

## 二、容器侧（已内置）

`scripts/install-tools.sh` 每次启动安装 `@playwright/mcp` 与 `@playwright/cli`；`entrypoint.sh` 导出：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PLAYWRIGHT_MCP_CONFIG` | `$XDG_CONFIG_HOME/opencode/playwright/cli.config.json` | CLI/MCP 配置，内含 `browser.cdpEndpoint = http://127.0.0.1:9222` |
| `PLAYWRIGHT_MCP_CDP_ENDPOINT` | `http://127.0.0.1:9222` | MCP 的 CDP 端点（`opencode.jsonc` 里也显式传了 `--cdp-endpoint`） |

因为有 `cli.config.json` 的 `cdpEndpoint`，**`playwright-cli open` 会附着而不是启动本地浏览器**；`close` 只断开附着，不会关掉用户的浏览器。

## 三、Playwright MCP 用法

已注册在 `opencode-config/opencode/opencode.jsonc`，**默认 `enabled: false`**（MCP 的工具 schema 常驻每一轮上下文，且快照整树内联回传，比 CLI 明显费 token；日常操作优先用上面的 CLI）。需要持久状态、探索式/迭代推理时，把 `enabled` 改为 `true` 并重启 opencode：

```jsonc
"mcp": {
  "playwright": {
    "type": "local",
    "command": ["playwright-mcp",
                "--cdp-endpoint", "http://127.0.0.1:9222",
                "--timeout-action", "20000",
                "--timeout-navigation", "20000"],
    "enabled": false
  }
}
```

- 工具名形如 `playwright_browser_*`（约 24 个：navigate/snapshot/click/type/fill_form/evaluate/tabs/network_requests 等）。
- **每个动作/导航有独立超时（20s）**：卡住的页面会快速报错返回，而不是堵死会话。
- 快照返回无障碍树与 `ref`；ref 易失效，用 `browser_find` 按文本/正则重新定位。

## 四、Playwright CLI 用法（skill）

配套 skill：`opencode-config/opencode/skills/playwright-cli/`（官方 skill，含 9 篇 references）。常用：

```bash
playwright-cli open https://example.com    # 附着到隧道浏览器并导航
playwright-cli snapshot                    # 取 ref 快照
playwright-cli click e15
playwright-cli type "hello"
playwright-cli find "Sign in"              # 按文本查快照，重定位
playwright-cli screenshot --filename=page.png
playwright-cli tab-list
playwright-cli close                       # 仅断开附着
```

- 会话默认内存态；`-s=<name>` 指定会话，`playwright-cli list` / `close-all` / `kill-all` 管理。
- `--headed` / `--persistent` / `--profile` 等启动参数对本容器无意义（不启动本地浏览器）。
- 可选 `playwright-cli show` 打开可视化面板（需端口转发才有意义）。

## 五、验证

```bash
# 1) 隧道通不通（返回 Chrome 版本 JSON 即通）
curl -s http://127.0.0.1:9222/json/version

# 2) MCP：调用 playwright_browser_tabs 应列出本机浏览器标签

# 3) CLI：
playwright-cli open https://example.com
playwright-cli snapshot
playwright-cli close
```

## 六、重部署 / 重启后恢复

容器每次重新部署都会重生成 SSH host key 并重启 sshd，**隧道必断**：

1. 判断：`curl -s http://127.0.0.1:9222/json/version` 失败 / 报 `ECONNREFUSED 127.0.0.1:9222`。
2. 查当前入口：`railway tcp-proxy list`。
3. 在本机重建隧道：
   ```powershell
   ssh -NT -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 9222:127.0.0.1:9222 -p <Railway公开端口> root@<Railway域名>
   ```
4. 验证：`curl -s http://127.0.0.1:9222/json/version` 返回 JSON。
5. 免手动：本机用 `autossh -M 0`，或 VS Code Remote-SSH 的 `RemoteForward 9222 127.0.0.1:9222`。

## 七、注意事项

- **Chrome 版本**：136+ 必须用非默认 `--user-data-dir`，否则调试端口不生效。
- **host key**：重部署后本机看到 `REMOTE HOST IDENTIFICATION HAS CHANGED` 时执行 `ssh-keygen -R "[host]:port"`，或加 `StrictHostKeyChecking=accept-new`。
- **VPN/代理**：本机常驻 VPN 且为 TUN/全局模式会影响长连接稳定性；建议加 `DOMAIN-SUFFIX,rlwy.net,DIRECT` 直连分流，并保留 keepalive/autossh。
- **超时**：命令超时统一 20s；抓静态内容优先 `find`/`snapshot`，不要反复 `open`。
- **安全**：`--remote-debugging-port` 等于完全控制浏览器，只能经 SSH 隧道访问，切勿把 9222 直接暴露公网；用完关闭调试 Chrome。
- **单实例**：同一 `--user-data-dir` 的 Chrome 是单实例，重复启动只会复用现有实例；需要两个独立账号时，用两个不同 `--user-data-dir` + 两个端口 + 两条隧道（配置里再加一个 cdp 端点）。
- **CDP 保真度**：`connectOverCDP` 的保真度低于 Playwright 原生协议，部分高级能力（新 context、trace、PDF）不可用；核心导航/快照/交互不受影响。

## 更新登录态

在调试 Chrome（`E:\chrome-debug`）里重新登录即可，无需在容器侧做任何操作——CDP 直接复用该浏览器的实时 cookie。
