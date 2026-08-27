# TeamSpeak Web

A lightweight TeamSpeak web client with channel browsing, text chat, and Opus
voice. The browser edition uses a small Node.js UDP gateway; the Android app is
standalone and connects directly to TeamSpeak.

[English](#english) · [简体中文](#简体中文) · [Releases](https://github.com/Lightalso/TeamSpeakWeb/releases)

## English

### Highlights

- TeamSpeak channels, clients, chat, poke, and voice.
- Open microphone, push-to-talk, and muted microphone modes.
- Master input/output volume and per-client output volume.
- Responsive desktop/mobile UI, resizable desktop columns, light/dark themes,
  and English/Chinese localization.
- Browser-local connection details and reusable TeamSpeak identity.
- Docker deployment and a standalone Android APK.

### How it works

```text
Browser UI  ── WebSocket ── Node.js gateway ── UDP ── TeamSpeak server
Android UI  ── embedded Node.js runtime ────── UDP ── TeamSpeak server
```

The web gateway handles TeamSpeak UDP traffic because browsers cannot open UDP
sockets. The Android package embeds the gateway logic and needs no external
TeamSpeak Web backend.

### Requirements

- Node.js 20.19 or later; Node.js 22 LTS is recommended.
- A current Chromium, Firefox, or Safari browser.
- Network access to the TeamSpeak UDP port, normally `9987`.
- HTTPS for microphone access except when using `localhost`.

### Run from source

```bash
git clone https://github.com/Lightalso/TeamSpeakWeb.git
cd TeamSpeakWeb
npm ci
npm start
```

For a downloaded ZIP, extract it and run `npm install` followed by `npm start`.
Open <http://localhost:3000>. Use `npm run dev` during development for automatic
restart.

For a compiled production deployment:

```bash
npm ci
npm run typecheck
npm run build
npm prune --omit=dev
node dist/src/index.js
```

Keep `dist/`, `public/`, `node_modules/`, and `package.json` together. Restart
the process after updating the source and rebuilding.

### Docker

Use the published image:

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 3000:3000 \
  ghcr.io/lightalso/teamspeakweb:latest
```

Or build and run the included Compose service:

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

When TeamSpeak runs on the same Docker host, set these values in `.env`:

```dotenv
TSWEB_LOCK_SERVER=true
TSWEB_TEAMSPEAK_ADDRESS=host.docker.internal:9987
```

`compose.yaml` maps `host.docker.internal` to the host gateway on Linux and
Docker Desktop. If TeamSpeak is another container on the same network, use its
service name, for example `teamspeak:9987`.

Useful Compose commands:

```bash
docker compose ps
docker compose up -d --build
docker compose down
```

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Gateway listen address |
| `PORT` | `3000` | HTTP/HTTPS and WebSocket port |
| `SSL_CERT` | unset | TLS certificate file; use together with `SSL_KEY` |
| `SSL_KEY` | unset | TLS private key file; use together with `SSL_CERT` |
| `TSWEB_LOCK_SERVER` | `false` | Lock the login form and gateway to one server |
| `TSWEB_TEAMSPEAK_ADDRESS` | `127.0.0.1:9987` | Backend TeamSpeak address when locked |

`TSWEB_LOCK_SERVER` accepts `true`, `1`, `yes`, or `on`. In locked mode, the
browser shows the website host as a read-only label while the gateway always
uses `TSWEB_TEAMSPEAK_ADDRESS`.

Compose additionally reads `TSWEB_BIND` and `TSWEB_PORT` from `.env` to control
the host-side bind address and published port.

### HTTPS

Microphone capture requires HTTPS on LAN addresses and public domains. Either
set `SSL_CERT` and `SSL_KEY`, or put an HTTPS reverse proxy in front of the
gateway. A reverse proxy must forward WebSocket upgrades:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

Allow inbound TCP for the web service and outbound UDP from the gateway to the
TeamSpeak server.

### Android

The Capacitor 8 Android project supports Android 7 (API 24) and later. It
contains the UI, Opus assets, and embedded Node.js TeamSpeak runtime.

Requirements: Node.js 22+, JDK/Android Studio, Android SDK Platform 36, and
internet access for the first Gradle build.

Create a fixed release identity once, then build:

```bash
npm run android:signing:init
npm run android:apk
```

The signed APK is written to `artifacts/TeamSpeakWeb-release.apk`. Back up these
ignored files securely; they are required for future upgrade-compatible builds:

```text
android/release-signing/teamspeakweb-release.jks
android/keystore.properties
```

Use `npm run android:apk:debug` for a development APK, `npm run android:run` for
a connected device/emulator, or `npm run android:open` for Android Studio.

### Automated releases

Pushing a `v*` tag whose value matches `package.json` starts
`.github/workflows/release.yml`. It publishes:

- `linux/amd64` Docker images to GHCR with the version and `latest` tags.
- A universal, signed Android release APK and SHA-256 file to GitHub Releases.

The Android job requires these repository secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Always reuse the same keystore for Android updates.

### Local data and security

Connection details, passwords, preferences, and the generated TeamSpeak private
identity are stored unencrypted in the current browser profile's `localStorage`.
Do not use a shared or untrusted profile. Clearing site data removes the saved
identity.

### Troubleshooting

- **Microphone unavailable:** use HTTPS outside `localhost` and check browser
  site permissions.
- **`send ENETUNREACH`:** check outbound UDP routing/firewall rules; try an
  explicit IPv4 address.
- **`insufficient client permissions (id=2568)`:** the normal welcome data is
  usually sufficient. On customized servers, grant
  `b_virtualserver_channel_list`, `b_virtualserver_client_list`, and
  `b_virtualserver_info_view` to the connecting group.
- **WebSocket fails behind a proxy:** forward `Upgrade` and `Connection`, use
  HTTP/1.1 upstream, and use `wss://` from HTTPS pages.

### Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run with automatic restart |
| `npm test` | Build and run regression tests |
| `npm run typecheck` | Check web and Android TypeScript |
| `npm run build` | Compile the Node.js gateway |
| `npm run android:sync` | Bundle and sync Android assets |
| `npm run android:apk` | Build the signed release APK |

Main directories:

```text
public/      Browser UI and audio workers
server/      TeamSpeak gateway and shared session logic
mobile/      Android embedded transport
android/     Capacitor Android project
scripts/     Build and packaging scripts
```

Current limitations: only TeamSpeak Opus codec IDs 4 and 5 are decoded; browser
voice requires WebAssembly and Web Audio support.

## 简体中文

### 主要功能

- TeamSpeak 频道、客户端、文字聊天、戳一戳和语音功能。
- 麦克风常开、按键说话和静音三种模式。
- 麦克风、总输出及单个客户端音量调节。
- 响应式桌面/移动端界面、桌面栏目拖动、日夜主题及中英文切换。
- 在浏览器本地保存连接信息并复用 TeamSpeak 身份。
- 支持 Docker 部署和可独立运行的 Android APK。

### 工作原理

```text
浏览器界面 ── WebSocket ── Node.js 网关 ── UDP ── TeamSpeak 服务器
Android APP ── 内嵌 Node.js 运行时 ─────── UDP ── TeamSpeak 服务器
```

浏览器不能直接使用 UDP，因此网页版需要轻量网关。Android APP 已内嵌相同的连接
逻辑，可以直接连接 TeamSpeak，不依赖外部 TeamSpeak Web 后端。

### 环境要求

- Node.js 20.19 或更高版本，推荐 Node.js 22 LTS。
- 支持 WebAssembly 和 Web Audio 的现代浏览器。
- 网关能够访问 TeamSpeak UDP 端口，通常为 `9987`。
- 除 `localhost` 外，浏览器使用麦克风需要 HTTPS。

### 从源码运行

```bash
git clone https://github.com/Lightalso/TeamSpeakWeb.git
cd TeamSpeakWeb
npm ci
npm start
```

也可以在 GitHub 下载 ZIP，解压后执行 `npm install` 和 `npm start`。访问
<http://localhost:3000>。开发时可使用 `npm run dev` 自动重启。

生产环境可预先编译：

```bash
npm ci
npm run typecheck
npm run build
npm prune --omit=dev
node dist/src/index.js
```

部署时需要同时保留 `dist/`、`public/`、`node_modules/` 和 `package.json`。更新源码
并重新构建后，需要重启进程。

### Docker 部署

直接使用已发布镜像：

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 3000:3000 \
  ghcr.io/lightalso/teamspeakweb:latest
```

或者使用仓库中的 Compose 配置构建：

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

TeamSpeak 与本项目位于同一 Docker 主机时，在 `.env` 中设置：

```dotenv
TSWEB_LOCK_SERVER=true
TSWEB_TEAMSPEAK_ADDRESS=host.docker.internal:9987
```

`compose.yaml` 已在 Linux 和 Docker Desktop 中将 `host.docker.internal` 映射到
宿主机。如果 TeamSpeak 位于同一网络中的其他容器，请改用其服务名，例如
`teamspeak:9987`。

常用命令：

```bash
docker compose ps
docker compose up -d --build
docker compose down
```

### 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 网关监听地址 |
| `PORT` | `3000` | HTTP/HTTPS 和 WebSocket 端口 |
| `SSL_CERT` | 未设置 | TLS 证书文件，需要与 `SSL_KEY` 同时设置 |
| `SSL_KEY` | 未设置 | TLS 私钥文件，需要与 `SSL_CERT` 同时设置 |
| `TSWEB_LOCK_SERVER` | `false` | 将登录界面和网关锁定到一台服务器 |
| `TSWEB_TEAMSPEAK_ADDRESS` | `127.0.0.1:9987` | 锁定模式下后端实际连接的地址 |

`TSWEB_LOCK_SERVER` 接受 `true`、`1`、`yes` 或 `on`。锁定后，浏览器只读显示当前
网页地址，网关始终连接 `TSWEB_TEAMSPEAK_ADDRESS`。

Compose 还会从 `.env` 读取 `TSWEB_BIND` 和 `TSWEB_PORT`，分别控制宿主机绑定地址
和对外端口。

### HTTPS

局域网 IP 或公网域名必须使用 HTTPS 才能获取麦克风。可以配置 `SSL_CERT` 与
`SSL_KEY` 使用内置 HTTPS，也可以在网关前部署 HTTPS 反向代理。反向代理必须转发
WebSocket 升级：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

防火墙需要允许网页服务的入站 TCP，以及网关到 TeamSpeak 服务器的出站 UDP。

### Android APP

Capacitor 8 Android 工程支持 Android 7（API 24）及更高版本，内置网页界面、Opus
资源和 Node.js TeamSpeak 运行时。

构建需要 Node.js 22+、JDK/Android Studio、Android SDK Platform 36，以及首次
Gradle 构建时的互联网连接。

首次生成固定 release 签名，然后构建：

```bash
npm run android:signing:init
npm run android:apk
```

已签名 APK 位于 `artifacts/TeamSpeakWeb-release.apk`。请安全备份以下被 Git 忽略的
文件，后续版本覆盖安装必须继续使用同一签名：

```text
android/release-signing/teamspeakweb-release.jks
android/keystore.properties
```

开发版使用 `npm run android:apk:debug`；连接设备或模拟器使用
`npm run android:run`；使用 Android Studio 打开工程则执行 `npm run android:open`。

### GitHub 自动发布

推送与 `package.json` 版本一致的 `v*` Tag 会触发
`.github/workflows/release.yml`，自动发布：

- 带版本号和 `latest` 标签的 GHCR `linux/amd64` Docker 镜像。
- GitHub Release 中的通用已签名 Android release APK 和 SHA-256 文件。

Android 任务需要以下仓库 Secrets：

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

所有 Android 版本必须持续复用同一份 keystore。

### 本地数据与安全

连接地址、密码、偏好设置和生成的 TeamSpeak 私有身份会以未加密形式保存在当前
浏览器配置的 `localStorage` 中。请勿使用共享或不受信任的浏览器配置。清除网站
数据会同时删除保存的身份。

### 常见问题

- **无法使用麦克风：** 除 `localhost` 外请使用 HTTPS，并检查浏览器网站权限。
- **`send ENETUNREACH`：** 检查网关的出站 UDP 路由和防火墙，尝试直接填写 IPv4。
- **`insufficient client permissions (id=2568)`：** 通常可使用标准欢迎数据；特殊
  服务器可向连接组授予 `b_virtualserver_channel_list`、
  `b_virtualserver_client_list` 和 `b_virtualserver_info_view`。
- **反向代理后 WebSocket 失败：** 转发 `Upgrade` 与 `Connection`，上游使用
  HTTP/1.1，HTTPS 页面应连接 `wss://`。

### 开发

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 自动重启的开发服务 |
| `npm test` | 构建并运行回归测试 |
| `npm run typecheck` | 检查网页和 Android TypeScript |
| `npm run build` | 编译 Node.js 网关 |
| `npm run android:sync` | 打包并同步 Android 资源 |
| `npm run android:apk` | 构建已签名 release APK |

主要目录：

```text
public/      浏览器界面与音频 Worker
server/      TeamSpeak 网关和共享会话逻辑
mobile/      Android 内嵌传输层
android/     Capacitor Android 工程
scripts/     构建与打包脚本
```

当前限制：仅解码 TeamSpeak Opus 编码 ID 4 和 5；网页版语音依赖 WebAssembly 和
Web Audio 支持。

## License / 许可证

[MIT](LICENSE)
