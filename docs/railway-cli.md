# Railway CLI 完整参考文档

> 本文档整理自 [Railway 官方 CLI 文档](https://docs.railway.com/cli)，覆盖 Railway CLI（版本 5.41.2）的完整命令用法。
> 源文档以 `docs.railway.com` 为准，本文为便于查阅的本地整理版本。

## 目录

- [安装](#安装)
- [认证](#认证)
- [全局选项](#全局选项)
- [命令总览](#命令总览)
- [命令详解](#命令详解)
- [部署指南](#部署指南)

---

## 安装

Railway CLI 支持多种安装方式：

### 一键安装（推荐，含 agent 配置）

```bash
curl -fsSL agents.railway.com | sh
```

安装到 `~/.railway/bin`，并运行 `railway setup agent` 配置检测到的 agent 工具。

### 仅安装 CLI（不含 agent 配置）

```bash
bash <(curl -fsSL railway.com/install.sh)
```

### 其他方式

| 方式 | 命令 | 要求 |
|------|------|------|
| Homebrew (macOS) | `brew install railway` | — |
| npm | `npm i -g @railway/cli` | Node.js ≥ 16 |
| Scoop (Windows) | `scoop install railway` | — |
| 预编译二进制 | 从 [GitHub Releases](https://github.com/railwayapp/cli/releases/latest) 下载 | — |
| 源码编译 | 见 [GitHub 仓库](https://github.com/railwayapp/cli#from-source) | — |

**Windows** 请使用 WSL（Windows Subsystem for Linux）配合 Bash shell。

---

## 认证

### 浏览器登录

```bash
railway login
```

若无法打开浏览器（SSH、容器、无显示器），会自动回退到 device-code 流程。

### 无浏览器登录

```bash
railway login --browserless
```

显示配对码和 URL，在任意设备访问并输入配对码。

### Token（CI/CD 用）

| 变量 | 作用域 | 用途 |
|------|--------|------|
| `RAILWAY_TOKEN` | 项目级 | 在单个项目内部署、管理变量等。Dashboard 按项目生成 |
| `RAILWAY_API_TOKEN` | 账户/工作区级 | 创建环境、管理多项目等需要更广权限的操作。账户设置 > Tokens 生成 |

```bash
RAILWAY_TOKEN=xxx railway up
RAILWAY_API_TOKEN=xxx railway environment new staging
```

两个变量只能设置一个，同时设置会报错。

### 其他认证命令

```bash
railway logout   # 退出登录
railway whoami   # 显示当前用户
```

---

## 全局选项

以下选项可用于多个命令：

| Flag | 说明 |
|------|------|
| `-s, --service` | 目标服务（名称或 ID） |
| `-e, --environment` | 目标环境（名称或 ID） |
| `-p, --project` | 目标项目 ID |
| `--json` | JSON 格式输出 |
| `-y, --yes` | 跳过确认提示 |
| `-h, --help` | 显示帮助 |
| `-V, --version` | 显示版本 |

```bash
railway logs --service backend
railway up --environment production
railway status --json
railway down --yes
railway --version
```

---

## 命令总览

| 类别 | 命令 |
|------|------|
| 认证 | `login`, `logout`, `whoami` |
| 项目管理 | `init`, `link`, `unlink`, `list`, `status`, `open`, `project`, `delete` |
| 部署 | `up`, `deploy`, `redeploy`, `restart`, `down`, `deployment`, `templates` |
| IaC | `config` |
| 服务 | `add`, `service`, `scale` |
| PostgreSQL | `postgres` |
| 变量 | `variable` |
| 用量/成本 | `usage` |
| 环境 | `environment` |
| 本地开发 | `run`, `shell`, `dev` |
| 日志/调试 | `logs`, `ssh`, `connect`, `metrics` |
| 网络 | `domain`, `cdn`, `waf`, `outbound-network`, `private-network`, `tcp-proxy` |
| 卷 | `volume` |
| 存储桶 | `bucket` |
| 函数 | `functions` |
| 沙箱 | `sandbox` |
| AI/agent | `agent`, `setup`, `mcp`, `skills` |
| 公共 API | `api` |
| 工具 | `completion`, `docs`, `upgrade`, `autoupdate`, `starship` |

---

## 命令详解

### 项目管理

#### `railway init`（别名 `new`）

创建新项目并链接到当前目录。

```bash
railway init                        # 交互式创建
railway init --name my-api          # 指定名称
railway init --name my-api --workspace "My Team"  # 指定工作区
railway init --name my-api --workspace my-team-id --json   # CI/CD 非交互
```

| Flag | 说明 |
|------|------|
| `-n, --name <NAME>` | 项目名（默认随机生成） |
| `-w, --workspace <ID\|NAME>` | 创建工作区的 ID 或名称 |
| `--json` | JSON 输出 |

#### `railway link`

将现有项目链接到当前目录。

```bash
railway link                          # 交互式
railway link --project my-api         # 指定项目
railway link --project my-api --environment staging
railway link --project my-api --service backend
railway link --project abc123 --environment def456 --json   # CI/CD
```

| Flag | 说明 |
|------|------|
| `-p, --project <ID\|NAME>` | 要链接的项目 |
| `-e, --environment <ID\|NAME>` | 要链接的环境 |
| `-s, --service <ID\|NAME>` | 要链接的服务 |
| `-w, --workspace <ID\|NAME>` | 要链接的工作区 |
| `-t, --team <ID\|NAME>` | 团队（已弃用，用 `--workspace`） |

链接配置存储在项目根的 `.railway` 目录，通常应加入 `.gitignore`。

#### `railway unlink`

解除当前目录的链接。

#### `railway list`（别名 `ls`）

列出账户中所有工作区的所有项目。`--json` 输出 JSON。

#### `railway status`

显示链接项目、环境和资源信息。

```bash
railway status       # 项目概览
railway status --json
```

输出分组：工作区/项目/环境上下文、链接服务、环境内所有资源（服务、数据库、卷、函数、Cron 任务、存储桶）。

#### `railway open`

在浏览器中打开。

#### `railway project`（别名 `projects`）

```bash
railway project list                      # 列出所有项目
railway project link                      # 链接项目
railway project delete --project my-old-project   # 删除项目
```

#### `railway delete`（别名 `rm`, `remove`）

永久删除项目。

```bash
railway delete --project my-old-project
railway delete --project my-old-project --yes
railway delete --project my-project --yes --2fa-code 123456
```

| Flag | 说明 |
|------|------|
| `-p, --project <ID\|NAME>` | 要删除的项目 |
| `-y, --yes` | 跳过确认 |
| `--2fa-code <CODE>` | 2FA 验证码 |

**警告**：此操作不可撤销，将删除项目内所有服务、部署和数据。

---

### 部署

#### `railway up` — 上传并部署当前目录

```bash
railway up                    # 部署当前目录（附加模式，实时日志）
railway up -y                 # 登录（如需）+ 创建项目 + 部署
railway up --new --name my-api   # 创建全新项目并部署
railway up --detach           # 分离模式，排队后即返回
railway up --service backend  # 部署到指定服务
railway up --environment staging
railway up --ci               # CI 模式，仅流式构建日志
railway up ./backend          # 部署子目录
railway up --project <project-id> --environment production
```

| Flag | 说明 |
|------|------|
| `-d, --detach, --no-wait` | 不附加日志流，入队后返回 |
| `-y, --yes` | 接受默认值，跳过确认 |
| `--new` | 创建新项目+服务并部署 |
| `--name <NAME>` | 新项目名称（默认目录名） |
| `-w, --workspace <WORKSPACE>` | 创建新项目的工作区 |
| `-c, --ci` | 仅流式构建日志后退出 |
| `-m, --message <MESSAGE>` | 附加到部署的消息 |
| `-s, --service <SERVICE>` | 部署到指定服务 |
| `-e, --environment <ENV>` | 部署到指定环境 |
| `-p, --project <ID>` | 部署到指定项目 |
| `--no-gitignore` | 不忽略 .gitignore 中的路径 |
| `--path-as-root` | 用 path 参数作为归档根 |
| `--verbose` | 详细输出 |
| `--json` | 机器可读输出（NDJSON 构建日志 + JSON 结果） |

**文件处理**：默认尊重 `.gitignore`、`.railwayignore`，忽略 `.git` 和 `node_modules`。

**退出码**：`0` = 部署成功（或分离模式构建入队）；`1` = 部署失败/崩溃/无法继续（如 CI 中 `NOT_AUTHENTICATED`）。

**注意**：`up` 上传本地代码；部署预构建模板（如数据库）用 `railway deploy`。

#### `railway deploy` — 部署模板

```bash
railway deploy                          # 交互式
railway deploy --template postgres      # 部署 PostgreSQL
railway deploy --template postgres --variable "POSTGRES_USER=admin"
railway deploy --template postgres --template redis   # 多个模板
railway deploy --template my-app --variable "Backend.PORT=3000"  # 服务级变量
```

| Flag | 说明 |
|------|------|
| `-t, --template <CODE>` | 要部署的模板代码 |
| `-v, --variable <KEY=VALUE>` | 模板的环境变量 |

常用模板代码：`postgres`, `mysql`, `redis`, `mongo`。

#### `railway redeploy`

重新部署最新部署（不上传新代码）。

```bash
railway redeploy
railway redeploy --service backend
railway redeploy --yes
```

适用于：应用环境变量变更、重启崩溃服务、用相同代码触发全新构建。

#### `railway restart`

重启最新部署，**不重建**（复用现有镜像）。

```bash
railway restart
railway restart --service backend
```

与 `redeploy` 的区别：`restart` 复用现有部署镜像不构建；`redeploy` 从相同源创建新部署（触发构建）。

#### `railway down`

删除服务最新成功的部署。

```bash
railway down
railway down --service backend
railway down --yes
```

| Flag | 说明 |
|------|------|
| `-s, --service <SERVICE>` | 从哪个服务移除部署 |
| `-e, --environment <ENV>` | 从哪个环境移除 |
| `-y, --yes` | 跳过确认 |

仅删除最新成功部署，服务本身不删除。

#### `railway deployment`（别名 `deployments`）

```bash
railway deployment list                    # 列出部署
railway deployment list --limit 50
railway deployment list --service backend
railway deployment list --json
railway deployment list --json --limit 1 | jq -r '.[0].id'   # 获取最新部署 ID
railway logs <deployment-id>               # 用部署 ID 查看日志
```

子命令：`list`（别名 `ls`）、`up`（同 `railway up`）、`redeploy`（同 `railway redeploy`）。

部署状态：`SUCCESS`, `FAILED`, `CRASHED`, `BUILDING`, `DEPLOYING`, `INITIALIZING`, `WAITING`, `QUEUED`, `REMOVED`, `REMOVING`。

#### `railway templates`（别名 `template`）

```bash
# 搜索市场模板（TTY 打开选择器；非 TTY 或 --json 打印结果）
railway templates search
railway templates search postgres
railway templates search --verified true
railway templates search --category databases
railway templates search --json postgres
railway templates search --limit 50 --after <CURSOR> postgres   # 分页

# 列出工作区拥有的模板
railway templates list
railway templates list --workspace my-workspace --json

# 从项目创建未发布模板
railway templates create
railway templates create --project my-project --environment production

# 发布/更新模板
railway templates publish template-id --category Other --description "Desc" --readme-file README.md
railway templates publish template-id --category AI/ML --readme-file README.md --demo-project demo-id
railway templates update template-id --category Other --readme-file README.md

# 取消发布 / 删除
railway templates unpublish template-code
railway templates unpublish template-id --yes
railway templates delete template-id --yes
```

有效分类：AI/ML, Analytics, Authentication, Automation, Blogs, Bots, CMS, Observability, Other, Starters, Storage, Queues。

---

### Infrastructure as Code（`railway config`）

在 `.railway/railway.ts` 中定义项目与环境。

```bash
railway config init          # 创建 .railway/railway.ts
railway config init --force  # 覆盖现有文件

railway config pull          # 导入选中环境到 railway.ts
railway config pull --json   # 打印导入的图而不写文件

railway config plan          # 预览变更而不应用
railway config plan --file path/to/railway.ts
railway config plan --detailed-exit-code   # 有变更退出 2，无变更退出 0

railway config apply         # 预览、确认并应用
railway config apply --yes
railway config apply --yes --confirm-destructive    # 非交互破坏性应用
railway config apply --json --confirm-destructive
```

`plan` 默认脱敏变量值，`--show-values`/`--decrypt-variables` 输出视为敏感信息。

**警告**：`railway config apply --json` 应用非破坏性变更时不提示。仅需预览用 `railway config plan --json`。

---

### 服务管理

#### `railway add`

添加服务（数据库、GitHub 仓库、Docker 镜像或空服务）。

```bash
railway add                       # 交互式
railway add --database postgres   # 添加数据库
railway add --database postgres --database redis   # 多个数据库
railway add --repo user/my-repo   # 从 GitHub 仓库
railway add --image nginx:latest  # 从 Docker 镜像
railway add --service             # 创建空服务
railway add --service my-api
railway add --service api --variables "PORT=3000" --variables "NODE_ENV=production"
```

| Flag | 说明 |
|------|------|
| `-d, --database <TYPE>` | 数据库类型（postgres, mysql, redis, mongo） |
| `-s, --service [NAME]` | 创建空服务 |
| `-r, --repo <REPO>` | 从 GitHub 仓库创建 |
| `-i, --image <IMAGE>` | 从 Docker 镜像创建 |
| `-v, --variables <KEY=VALUE>` | 设置环境变量 |

添加服务后自动链接到当前目录；数据库自动部署。

#### `railway service`

```bash
railway service                       # 交互式链接服务
railway service backend               # 链接指定服务
railway service list                  # 列出环境中的服务
railway service status                # 显示部署状态
railway service status --all          # 所有服务状态
railway service logs                  # 查看服务日志
railway service redeploy              # 重新部署
railway service restart               # 重启
railway service scale us-west=2       # 跨区域扩缩容

# 连接/断开服务源
railway service source connect --repo owner/repo --branch main --service web
railway service source connect --image nginx:latest --service web
railway service source disconnect --service web

# 服务文件系统管理
railway service files browse /app          # 交互式 TUI
railway service files list /app
railway service files download /app/data.db ./data.db
railway service files upload ./seed.db /app/seed.db
railway service files rename /app/data.db /app/data-old.db
railway service files delete /app/data.db   # 仅限人工，拒绝 AI agent 调用
```

#### `railway scale`（也可用 `railway service scale`）

跨区域设置副本数。

```bash
railway scale                 # 交互式 TUI
railway scale eu-west=2       # 某区域设置 2 副本
railway scale eu-west=2 us-east=1    # 多区域
railway scale --service worker --environment production eu-west=2 us-east=1
railway scale eu-west=0       # 移除该区域副本
railway scale --json eu-west=2
```

可用区域名：`eu-west`, `us-east`, `us-west`, `southeast-asia`。所有区域最多 50 副本。

---

### 变量管理（`railway variable`，别名 `variables`, `vars`, `var`）

```bash
railway variable list                   # 列出变量
railway variable list --kv              # KEY=VALUE 格式
railway variable set API_KEY=secret123  # 设置变量
railway variable set API_KEY=secret123 DEBUG=true   # 设置多个
railway variable set OPTIONAL_TOKEN=    # 设置空字符串
echo "my-secret-value" | railway variable set SECRET_KEY --stdin   # 从 stdin
railway variable delete API_KEY         # 删除变量
```

子命令：`list`（别名 `ls`）、`set`、`delete`（别名 `rm`, `remove`）。

`set` 常用选项：`--stdin`（配合单个 KEY 从 stdin 读取）、`--skip-deploys`（跳过触发部署）。

遗留（弃用但支持）：
```bash
railway variable --set KEY=VALUE        # 用 'railway variable set KEY=VALUE'
railway variable --set-from-stdin KEY   # 用 'railway variable set key --stdin'
```

---

### 环境管理（`railway environment`，别名 `env`）

```bash
railway environment               # 交互式链接
railway environment staging       # 链接指定环境
railway environment list          # 列出所有环境
railway environment new staging   # 创建新环境
railway environment new staging --duplicate production   # 复制环境（--copy 同义）
railway environment delete staging
railway environment delete staging --yes
railway environment edit --service-config backend variables.API_KEY.value "secret"
railway environment config        # 显示环境配置
railway environment config --json
```

`edit --service-config` 使用点路径表示法：
```bash
railway environment edit --service-config backend variables.API_KEY.value "secret"
railway environment edit --service-config api build.buildCommand "npm run build"
railway environment edit --service-config api source.rootDirectory /packages/api
```

---

### 本地开发

#### `railway run`（别名 `local`）

使用 Railway 环境变量在本地执行命令。

```bash
railway run npm start
railway run python main.py
railway run --service backend npm start
railway run npx prisma migrate deploy
railway run rails console
```

流程：获取指定服务环境变量 → 注入命令环境 → 执行。退出码与执行的命令一致。

#### `railway shell`

打开一个注入 Railway 变量的子 shell。

```bash
railway shell
railway shell --service backend
railway shell --silent     # 无 banner
```

设置 `IN_RAILWAY_SHELL=true`。与 `run` 区别：`shell` 打开交互式会话；`run` 执行单条命令后退出。

#### `railway dev`（别名 `develop`，实验性）

用 Docker Compose 在本地运行 Railway 服务，自动注入环境变量并支持 HTTPS。

```bash
railway dev                    # 启动（默认）
railway dev --verbose
railway dev down               # 停止
railway dev clean              # 停止并移除卷/数据
railway dev configure          # 配置代码服务
railway dev configure --service backend
railway dev configure --remove
railway dev up --dry-run       # 生成 docker-compose.yml 不启动
railway dev up --no-https
railway dev up --no-tui
```

要求：Docker + Docker Compose；可选 mkcert（HTTPS）。

---

### 日志与调试

#### `railway logs`

查看构建、部署、HTTP、网络流、DNS 日志。默认实时流式，传 `--lines`/`--since`/`--until` 则获取历史。

```bash
railway logs                          # 流式部署日志（默认）
railway logs --lines 100              # 最近 100 行
railway logs --since 1h               # 最近 1 小时
railway logs --since 30m --until 10m  # 时间范围
railway logs --since 2024-01-15T10:00:00Z
railway logs --build                  # 构建日志
railway logs 7422c95b-... --build     # 指定部署的构建日志
railway logs --http                   # HTTP 请求日志
railway logs --http --method GET --status 200
railway logs --http --method POST --path /api/users
railway logs --http --status ">=400" --lines 50
railway logs --http --request-id abc123
railway logs --network                # 网络流日志
railway logs --network --direction egress --protocol tcp
railway logs --network --peer postgres --port 5432
railway logs --dns                    # DNS 查询日志
railway logs --dns --status failed
railway logs --dns --rcode NXDOMAIN
railway logs --dns --zone internal
railway logs --json                   # JSON 输出
railway logs --latest                 # 最新部署日志（即使失败/构建中）
```

| Flag | 说明 |
|------|------|
| `-s, --service` | 目标服务 |
| `-e, --environment` | 目标环境 |
| `-p, --project` | 目标项目 |
| `-n, --lines <N>` | 日志行数（禁用流式） |
| `-f, --filter <QUERY>` | 查询语法过滤 |
| `-S, --since <TIME>` | 从某时间起（禁用流式） |
| `-U, --until <TIME>` | 到某时间止（禁用流式） |
| `--json` | JSON 输出 |

**时间格式**：相对（`30s`, `5m`, `2h`, `1d`, `1w`）或 ISO 8601。

**过滤语法**：文本搜索（`"error message"`）、属性过滤（`@level:error`）、操作符（`AND`, `OR`, `-` 取反）、数值操作符（`>`, `>=`, `<`, `<=`, `..` 范围）。

#### `railway ssh`

通过 SSH 连接已部署服务容器，或管理 SSH 密钥。

```bash
railway ssh                # 交互式 shell
railway ssh -- ls -la      # 运行单条命令
railway ssh --session      # 持久 tmux 会话（默认名 railway）
railway ssh --session debug
railway ssh --deployment-instance <instance-id>
railway ssh -i ~/.ssh/railway_ed25519

# SSH 配置管理
railway ssh config --service api
railway ssh config --service api --dry-run
railway ssh config --service api --alias railway-api
railway ssh config remove --service api

# SSH 密钥管理
railway ssh keys                       # 列出已注册密钥
railway ssh keys add --key ~/.ssh/id_ed25519.pub --name "laptop"
railway ssh keys remove
railway ssh keys github                # 从 GitHub 导入密钥
railway ssh keys --workspace <workspace-id>   # 工作区密钥（需 Admin 权限）
```

使用系统 `ssh` 客户端连接 `ssh.railway.com`，首次运行需注册本地密钥。已知限制：不支持 VS Code Remote-SSH。

#### `railway connect`

连接数据库交互式 shell（Postgres 用 psql，MongoDB 用 mongosh 等）。

```bash
railway connect                    # 交互式
railway connect postgres           # 指定数据库
railway connect postgres --environment staging
railway connect postgres --tunnel-only   # 打开本地隧道供 GUI 客户端连接
```

| Flag | 说明 |
|------|------|
| `--ssh` | 通过 SSH 隧道（服务无公网代理时自动启用） |
| `--no-ssh` | 强制公网 TCP 代理路径 |
| `--tunnel-only` | 只开本地隧道不打客户端 |
| `-P, --port <PORT>` | 隧道绑定端口 |

支持的数据库及客户端：PostgreSQL(`psql`)、MySQL(`mysql`)、Redis(`redis-cli`)、MongoDB(`mongosh`)。

#### `railway metrics`（别名 `metric`）

查看服务资源与 HTTP 指标。

```bash
railway metrics                       # 链接服务概览
railway metrics --service my-api --environment production
railway metrics --since 6h
railway metrics --cpu --memory
railway metrics --http
railway metrics --http --method POST --path /api/users
railway metrics --raw --cpu
railway metrics --all                 # 项目所有服务
railway metrics --json
railway metrics --watch               # 实时 TUI 仪表盘
```

| Flag | 说明 |
|------|------|
| `-s, --service` | 目标服务 |
| `-a, --all` | 项目所有服务 |
| `-S, --since` / `-U, --until` | 时间窗口（相对或 ISO） |
| `--cpu`, `--memory`, `--network`, `--volume`, `--http` | 指标分组 |
| `--raw` | 原始时间序列数据 |
| `--json` | JSON 输出 |
| `-w, --watch` | 实时 TUI |

---

### 网络

#### `railway domain`

```bash
railway domain                          # 生成免费 *.up.railway.app 域名
railway domain example.com              # 添加自定义域名
railway domain example.com --port 8080
railway domain example.com --service api
railway domain list --service api       # 列出服务域名
railway domain status example.com       # 域名状态和 DNS 详情
railway domain update example.com --port 8080   # 更新目标端口
railway domain update old-name.up.railway.app --domain new-name   # 重命名
railway domain certificate retry example.com    # 重试证书签发
railway domain delete example.com --yes         # 删除域名
```

子命令：`list`（`ls`）、`status`、`delete`（`remove`/`rm`）、`update`（`edit`）、`certificate retry`。

自定义域名需要 `CNAME` 和 `TXT` 两个记录。每个服务限一个 Railway 提供域名，可加多个自定义域名。

#### `railway cdn`

```bash
railway cdn status                    # CDN 缓存设置
railway cdn enable                    # 启用 CDN 缓存
railway cdn purge html                # 清除缓存 HTML
```

#### `railway waf`

```bash
railway waf under-attack status
railway waf under-attack enable       # 启用 Under Attack 模式
```

#### `railway outbound-network`

```bash
railway outbound-network status --service api
railway outbound-network static-ip status --service api
railway outbound-network static-ip enable --service api    # 静态出站 IP
railway outbound-network static-ip disable --service api
railway outbound-network ipv6 status --service api
railway outbound-network ipv6 enable --service api         # 暂存 Outbound IPv6
railway outbound-network ipv6 disable --service api
```

静态出站 IP 变更直接提交；Outbound IPv6 变更暂存为环境配置变更。

#### `railway private-network`

```bash
railway private-network status        # 私有网络状态
```

#### `railway tcp-proxy`

暴露非 HTTP 应用端口（数据库、游戏服务器端口）。

```bash
railway tcp-proxy list --service postgres
railway tcp-proxy create --port 5432 --service postgres
railway tcp-proxy status tcp-proxy-id
railway tcp-proxy delete tcp-proxy-id --yes
```

每个服务实例仅允许一个 TCP 代理。

---

### 卷（`railway volume`，别名 `volumes`）

```bash
railway volume list
railway volume add --mount-path /data
railway volume delete --volume my-volume
railway volume update --volume my-volume --mount-path /new/path
railway volume update --volume my-volume --name new-name
railway volume detach --volume my-volume
railway volume attach --volume my-volume --service backend
railway volume browse /               # 交互式 TUI
railway volume files list /
railway volume files download /backup.tar ./backup.tar
railway volume files upload ./backup.tar /backup.tar
railway volume files rename /backup.tar /backup-old.tar
railway volume files delete /backup.tar
```

子命令：`list`, `add`, `delete`, `update`, `detach`, `files`, `browse`, `attach`。

文件子命令：`list`, `browse`, `download`, `upload`, `delete`, `rename`。`files delete` 拒绝 AI agent 调用。

---

### 存储桶（`railway bucket`，别名 `buckets`）

```bash
railway bucket list                        # 列出桶
railway bucket create my-bucket --region sjc   # 创建（区域可选）
railway bucket delete --yes                # 删除
railway bucket info                        # 桶详情
railway bucket credentials                 # 显示 S3 凭据
railway bucket credentials --reset --yes   # 重置凭据
railway bucket rename --name new-name      # 重命名
```

全局选项：`-e, --environment`, `-b, --bucket`（delete/info/credentials/rename 用）。

可用区域：`sjc`（美国西部，加州）、`iad`（美国东部，弗吉尼亚）、`ams`（欧盟西部，阿姆斯特丹）、`sin`（亚太，新加坡）。

凭据输出格式（可直接 eval）：
```plaintext
AWS_ENDPOINT_URL=https://storage.railway.app
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET_NAME=my-bucket-abc123
AWS_DEFAULT_REGION=auto
AWS_S3_URL_STYLE=virtual
```

---

### 函数（`railway functions`，别名 `function`, `func`, `fn`, `funcs`, `fns`）

```bash
railway functions list
railway functions new --path ./my-function.ts --name my-function
railway functions new --path ./api.ts --name api --http       # HTTP 函数
railway functions new --path ./job.ts --name cleanup --cron "0 * * * *"   # Cron 函数
railway functions push
railway functions push --watch
railway functions pull
railway functions delete --function my-function
railway functions link --function my-function --path ./local-function.ts
```

---

### 沙箱（`railway sandbox`，别名 `sandboxes`, `sbx`）

需要启用 Priority Boarding。用于创建临时沙箱。

```bash
railway sandbox create
railway sandbox create --idle-timeout-minutes 30
railway sandbox create --private-network
railway sandbox fork
railway sandbox fork sbx_abc123
railway sandbox list
railway sandbox ssh                          # 连接活跃沙箱
railway sandbox ssh -- ls -la
railway sandbox exec -- npm run build
railway sandbox exec --id sbx_abc123 --timeout 120 -- npm test
railway sandbox exec --detach -- npm run build    # 后台运行
railway sandbox exec --session <name>        # 重新附加
railway sandbox forward 3000                 # 端口转发 localhost:3000 -> 沙箱 3000
railway sandbox forward 8080:3000
railway sandbox forward 3000 5432
railway sandbox destroy                      # 销毁活跃沙箱
railway sandbox destroy sbx_abc123
```

模板与检查点：
```bash
railway sandbox template build --name dev -c "npm i -g pnpm" --wait
railway sandbox create --template dev
railway sandbox checkpoint create after-deps
railway sandbox create --checkpoint after-deps
railway sandbox checkpoint list
railway sandbox checkpoint rename after-deps node-base
railway sandbox checkpoint delete node-base
```

变量：
```bash
railway sandbox create --variable NODE_ENV=production --variable PORT=8080
railway sandbox create --env-file .env
railway sandbox create --variable GH_TOKEN=$(gh auth token)
railway sandbox create --variable DATABASE_URL=Postgres.DATABASE_URL --private-network
```

---

### AI 与 Agent

#### `railway agent`

用自然语言与 Railway Agent 交互。

```bash
railway agent                     # 交互式会话
railway agent -p "show me the logs for my project"
railway agent -p "create a PostgreSQL database in this project"
railway agent -p "check the logs for errors" --service backend
railway agent -p "list my services and their status" --json
railway agent --list              # 列出历史线程
railway agent --thread-id <THREAD_ID>   # 继续某线程
```

| Flag | 说明 |
|------|------|
| `-p, --prompt <MESSAGE>` | 发送单条提示 |
| `--json` | JSON 输出 |
| `--list` | 列出当前环境的线程 |
| `--thread-id <ID>` | 继续现有线程 |
| `-s, --service` | 限定会话范围的服务 |

需通过 `railway login` 用户认证，不支持项目 token（`RAILWAY_TOKEN`）。

#### `railway setup agent`

配置编辑器/AI agent 的 Railway 工具。

```bash
railway setup agent              # 交互式
railway setup agent -y           # 非交互，接受默认
railway setup agent --remote     # 通过 CLI 代理连 Remote MCP
railway setup agent --remote --oauth   # 直接 HTTP + OAuth
```

安装 `use-railway` skill（支持 Claude Code, Cursor, OpenAI Codex, OpenCode, Factory Droid, GitHub Copilot, `.agents`），配置 Railway MCP，检查认证。幂等。

#### `railway mcp`

```bash
railway mcp                          # 启动本地 stdio MCP 服务器
railway mcp install                  # 安装 MCP 配置到检测到的工具
railway mcp install --agent cursor   # 指定工具
railway mcp install --agent claude-code --agent copilot
railway mcp install --remote         # Remote MCP（CLI 代理）
railway mcp install --remote --oauth
railway mcp proxy                    # 代理 mcp.railway.com
```

支持的 agent：`claude-code`, `cursor`, `factory-droid`, `copilot`, `codex`, `opencode`。

#### `railway skills`

```bash
railway skills install              # 安装（默认）
railway skills update               # 更新（install 别名）
railway skills install --agent cursor
railway skills remove
railway skills remove --agent cursor
```

Skills 安装到 `~/.agents/skills`（通用 `.agents` 目录）及各工具目录（如 `~/.claude/skills`, `~/.config/opencode/skills`）。

---

### 公共 API（`railway api`）

需先认证（`railway login` 或设置 token）。

```bash
railway api 'query { me { id name } }'        # 执行 GraphQL 查询
railway api --file query.graphql              # 从文件读取
cat query.graphql | railway api               # 从 stdin
railway api --file query.graphql --variables '{"projectId": "abc-123"}'
railway api --file query.graphql --var projectId=abc-123 --var limit=10
railway api search serviceInstance            # 搜索 schema
railway api search serviceInstance --kind mutation
railway api describe serviceInstance          # 描述类型/字段
railway api describe ServiceInstance.buildCommand
railway api schema                            # 打印完整 introspection schema
```

| Flag | 说明 |
|------|------|
| `-f, --file <PATH>` | 从文件读 GraphQL 文档（`-` 表示 stdin） |
| `--variables <JSON\|@PATH>` | JSON 变量对象或文件 |
| `--var <KEY=VALUE>` | 设置类型化变量 |
| `--raw-var <KEY=VALUE>` | 设置字符串变量 |
| `--operation-name <NAME>` | 多操作时指定要执行的 |
| `--compact` | 紧凑 JSON |
| `--allow-errors` | 即使有 errors 数组也成功退出 |

`search` 选项：`--kind`（all/type/query/mutation/subscription/field/input/enum）、`--limit`、`--compact`。

---

### 用量与成本控制（`railway usage`）

```bash
railway usage                        # 工作区用量摘要
railway usage --period previous
railway usage --period 2026-07 --json
railway usage projects               # 按成本排名项目
railway usage projects --limit 10
railway usage projects --project api --period previous   # 单项目按服务拆分
railway usage limit status           # 计算/agent 限制
railway usage limit status --target workspace
railway usage limit status --target agent
railway usage limit set --target workspace --soft 75 --hard 125
railway usage limit set --target agent --soft 7.50 --hard 20
railway usage limit update --soft 100
railway usage limit remove
railway usage limit remove --yes
```

| Flag | 说明 |
|------|------|
| `--workspace <WORKSPACE>` | 工作区名称或 ID |
| `--period <PERIOD>` | `current`, `previous`, 或 `YYYY-MM`（默认 current） |
| `--limit <COUNT>` | 最大项目数 |
| `--project <PROJECT>` | 单项目服务级拆分 |
| `--json` | JSON 输出 |

计算限制用整数美元（`--soft` 5-500000，`--hard` 10-500000）；agent 限制支持小数（两位），hard 必填（不可移除），`--hard 0` 阻止额外 agent 用量。

---

### 工具命令

#### `railway completion`

生成 shell 补全脚本。

```bash
railway completion bash
railway completion zsh
railway completion fish
railway completion powershell
railway completion elvish
```

示例：
```bash
source <(railway completion bash)
railway completion fish > ~/.config/fish/completions/railway.fish
railway completion powershell >> $PROFILE
```

#### `railway docs`

打开文档。

#### `railway upgrade`

升级 CLI。

#### `railway autoupdate status`

显示自动更新状态。

#### `railway starship`

Starship 集成。

---

## 部署指南

### 快速部署

```bash
railway link     # 先链接项目（如未链接）
railway up       # 部署当前目录
```

`up` 会扫描、压缩、上传文件，Railway 用 Railpack 或 Dockerfile 构建后部署。

### 部署模式

- **附加模式（默认）**：`railway up` 流式构建+部署日志。
- **分离模式**：`railway up -d`，上传后立即返回，后台继续部署。
- **CI 模式**：`railway up --ci` 仅流式构建日志，构建完成退出。`--json` 也隐含 CI 模式。

### CI/CD 集成

用 Project Token（而非交互登录）：

```bash
RAILWAY_TOKEN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX railway up
```

项目 token 可执行：`railway up`（部署）、`railway redeploy`、`railway logs`（查看构建/部署日志）。

### GitHub Actions

- 用 `deployment_status` 事件在部署后运行命令（详见 [GitHub Actions Post-Deploy 指南](https://docs.railway.com/guides/github-actions-post-deploy)）。
- 用 `RAILWAY_API_TOKEN` 创建 PR 环境（详见 [GitHub Actions PR Environment 指南](https://docs.railway.com/guides/github-actions-pr-environment)）。

### 部署子目录

```bash
railway up ./backend
railway up ./backend --path-as-root    # 以该路径为归档根
```

### 忽略文件

默认尊重 `.gitignore`；用 `--no-gitignore` 包含被忽略文件。

---

## 相关资源

- Railway 官方文档：https://docs.railway.com
- Railway CLI GitHub：https://github.com/railwayapp/cli
- 本仓库：`debian-railway` 项目（基于 Debian Bookworm Slim + ttyd 的 web 终端）
