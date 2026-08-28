# Debian-Railway Dev Container

基于 `debian:bookworm-slim` 的远程开发容器，部署在 Railway 上，通过 **VS Code Remote-SSH** 连接使用。

- 🐧 Debian Bookworm Slim
- 🔒 SSH 访问（VS Code Remote-SSH 主入口）+ ttyd 网页终端（可选兜底）
- 🤖 **opencode** AI 编程助手（headless server，开机自启）
- 📦 Node.js 24 + build-essential + git + python3
- 💻 neofetch

## 功能

- **SSH + Remote-SSH**：在 VS Code 装 `Remote - SSH` 扩展，连接到 Railway 暴露的端口即获得完整 IDE 体验（IntelliSense / 端口转发 / 多终端）。
- **opencode**：默认安装并后台运行 `opencode serve`，提供 HTTP API / 网页客户端，带 basic auth。
- **ttyd 网页终端（可选）**：作为无客户端时的兜底，在独立端口提供网页 shell。
- **持久化**：opencode 的配置、会话、数据库、账号及 magic-context 记忆全部落到挂载卷 `/workspace/.opencode`，重启后保留。

## opencode 访问

`opencode serve` 监听 `4096`（可 `OPENCODE_PORT` 覆盖），HTTP basic auth：

- 用户：`opencode`（`OPENCODE_SERVER_USERNAME` 覆盖）
- 密码：`qingying`（`OPENCODE_SERVER_PASSWORD` 覆盖）

Railway 一个 service 默认只暴露一个公开端口（给 SSH）。要访问 opencode，需在 **Service → Settings → Networking → TCP proxy** 额外添加一个公开端口，映射到容器端口 `4096`，然后用 `https://<该域名>.up.railway.app` 访问。

### 配置来源

`opencode-config/` 存放从本机全局配置复制的**非敏感**配置（`opencode.jsonc`、`AGENTS.md`、`tui.jsonc`、`skills/`、`cortexkit/magic-context.jsonc` 等），构建时打包进镜像，首次启动复制到挂载卷 `$XDG_CONFIG_HOME`（`/workspace/.opencode/config`）。

> ⚠️ **敏感凭据不打包**：API key（`auth.json` / `account.json`）和会话数据库（`opencode.db`）不进入镜像或仓库。容器里需通过环境变量（provider key）或 `opencode auth login` 提供凭据。

## 文档

