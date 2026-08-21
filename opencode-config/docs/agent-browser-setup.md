# agent-browser 安装与使用指南

Goole 的 Vercel Labs 出品的浏览器自动化 CLI，通过 MCP 接入 OpenCode，让 AI 可以操作真实浏览器。
38.5k stars, Rust 实现，原生性能。

## 安装

容器内全局安装：

```bash
npm install -g agent-browser
agent-browser install   # 下载 Chrome for Testing
```

## MCP 配置

已写入 `/root/.config/opencode/opencode.jsonc`：

```json
{
  "mcp": {
    "agent-browser": {
      "type": "local",
      "command": ["agent-browser", "mcp"],
      "enabled": true
    }
  }
}
```

重启 OpenCode 后生效，会注册 20+ 浏览器工具。

## 从 Windows Chrome 导出登录态到容器

网络拓扑：**Windows 10 → WSL2 → Docker 容器**

### 1. Windows 上启动 Chrome 远程调试

关掉所有 Chrome，然后用新 profile 启动：

```powershell
taskkill /F /IM chrome.exe
& "E:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="E:\chrome-remote-debug"
```

> `--user-data-dir` 必填。Chrome 136+ 安全策略禁止在有默认 profile 时暴露 CDP 端口，必须使用非默认目录。

验证端口监听：

```powershell
netstat -ano | findstr :9222
```

在弹出的空白 Chrome 中登录需要的网站（GitHub、B站等）。

### 2. 容器内连接 Windows Chrome 并导出登录态

从容器内通过 `host.docker.internal`（Docker Desktop for Windows 提供的宿主机域名）连接 Chrome 的 CDP：

```bash
# 验证连通性
curl -s http://host.docker.internal:9222/json/version --header "Host: localhost"

# 导出登录态
agent-browser --cdp ws://host.docker.internal:9222/devtools/browser/<ID> state save ./chrome-auth.json
```

> `<ID>` 从 `/json/version` 返回的 `webSocketDebuggerUrl` 中获取。
> `--header "Host: localhost"` 是必需的，否则 Chrome CDP 拒绝非 localhost 的请求。

### 3. 使用登录态

```bash
agent-browser --state /workspace/apps/screeps-ts/chrome-auth.json open https://www.bilibili.com
```

配合 session 自动持久化：

```bash
agent-browser --state /workspace/apps/screeps-ts/chrome-auth.json --session mysession --restore open https://www.bilibili.com
```

后续使用不需要再指定 `--state`，session 会自动保存和恢复状态。

## 日常使用场景

```bash
# 打开网页获取快照
agent-browser open https://example.com

# 操作已认证的网站
agent-browser --state ./chrome-auth.json open https://github.com/user/repo

# 截图
agent-browser --state ./chrome-auth.json screenshot ./screenshot.png

# 执行 JavaScript
agent-browser --state ./chrome-auth.json eval "document.title"
```

## 更新已保存的登录态

当某个网站的登录过期后，在 Windows Chrome（之前启动的那个远程调试实例）重新登录，然后重新导出：

```bash
agent-browser --cdp ws://host.docker.internal:9222/devtools/browser/<ID> state save ./chrome-auth.json
```

## 限制

- 容器内无 display server，只能 headless 模式运行（截图看结果，不可见窗口）
- `host.docker.internal` 仅在 Docker Desktop for Windows 上可用
- 远程调试的 Chrome 实例是独立 profile，与原 Chrome 的书签/插件/历史隔离
