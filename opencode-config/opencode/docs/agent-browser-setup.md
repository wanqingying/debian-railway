# agent-browser 使用指南：通过 SSH 反向隧道驱动本机浏览器

`agent-browser` 是 Vercel Labs 出品的浏览器自动化 CLI（Rust 实现，直接走 CDP，无 Playwright/Puppeteer 依赖）。本容器**不安装本地 Chrome**：它通过 **CDP** 驱动**用户本机**的真实浏览器，浏览器和登录态都留在用户自己的电脑上，容器只负责发指令。

## 为什么这样接

- 容器在 Railway（海外机房），没有显示器，直接在容器里跑 headless Chrome 会遇到机房 IP 风控、登录态迁移、无法人工接管（验证码/二次验证）等问题。
- 复用本机浏览器 = 真实 IP + 已有登录态 + 有头可见 + 可人工接管。
- 容器与本机之间用 **SSH 反向隧道**（复用已有的 SSH 主入口）把本机的 CDP 端口映射到容器的 `127.0.0.1:9222`，全程加密，两端都无需暴露到公网。

## 拓扑

```
Win10 Chrome (127.0.0.1:9222)  ──SSH 反向隧道──▶  容器 (127.0.0.1:9222)  ◀── agent-browser --cdp 9222
        ▲
   真实浏览器 / 登录态                                          Railway 容器（无 Chrome）
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

`scripts/install-tools.sh` 每次启动安装 `agent-browser`；`entrypoint.sh` 导出以下变量：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `AGENT_BROWSER_CDP` | `9222` | 默认 CDP 目标，命令无需带 `--cdp` |
| `AGENT_BROWSER_SOCKET_DIR` | `$XDG_DATA_HOME/agent-browser/run` | daemon socket 落卷，跨重启保留 |
| `AGENT_BROWSER_SCREENSHOT_DIR` | `$XDG_DATA_HOME/agent-browser/screenshots` | 截图输出目录 |

可用 `AGENT_BROWSER_CDP=<port|ws-url>` 覆盖（连另一实例或远端服务）。

## 三、验证与使用

```bash
# 连通性（返回 Chrome 版本 JSON 即隧道通）
curl -s http://127.0.0.1:9222/json/version

# 列出本机浏览器已打开的标签（证明 CDP 已通）
agent-browser tab

