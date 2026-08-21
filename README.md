# Debian-Railway Dev Container

基于 `debian:bookworm-slim` 的远程开发容器，部署在 Railway 上，通过 **VS Code Remote-SSH** 连接使用。

- 🐧 Debian Bookworm Slim
- 🔒 SSH 访问（VS Code Remote-SSH 主入口）+ ttyd 网页终端（可选兜底）
- 📦 Node.js 24 + build-essential + git + python3
- 💻 neofetch

## 功能

- **SSH + Remote-SSH**：在 VS Code 装 `Remote - SSH` 扩展，连接到 Railway 暴露的端口即获得完整 IDE 体验（IntelliSense / 端口转发 / 多终端）。
- **ttyd 网页终端（可选）**：作为无客户端时的兜底，在独立端口提供网页 shell。

## Railway 配置

### 环境变量

| 变量           | 必填 | 默认      | 说明 |
| -------------- | ---- | --------- | ---- |
| `PORT`         | 是   | —         | Railway 自动注入的公开端口，SSH 监听该端口 |
| `SSH_PUBLIC_KEY` | 推荐 | —         | 你的 SSH 公钥，写入 `/root/.ssh/authorized_keys`，实现免密登录；重启不丢 |
| `PASSWORD`     | 否   | —         | root 登录密码（密钥之外的第二通道兜底） |
| `USERNAME`     | 否   | `root`    | ttyd 网页终端的登录用户名 |
| `TTYD_PORT`    | 否   | —         | 设置后启动 ttyd 网页终端，监听该端口 |

> 说明：`SSH_PUBLIC_KEY` 通过 entrypoint 每次启动注入，即使 Railway 没有挂持久卷也能保证密钥存在。强烈建议设置，否则只能用密码登录。

### 端口

Railway 一个 service 默认只暴露一个公开端口（`$PORT`）。本项目：

- **SSH（主入口）** 监听 `$PORT` —— 直接使用 Railway 默认公开端口即可。
- **ttyd（可选）** 监听 `$TTYD_PORT` —— 若需要网页终端，在 Railway 服务 `Settings → Networking` 中**额外添加一个公开端口**，会获得第二个域名。

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

## 本地构建/测试

```bash
docker build -t debian-dev .
docker run --rm -p 22:22 \
  -e SSH_PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" \
  -e PORT=22 \
  debian-dev
```
