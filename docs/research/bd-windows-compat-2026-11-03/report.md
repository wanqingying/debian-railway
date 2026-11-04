# BD-002 全部依赖在 Windows 10 的兼容性

**日期：** 2026-11-03 · **基准：** BD-002（r2）· **方法：** 逐个读 npm/包内 metadata 与已安装产物，不靠印象

## 结论

**8 个 BD 组件里 6 个原生支持 Windows，2 个（ttyd、KasmVNC）纯 Linux，1 个（tini）不需要。**
原生模块的风险比想象中小：三个最可疑的（node-pty、codegraph、sherpa-onnx）**都有 win32-x64 预编译产物**，不需要 MSVC。

## 一、BD 版本矩阵逐项

| 组件 | 版本 | Windows 支持 | 证据 |
|---|---|---|---|
| `@opencode/cli` | 2.2.5 | ✅ **原生** | `os: [darwin, linux, win32]`；`optionalDependencies` 含 `@opencode/cli-windows-x64` / `-arm64` / `-x64-baseline`；`bin` 直接是 `bin/opencode.exe` |
| `@openchamber/web`（fork 构建） | 2.6.0 | ✅ **可用，有前提** | 代码里有 win32 分支（`useConpty`、`rg.exe`、`sherpa-onnx-win-*`、`PATH` 而非 `LD_LIBRARY_PATH`）；`engines.node >= 24.14.0` 是硬门槛 |
| `@cortexkit/opencode-magic-context` | 0.49.34 | ✅ 纯 JS / wasm | deps 全为纯 JS（zod、ai-tokenizer、jsonc-parser、quickjs-emscripten、onnxruntime-web）；可选 `sharp`、`onnxruntime-node` 均有 win32-x64 预编译 |
| `@colbymchenry/codegraph` | 1.6.2 | ✅ 原生 | `optionalDependencies` 含 `@colbymchenry/codegraph-win32-x64` / `-arm64` |
| `playwright` | 1.64.1 | ✅ | `engines.node >= 20`，纯 JS；我们只走 CDP 接管现有浏览器，不下载浏览器 |
| pnpm | 11.22.0（corepack） | ✅ | corepack 跨平台；Node 24 自带 |
| `ttyd` | 1.7.3 | ❌ **不可用** | Linux 专用（libwebsockets + pty），无 Windows 构建；由 ConPTY/Windows Terminal 替代 |
| `KasmVNC` | 1.5.0 | ❌ **不可用** | Linux X 服务器；Windows 上直接看桌面，不需要它 |
| `tini` | — | ➖ 不需要 | 只解决 PID 1 回收僵尸；Windows 没有这个问题 |

## 二、启动脚本装的那批工具

| 工具 | Windows | 说明 |
|---|---|---|
| `uv` | ✅ | 官方 Windows 构建，PowerShell 一行装 |
| Python 3.12 | ✅ | uv 自己管 |
| Doppler CLI | ✅ | 有 Windows 二进制 |
| Railway CLI | ✅ | npm / scoop / 二进制 |
| `gh` | ✅ | MSI / winget |
| ffmpeg | ✅ | winget / gyan.dev 构建 |
| jq | ✅ | 单文件 exe |
| unzip / tar | ✅ | Windows 10 1803 起内置 `tar.exe`；7zip-bin 也随 OpenChamber 装着 |
| build-essential | ➖ 多数不需要 | 只有原生模块缺预编译时才需要 MSVC Build Tools；**本次核对下来三个都有预编译** |
| fonts-noto-cjk | ➖ | Windows 自带中日韩字体 |
| `lsof` | ❌ | Windows 无对应；用 `Get-NetTCPConnection` / `handle.exe` |
| `chromium`（Debian 包） | ➖ 换成 | 用本机 Chrome 或 Edge（CDP 一样） |

## 三、三个原生坑的实际风险（逐个查过产物）

**1. node-pty（OpenChamber 的终端面板）**

- 版本 `1.2.0-beta.18`，`install` 脚本是 `node scripts/prebuild.js || node-gyp rebuild`
- 容器里已安装的产物里就有 `prebuilds/win32-x64/conpty.node`、`conpty_console_list.node`
- **结论：不需要 MSVC**；Windows 走 ConPTY，代码里 `if (process.platform === 'win32') options.useConpty = true`