# 打开页面、快照、点击、截图
agent-browser open https://example.com
agent-browser snapshot -i
agent-browser click @e3
agent-browser screenshot page.png
```

- 快照返回无障碍树 + `@eN` ref；页面变化后 ref 失效，需重新 snapshot。
- 多标签：`tab` / `tab new <url>` / `tab <id>` / `tab close <id>`。
- 多实例并行：`agent-browser --session a --cdp 9222 ...`、`--session b --cdp 9223 ...`；多个会话共享同一浏览器时用 `--pin-tab` 隔离。
- 抓文本优先 `agent-browser read`；页面已打开时直接 `snapshot`，不要反复 `open`。

## 四、MCP 接入

已内置在 `opencode-config/opencode/opencode.jsonc`：

```jsonc
"mcp": {
  "agent-browser": {
    "type": "local",
    "command": ["agent-browser", "mcp", "--tools", "core"],
    "enabled": true
  }
}
```

`--tools` 可选 profile：`core`（默认，29 工具）/ `network` / `state` / `debug` / `tabs` / `react` / `mobile` / `all`（64 工具）。MCP 工具名形如 `agent_browser_*`，与 CLI 共用同一 daemon/CDP。CLI + skill 已覆盖全部能力，MCP 主要面向不能执行 shell 的客户端。

### Playwright MCP（备选，带单命令超时）

`agent-browser` 的 daemon 串行处理命令，当某条页面级命令卡住时会堵死整个会话（上游 issue #1713/#1741）。**Playwright MCP** 通过同一个 CDP 端点连接，且每个动作都有独立超时，卡住时快速报错而非挂死，因此作为备选一并内置：

```jsonc
"mcp": {
  "playwright": {
    "type": "local",
    "command": ["playwright-mcp",
                "--cdp-endpoint", "http://127.0.0.1:9222",
                "--timeout-action", "20000",
                "--timeout-navigation", "20000"],
    "enabled": true
  }
}
```

- 不运行 `playwright install`，只做 CDP attach，连的是本机同一个调试 Chrome；身份/登录态一致。
- 每次 action / navigation 超过 20s 即报错返回，会话可继续。
- 工具名形如 `playwright_browser_*`（约 24 个：navigate/snapshot/click/type/fill_form/evaluate/tabs/network_requests 等）。
- 已知限制：`connectOverCDP` 的保真度低于 Playwright 原生协议，部分高级能力（新 context、trace、PDF）不可用，核心导航/快照/交互不受影响。

## 五、注意事项

- **Chrome 版本**：136+ 必须用非默认 `--user-data-dir`，否则调试端口不生效。
- **host key**：容器每次重新部署都会重生成 SSH host key；本机看到 `REMOTE HOST IDENTIFICATION HAS CHANGED` 时执行 `ssh-keygen -R "[host]:port"`，或加 `StrictHostKeyChecking=accept-new`。
- **VPN/代理**：本机常驻 VPN 且为 TUN/全局模式时会影响长连接稳定性；建议加 `DOMAIN-SUFFIX,rlwy.net,DIRECT` 直连分流，并保留 keepalive/autossh。
- **超时**：`open`/`click` 默认等待网络空闲，对持续有长轮询/心跳的站点（如 B 站）会一直等到命令超时上限；命令超时建议 ≤20s，抓内容用 `read`/`snapshot`。
- **安全**：`--remote-debugging-port` 等于完全控制浏览器，只能经 SSH 隧道访问，切勿把 9222 直接暴露公网；用完关闭调试 Chrome。
- **单实例**：同一 `--user-data-dir` 的 Chrome 是单实例，重复启动只会复用现有实例；需要两个独立账号时，用两个不同 `--user-data-dir` + 两个端口 + 两条隧道。

## 六、重部署 / 重启后恢复

Railway 每次重新部署（`railway up`、环境变量变更、手动重启）都会**重建容器**，导致：

1. 容器 sshd 重启、**旧的 `-R 9222` 反向监听消失**（本机 `ssh` 进程随之退出）；
2. **SSH host key 重新生成**，指纹变化；
3. TCP proxy 入口（`tokaido.proxy.rlwy.net:11838`）通常**保持不变**，但需确认。

恢复步骤：

1. 在容器里确认监听是否存在（无输出即已断，需重建）：
   ```bash
   (timeout 3 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/9222') 2>/dev/null && echo OPEN || echo closed
   ```
2. 查询当前 TCP proxy 入口（端口/域名若有变，用新值）：
   ```bash
   railway tcp-proxy list
   ```
3. 在本机（Win10）**重建反向隧道**（新开窗口，保持不关）：
   ```powershell
   ssh -NT -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 9222:127.0.0.1:9222 -p 11838 root@tokaido.proxy.rlwy.net
   ```
   本机 `E:\chrome-debug` 的 Chrome 需保持运行；若已关闭，先用快捷方式重新启动。
4. 验证：
   ```bash
   curl -s http://127.0.0.1:9222/json/version   # 返回 Chrome 版本 JSON 即恢复
   ```

避免每次手动重建：改用 `autossh -M 0 ...`，或在 VS Code Remote-SSH 的 `~/.ssh/config` 中对该 Host 加 `RemoteForward 9222 127.0.0.1:9222` 并配 `ServerAliveInterval`，让已有连接自动维持/恢复。

> 容器侧无需任何操作：`agent-browser` 的安装与 env 由 `entrypoint.sh` / `scripts/install-tools.sh` 在每次启动时自动完成。

## 更新登录态

在调试 Chrome（`E:\chrome-debug`）里重新登录即可，无需在容器侧做任何操作——CDP 直接复用该浏览器的实时 cookie。