- **Railway CLI 完整参考**：[docs/railway-cli.md](docs/railway-cli.md) — 整理自 [Railway 官方 CLI 文档](https://docs.railway.com/cli)，覆盖安装、认证、全局选项及全部命令的详细用法（版本 5.41.2）。

## Railway 配置

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `PORT` | 是 | — | Railway 自动注入的公开端口，SSH 监听该端口 |
| `SSH_PORT` | 否 | `$PORT` | SSH 监听端口，显式设置时优先于 `PORT` |
| `SSH_PUBLIC_KEY` | 推荐 | — | SSH 公钥，写入 `/root/.ssh/authorized_keys`，实现免密登录；重启不丢 |
| `PASSWORD` | 否 | — | root 登录密码（密钥之外的第二通道兜底） |
| `USERNAME` | 否 | `root` | ttyd 网页终端的登录用户名 |
| `TTYD_PORT` | 否 | — | 设置后启动 ttyd 网页终端，监听该端口 |
| `OPENCODE_PORT` | 否 | `4096` | opencode serve 监听端口 |
| `OPENCODE_SERVER_USERNAME` | 否 | `opencode` | opencode HTTP basic auth 用户名 |
| `OPENCODE_SERVER_PASSWORD` | 否 | `qingying` | opencode HTTP basic auth 密码 |
| `GIT_USER_NAME` | 否 | — | git 全局身份（`git commit` 署名用），启动时写入卷上 git config |
| `GIT_USER_EMAIL` | 否 | — | git 全局邮箱（`git commit` 署名用），启动时写入卷上 git config |
| `GITHUB_TOKEN` | 否 | — | GitHub PAT，写入卷上 git credential store，HTTPS clone/push 免交互 |
| `GITHUB_HOST` | 否 | `github.com` | 配合 `GITHUB_TOKEN` 使用（如企业版 GitHub 自定义域名） |
| `DOPPLER_TOKEN` | 否 | — | Doppler Service/Personal token，启动时自动 `doppler configure set` |
| `NEON_API_KEY` | 否 | — | Neon CLI（neonctl）原生认证，无需登录步骤 |
| `EMBEDDING_API_KEY` | 否 | — | magic-context embedding（text-embedding-3-small）API key |
| `ANTHROPIC_API_KEY` | 推荐 | — | opencode 调用默认模型（claude-sonnet-4-5）用；也可在容器内 `opencode auth login` 替代 |

> 说明：`SSH_PUBLIC_KEY` 通过 entrypoint 每次启动注入，即使 Railway 没有挂持久卷也能保证密钥存在。强烈建议设置，否则只能用密码登录。

> 说明：`XDG_DATA_HOME`/`XDG_CONFIG_HOME` 固定指向 `/workspace/.opencode/*`，将 opencode 与 magic-context 状态持久化到挂载卷。请为项目挂载 **Railway Volume** 到 `/workspace`。

### 环境变量注入方式与原则

所有需要**从外部注入**的变量（上表）都通过 **Railway → Service → Variables** 配置，entrypoint/install-tools 在启动时读取并落盘。关键原则：

- **敏感凭据不进镜像也不进仓库**：token/key（`GITHUB_TOKEN`、`DOPPLER_TOKEN`、`NEON_API_KEY`、`EMBEDDING_API_KEY`、LLM key）只在 Railway 变量里，运行时注入。`auth.json`/`account.json`/`opencode.db` 被 `opencode-config/` 与 `.railwayignore` 排除。
- **仅用「当前生效」变量**：如 `SSH_PORT` 未设则回退 `PORT`；`OPENCODE_PORT` 未设则 4096；`DOPPLER_TOKEN`/`NEON_API_KEY` 未设则跳过对应 CLI 配置（登录后可手动补）。
- **Railway 自动注入的变量无需你设置**：`PORT`（公开端口）、`RAILWAY_TCP_*`（代理端口）、`RAILWAY_ENVIRONMENT`、`RAILWAY_SERVICE_NAME` 等由平台自动提供。

### 端口

Railway 一个 service 默认只暴露一个公开端口（`$PORT`）。本项目：

- **SSH（主入口）** 监听 `$PORT`（或 `SSH_PORT`）—— 直接使用 Railway 默认公开端口即可。客户端 `~/.ssh/config` 的 `Port` 必须填 Railway 的**公开端口**，若它不是 `22` 请相应修改。
- **opencode** 监听 `$OPENCODE_PORT`（默认 `4096`）—— 需在 `Settings → Networking` 额外添加一个公开端口（TCP proxy）映射到 `4096`。
- **ttyd（可选）** 监听 `$TTYD_PORT` —— 若需要网页终端，同样额外添加公开端口。

### 连接 VS Code

1. 生成/获取本地 SSH 公钥：`cat ~/.ssh/id_ed25519.pub`，填到 `SSH_PUBLIC_KEY`。
2. 在本地 `~/.ssh/config` 添加（`HostName` 换成你的 Railway 域名）：

```sshconfig
Host debian-dev
    HostName <your-railway-domain>.up.railway.app
    Port 22
    User root
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
```

3. VS Code 安装 `Remote - SSH` 扩展 → `Connect to Host: debian-dev`。

> 注意：Railway 公开域名走 TCP 代理，SSH 可直连；但容器每次部署/重启文件系统是临时的，代码和包请挂 **Railway Volume** 持久化，或使用 git。

## Railway CLI 登录与部署

> 容器 root 文件系统每次重启会被清空，因此 **railway CLI 和登录会话都不持久**，每次需重新安装并登录。

### 1. 安装 CLI

```bash
npm i -g --allow-scripts=@railway/cli @railway/cli
```

> `@railway/cli` 有 postinstall 脚本，需加 `--allow-scripts=@railway/cli`。

### 2. 登录

容器内没有浏览器，用 device-code 流程：

```bash
railway login --browserless
```

它会打印一个 URL 和 8 位配对码，在任意设备浏览器打开并输入即可。**注意**：CLI 会阻塞等待授权回调，必须放到后台跑，否则易被误杀：

```bash
nohup railway login --browserless > /tmp/railway-login.log 2>&1 &
# 查看 /tmp/railway-login.log 里的 URL + 配对码，授权完成后日志出现 "Signed in as ..."
```

验证：`railway whoami` / `railway status`（项目须已链接；`status` 显示项目、环境、service、volume）。

### 2b. Token 登录（免浏览器，适合自动/CI）

CLI 通过环境变量读取 token，**注意区分变量名**（接错会报 `Unauthorized` / `Invalid RAILWAY_TOKEN`）：

| 变量 | 类型 | 适用 |
| ---- | ---- | ---- |
| `RAILWAY_API_TOKEN` | 账户级（账户设置 > Tokens 生成） | `whoami`、`up`、多项目管理 |
| `RAILWAY_TOKEN` | 项目级（Dashboard 按项目生成） | 单项目内 `up`/`redeploy`/`logs` |

```bash
RAILWAY_API_TOKEN="$RW_TOKEN" railway whoami     # 验证 token 有效（返回 Logged in as ...）
RAILWAY_API_TOKEN="$RW_TOKEN" railway up -d      # 部署
RAILWAY_TOKEN=<project-token> railway up -d      # 项目级 token
```

> 容器环境里已有的 `RW_TOKEN` 是账户级 token：直接用 `RAILWAY_API_TOKEN="$RW_TOKEN"` 即可，无需交互登录。CLI 不会读取名为 `RW_TOKEN` 的变量本身。

### 3. 部署

```bash
railway up -d      # -d 分离模式：上传后即返回，不阻塞构建
railway deployment list     # 查看构建/部署状态（BUILDING → DEPLOYING → SUCCESS）
railway logs --deployment   # 跟踪当前部署日志
```

> 项目 token 方式（`RAILWAY_TOKEN=xxx railway up`）是 CI 用的替代路径；交互式开发时 `login --browserless` 更可靠。

## 本地构建/测试

```bash
docker build -t debian-dev .
docker run --rm -p 22:22 -p 4096:4096 \
  -v /tmp/ws:/workspace \
  -e SSH_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
  -e PORT=22 \
  debian-dev
```

> `-v /tmp/ws:/workspace` 模拟 Railway 挂载卷，使 opencode 状态在容器重启间持久化。