**2. sherpa-onnx-node（语音听写，可选功能）**

- 只在 `server/lib/dictation/` 用，**懒加载**，加载失败不影响启动
- loader 会把平台包目录塞进 `PATH`（Windows）/ `LD_LIBRARY_PATH`（Linux）
- npm 上有 `sherpa-onnx-win-x64@2.0.1`
- **结论：可用；不装也不影响主体**

**3. 7zip-bin / @vscode/ripgrep**

- 已安装产物里有 `7zip-bin`；ripgrep 代码里 `BINARY_NAME = process.platform === 'win32' ? 'rg.exe' : 'rg'`
- **结论：都是按平台下载/自带，Windows 正常**

## 四、Windows 上必须满足的前提

1. **Node.js ≥ 24.14.0**（OpenChamber 的 `engines` 明写）。这是最容易踩的一条——Node 22 会直接拒绝启动或行为异常。
2. **`opencode` 不需要 Node**（原生 exe），但 OpenChamber 需要，两者共存时以 Node 版本为准。
3. **路径与配置**：opencode 在 Windows 上仍读 `~/.config/opencode`（godot-ai 的客户端配置器注释里写了 `opencode debug paths` 实测过），`~/.local/share` 需要一条命令确认（见下）。

## 五、两条待实测（各一条命令）

| 项 | 命令 | 判据 |
|---|---|---|
| opencode 的 data 目录（决定 `session-search` 插件要不要改） | `opencode debug paths` | 输出里 data 路径是 `~/.local/share` → **零改动**；是 `%LOCALAPPDATA%` → 给插件加一个 win32 分支 |
| magic-context 的 store 落点 | 启动后看 `%USERPROFILE%\.local\share\cortexkit`（或 `$XDG_DATA_HOME`）下有没有 `magic-context/context.db` | 有 → 配置照搬可用 |

## 六、不可用的三项怎么替代

| 容器方案 | Windows 替代 |
|---|---|
| KasmVNC（8444 + VNC 客户端） | 直接看桌面，无需远程显示 |
| ttyd 网页终端 | Windows Terminal / ConPTY（OpenChamber 的终端面板就用它） |
| tini（PID 1 回收） | 无对应问题 |
| 容器内 Chromium（CDP 9222） | 本机 Chrome/Edge，`--remote-debugging-port=9222`，`PW_CDP` 指过去 |

## 七、结论与建议

- **agent 栈整体搬到 Windows 是可行的**，没有"必须重新编译"的阻塞项。
- 真正的门槛只有一个：**Node 24.14+**。
- 风险排序：OpenChamber（依赖最重、engines 最严）> opencode（原生，最稳）> magic-context（纯 JS）> codegraph（有 win 包）。
- 建议顺序：先装 Node 24 + opencode，跑 `opencode debug paths` 定路径；再装 OpenChamber fork tarball（`npm i -g ./openchamber-web-2.6.0-fork.tgz`）；最后配 magic-context 与 codegraph。

## Sources

| ID | Source |
|---|---|
| S1 | npm registry：`@opencode/cli@2.2.5` 的 `os`/`optionalDependencies`/`bin`（本机 `npm view`） |
| S2 | `vendor/openchamber-web-2.6.0-fork.tgz` 内 `package/package.json` 的 `engines`/`dependencies`（本机 `tar -xO`） |
| S3 | `server/lib/terminal/runtime.js` 的 win32 分支、`server/lib/dictation/local/sherpa-loader.js` 的平台包逻辑、`server/lib/fs/ripgrep.js` 的 `rg.exe`（tarball 内源码） |
| S4 | 本机已安装产物：`node-pty/prebuilds/win32-x64/conpty.node`（`find /usr/lib/node_modules/@openchamber/web`） |
| S5 | npm registry：`@colbymchenry/codegraph@1.6.2` 含 `codegraph-win32-x64`；`sherpa-onnx-win-x64@2.0.1` 存在 |
| S6 | npm registry：`@cortexkit/opencode-magic-context@0.49.34` 依赖树（纯 JS + 可选 sharp/onnxruntime-node） |
