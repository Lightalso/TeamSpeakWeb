# TeamSpeak Web

[English](#english) · [简体中文](#简体中文)

## English

A lightweight browser client for TeamSpeak 3, 5, and 6 servers. It supports
channel browsing, client lists, text chat, voice chat, push-to-talk, individual
client volume, persistent TeamSpeak identities, responsive mobile layouts, and
light/dark themes.

> This is an independent, unofficial project and is not affiliated with or
> endorsed by TeamSpeak Systems GmbH.

### Architecture

Browsers cannot connect directly to TeamSpeak's UDP protocol. This project keeps
a small Node.js gateway for TeamSpeak transport while moving Opus encoding,
decoding, jitter buffering, mixing, and most application state into the browser.

```text
Browser (UI + Web Audio + Opus WASM)
        │
        │ HTTP(S) + WebSocket (control and compressed Opus packets)
        ▼
Node.js gateway
        │
        │ TeamSpeak UDP protocol
        ▼
TeamSpeak 3 / 5 / 6 server
```

The gateway does not decode or mix voice. Each browser connection owns one
TeamSpeak client session.

### Features

- Connect to TeamSpeak 3, 5, and 6 servers, including password-protected servers
  and channels.
- Browse channels and clients, move between channels, and use channel text chat.
- Low-latency Opus audio with dedicated WebAssembly codec workers, adaptive
  jitter buffering, batched Android bridge transport, and AudioWorklet mixing.
- Microphone, push-to-talk, output volume, and per-client volume controls.
- English and Simplified Chinese interfaces with light, dark, and automatic
  themes.
- Desktop resizable panels and a mobile tab layout.
- Connection settings, UI preferences, and the generated TeamSpeak identity are
  persisted in the browser's `localStorage`.

### Requirements

- Node.js **20.19 or later**; Node.js 22 LTS is recommended.
- npm, included with Node.js.
- A current Chromium, Firefox, or Safari browser with WebAssembly and Web Audio.
- Network access from the gateway host to the target TeamSpeak server's UDP voice
  port (normally `9987`).
- HTTPS for microphone access anywhere except `localhost`.

### Quick start from source

Download the source with Git:

```bash
git clone https://github.com/Lightalso/TeamSpeakWeb.git
cd TeamSpeakWeb
npm ci
npm start
```

Alternatively, download **Code → Download ZIP** from the GitHub project page,
extract it, open a terminal in the extracted folder, then run:

```bash
npm install
npm start
```

Open <http://localhost:3000>. `npm start` runs the TypeScript source directly and
is the simplest option for a personal deployment. For development with automatic
restart, use `npm run dev`.

### Production deployment from downloaded source

The following example builds JavaScript once and runs the compiled gateway:

```bash
git clone https://github.com/Lightalso/TeamSpeakWeb.git
cd TeamSpeakWeb
npm ci
npm run typecheck
npm run build
npm prune --omit=dev
node dist/src/index.js
```

`npm ci` also copies the required Opus WebAssembly files into `public/vendor/`.
Do not skip the install step and do not deploy `dist/` alone: the running service
also needs `public/`, `node_modules/`, and `package.json`.

To update an existing Git deployment:

```bash
git pull --ff-only
npm ci
npm run build
npm prune --omit=dev
```

Restart the process after the update. If you deploy from a ZIP archive, replace
the source directory with the new release, run the same install/build commands,
then restart the process.

### Docker deployment

Docker Engine 24+ is recommended. Build and run the image from the project root:

```bash
docker build -t teamspeak-web:latest .
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 3000:3000 \
  teamspeak-web:latest
```

Open <http://localhost:3000>. View status and logs with:

```bash
docker ps --filter name=teamspeak-web
docker logs -f teamspeak-web
```

The image uses a Node.js 22 Debian runtime, runs as the unprivileged `node` user,
and includes an HTTP health check. The multi-stage build leaves TypeScript and
other development dependencies out of the final image.

To change the host-side web port while keeping the container port unchanged:

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 8080:3000 \
  teamspeak-web:latest
```

Then open `http://localhost:8080`.

#### Docker Compose

The included `compose.yaml` builds the image and publishes port `3000` by
default:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

To use another host port or bind address, copy the example environment file,
edit `TSWEB_PORT` and `TSWEB_BIND`, then recreate the service. Use
`TSWEB_BIND=127.0.0.1` when an HTTPS reverse proxy runs on the same host:

```bash
cp .env.example .env
# Edit .env, for example: TSWEB_BIND=127.0.0.1 and TSWEB_PORT=8080
docker compose up -d --build
```

Compose reads this `.env` file for variable substitution; the application itself
still reads its runtime configuration from environment variables.

For the recommended setup where TeamSpeak runs directly on the same Docker host,
enable the locked-server mode in `.env`:

```dotenv
TSWEB_LOCK_SERVER=true
TSWEB_TEAMSPEAK_ADDRESS=host.docker.internal:9987
```

`compose.yaml` maps `host.docker.internal` to Docker's host gateway on Linux and
Docker Desktop. If TeamSpeak runs in another container on the same Docker
network, use that container's service name instead, such as
`teamspeak:9987`.

Stop and remove the container without deleting the source or image:

```bash
docker compose down
```

Update a Git-based Docker deployment with:

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
docker image prune -f
```

The last command is optional and removes unused image layers. Do not add a UDP
port mapping for TeamSpeak: the browser connects to the container over TCP while
the gateway makes outbound UDP connections to the selected TeamSpeak servers.
Ensure Docker's host firewall permits this outbound UDP traffic.

For public or LAN use, place an HTTPS reverse proxy in front of the published
container port. The Nginx example below supports both the web interface and its
WebSocket connection. If built-in HTTPS is preferred, mount certificates
read-only and set `SSL_CERT` and `SSL_KEY`, for example:

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 3443:3000 \
  -v /absolute/path/to/certificates:/certs:ro \
  -e SSL_CERT=/certs/fullchain.pem \
  -e SSL_KEY=/certs/privkey.pem \
  teamspeak-web:latest
```

### Android application package

The repository includes a standalone Capacitor 8 Android project. The APK embeds
the UI, Opus WebAssembly assets, a Node.js Mobile runtime, and the TeamSpeak
session implementation. It connects directly from the phone to the TeamSpeak
server over UDP and does **not** require a separately deployed TeamSpeak Web
gateway.

Requirements for building Android packages:

- Node.js 22 or later.
- Android Studio with its bundled JDK.
- Android SDK Platform 36 and SDK tools. The generated app supports Android 7
  (API 24) and later.
- Internet access during the first Gradle build. The Node.js Mobile runtime
  binaries are downloaded by the Android plugin on demand.
- Network access from the phone to the selected TeamSpeak server's UDP port,
  normally `9987`.

Build a directly installable debug APK on Linux/macOS:

```bash
npm run android:apk
```

Windows PowerShell:

```powershell
npm run android:apk
```

The resulting file is copied to:

```text
artifacts/TeamSpeakWeb-debug.apk
```

Install it on an attached device with Android platform tools:

```bash
adb install -r artifacts/TeamSpeakWeb-debug.apk
```

To run on an emulator/device or open the native project in Android Studio:

```bash
npm run android:run
npm run android:open
```

After frontend or session changes, run `npm run android:sync` before rebuilding.
This command bundles the shared TeamSpeak session into `public/nodejs/` and then
copies both the UI and embedded runtime project into the native application.

For a signed release, first synchronize the app, then open Android Studio and
select **Build → Generate Signed App Bundle or APK**. Choose an Android App
Bundle (`.aab`) for Google Play or a signed APK for direct distribution. Update
`versionCode` and `versionName` in `android/app/build.gradle` for every release,
and keep the signing keystore outside the repository.

The native manifest includes Internet, audio-settings, and microphone
permissions. Android will ask for microphone access when voice is initialized.
App identities, saved connection details, and preferences remain in the app's
private WebView storage. Android backup is disabled to reduce the risk of
copying saved TeamSpeak identities and passwords.

The web-only `TSWEB_LOCK_SERVER` and `TSWEB_TEAMSPEAK_ADDRESS` variables do not
apply to the standalone APK. The Android login form selects the TeamSpeak server
that the phone connects to directly. Consequently, `127.0.0.1` means the Android
device itself, not the machine hosting a web gateway.

### Automated GitHub releases

Pushing a semantic `v*` tag runs `.github/workflows/release.yml`. The workflow
publishes a `linux/amd64` image to
`ghcr.io/<repository-owner>/<repository-name>:<tag>` and also updates the
`latest` tag. After the image succeeds, it builds a universal Android debug APK
for `armeabi-v7a`, `arm64-v8a`, and `x86_64`, creates a GitHub Release, and
uploads the APK together with its SHA-256 checksum.

The tag must equal `v` plus the version in `package.json`. For the current
version:

```bash
git tag v0.0.1
git push origin v0.0.1
```

No additional GitHub secret is required. The Android artifact uses a debug
signature; configure a stable release keystore before distributing through an
app store or relying on in-place upgrades between releases.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/HTTPS and WebSocket listen port |
| `HOST` | `0.0.0.0` | Address on which the gateway listens |
| `SSL_CERT` | unset | TLS certificate file; enables built-in HTTPS with `SSL_KEY` |
| `SSL_KEY` | unset | TLS private-key file; enables built-in HTTPS with `SSL_CERT` |
| `TSWEB_LOCK_SERVER` | `false` | Lock every browser session to the configured TeamSpeak server; accepts `true`, `1`, `yes`, or `on` |
| `TSWEB_TEAMSPEAK_ADDRESS` | `127.0.0.1:9987` | TeamSpeak address used by the gateway when server locking is enabled |

Linux/macOS example:

```bash
HOST=127.0.0.1 PORT=3000 node dist/src/index.js
```

Windows PowerShell example:

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
node dist/src/index.js
```

The application reads environment variables directly; it does not load `.env`
files by itself.

#### Lock the deployment to one TeamSpeak server

When the web gateway and TeamSpeak server run directly on the same machine:

```bash
TSWEB_LOCK_SERVER=true \
TSWEB_TEAMSPEAK_ADDRESS=127.0.0.1:9987 \
npm start
```

With this mode enabled, the login form displays the current website hostname in
a read-only server field. The displayed value is only a user-facing label: the
gateway always connects to `TSWEB_TEAMSPEAK_ADDRESS` and ignores any server
address supplied by the browser. The private backend address is not returned in
the public runtime configuration response.

For a standalone Docker container connecting to TeamSpeak on the Docker host,
add the host-gateway mapping explicitly:

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p 3000:3000 \
  -e TSWEB_LOCK_SERVER=true \
  -e TSWEB_TEAMSPEAK_ADDRESS=host.docker.internal:9987 \
  teamspeak-web:latest
```

### HTTPS and reverse proxy

Microphone capture requires a secure browser context. Plain HTTP works for
`localhost`, but a LAN address or public domain must use HTTPS. For a public
deployment, bind the application to `127.0.0.1` and terminate TLS with a reverse
proxy. Example Nginx site:

```nginx
server {
    listen 443 ssl http2;
    server_name voice.example.com;

    ssl_certificate     /etc/letsencrypt/live/voice.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Allow inbound TCP `443` (or the chosen web port) in the host firewall. The
gateway also needs outbound UDP access to TeamSpeak servers; the TeamSpeak
server's UDP port does not normally need to be opened inbound on the gateway.

Built-in HTTPS is also available when both certificate paths are set:

```bash
SSL_CERT=/path/to/fullchain.pem SSL_KEY=/path/to/privkey.pem npm start
```

### Run as a Linux service

After completing the production build, create
`/etc/systemd/system/teamspeak-web.service` and adjust the user and paths:

```ini
[Unit]
Description=TeamSpeak Web gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=teamspeak-web
WorkingDirectory=/opt/TeamSpeakWeb
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/TeamSpeakWeb/dist/src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teamspeak-web
sudo systemctl status teamspeak-web
```

### Separate static frontend and gateway

The `public/` directory can be hosted separately. Point it to the gateway by
opening the frontend with `?bridge=wss://gateway.example.com/ws`, or define
`window.TSWEB_BRIDGE_URL` before `public/js/main.js` loads. Configure the
gateway's reverse proxy and cross-site access policy appropriately for your
deployment. A same-origin deployment is simpler and is recommended.

### Usage and local data

Enter a TeamSpeak server address, nickname, and optional passwords, then connect
and allow microphone access. The microphone button cycles through open,
push-to-talk, and muted modes. In push-to-talk mode, hold the control or the
Space key on desktop.

Connection information—including server and channel passwords—and the generated
TeamSpeak private identity are stored unencrypted in that browser profile's
`localStorage`. Do not use a shared or untrusted browser profile. Clearing site
data removes the saved identity and creates a new TeamSpeak identity on the next
connection.

### Troubleshooting

#### The page opens, but the microphone is unavailable

Use `https://` unless the page is served from `localhost`. Check the browser's
site permissions and verify that no other policy blocks microphone access.

#### `send ENETUNREACH`

Verify outbound UDP routing and firewall rules from the gateway host to the
TeamSpeak server. The gateway resolves hostname connections to IPv4 first to
avoid an unreachable IPv6 route on dual-stack hosts; explicit IPv4, bracketed
IPv6, and custom ports remain supported.

#### `insufficient client permissions (id=2568)`

The gateway normally builds channel, client, and server state from the standard
welcome data. If a customized server suppresses that data too, grant the guest
or connecting group `b_virtualserver_channel_list`,
`b_virtualserver_client_list`, and `b_virtualserver_info_view`.

#### WebSocket connection fails behind Nginx

Confirm that the proxy forwards the `Upgrade` and `Connection` headers, uses
HTTP/1.1 upstream, and has a sufficiently long read timeout. HTTPS pages must
connect to a `wss://` gateway, not `ws://`.

### Project layout

```text
android/        Capacitor Android Studio project and native manifest
mobile/         Android event transport and embedded Node.js entry point
public/         Browser UI, audio pipeline, and generated Opus WASM assets
scripts/        Dependency preparation and Android packaging scripts
server/src/     HTTP/WebSocket gateway and TeamSpeak session implementation
capacitor.config.ts  Android application identity and bundled web directory
tsconfig.mobile.json Type checking for the embedded runtime and native transport
dist/           Compiled server output (generated and gitignored)
参考仓库/        Local reference source material (gitignored)
```

### Development commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the gateway with automatic restart |
| `npm start` | Run the TypeScript source once |
| `npm run typecheck` | Check TypeScript without producing files |
| `npm run build` | Compile the gateway into `dist/` |
| `npm run prepare:android` | Bundle the embedded TeamSpeak runtime and Android transport |
| `npm run android:sync` | Build mobile assets and copy them into the Android project |
| `npm run android:run` | Synchronize and run on a selected device/emulator |
| `npm run android:apk` | Build a debug APK in `artifacts/` |
| `npm run android:open` | Open the native project in Android Studio |

### Current limitations

- Only Opus TeamSpeak voice codecs (codec IDs 4 and 5) are decoded; legacy
  Speex/CELT audio is ignored.
- Voice depends on browser WebAssembly and Web Audio support.
- The browser build still requires the Node.js UDP gateway. Only the Android APK
  embeds the TeamSpeak transport and runs without that gateway.

### License

[MIT](LICENSE). The bundled TeamSpeak protocol library is a clean-room
implementation.

---

## 简体中文

一个轻量级的 TeamSpeak 3、5、6 网页客户端，支持频道浏览、客户端列表、
文字聊天、语音聊天、按键说话、单独调节客户端音量、持久化 TeamSpeak 身份、
移动端布局以及日间/夜间主题。

> 本项目是独立开发的非官方项目，与 TeamSpeak Systems GmbH 无隶属或背书关系。

### 工作原理

浏览器无法直接连接 TeamSpeak 使用的 UDP 协议，因此本项目保留了一个轻量级
Node.js 网关。Opus 编解码、抖动缓冲、混音和大部分应用状态都在浏览器中完成。

```text
浏览器（界面 + Web Audio + Opus WASM）
        │
        │ HTTP(S) + WebSocket（控制消息与压缩后的 Opus 数据包）
        ▼
Node.js 网关
        │
        │ TeamSpeak UDP 协议
        ▼
TeamSpeak 3 / 5 / 6 服务器
```

网关不解码或混合语音，每个浏览器连接对应一个独立的 TeamSpeak 客户端会话。

### 主要功能

- 连接 TeamSpeak 3、5、6 服务器，包括设置了密码的服务器和频道。
- 浏览频道和客户端、切换频道并使用频道文字聊天。
- 使用独立 WebAssembly 编解码 Worker、自适应抖动缓冲、Android 语音合批传输和
  AudioWorklet 混音的低延迟 Opus 音频。
- 麦克风、按键说话、总输出音量和单客户端音量控制。
- 英文/简体中文界面，以及日间、夜间和自动主题。
- 桌面端可拖动分栏和移动端页签布局。
- 在浏览器 `localStorage` 中持久保存连接信息、界面偏好和 TeamSpeak 身份。

### 环境要求

- Node.js **20.19 或更高版本**，推荐 Node.js 22 LTS。
- Node.js 自带的 npm。
- 支持 WebAssembly 和 Web Audio 的新版 Chromium、Firefox 或 Safari。
- 网关主机能够通过 UDP 访问目标 TeamSpeak 服务器的语音端口，默认是 `9987`。
- 除 `localhost` 外，使用麦克风必须通过 HTTPS 访问。

### 下载源码并快速部署

使用 Git 下载：

```bash
git clone https://github.com/Lightalso/TeamSpeakWeb.git
cd TeamSpeakWeb
npm ci
npm start
```

也可以在 GitHub 项目页面选择 **Code → Download ZIP**，解压后在项目目录中
打开终端并执行：

```bash
npm install
npm start
```

然后打开 <http://localhost:3000>。`npm start` 会直接运行 TypeScript 源码，适合
个人部署和快速体验。开发时可改用 `npm run dev`，修改文件后服务会自动重启。

### 下载源码后的生产部署

以下流程会先编译 JavaScript，再运行编译后的网关：

```bash
git clone https://github.com/Lightalso/TeamSpeakWeb.git
cd TeamSpeakWeb
npm ci
npm run typecheck
npm run build
npm prune --omit=dev
node dist/src/index.js
```

`npm ci` 还会将必需的 Opus WebAssembly 文件复制到 `public/vendor/`，因此不能
跳过依赖安装，也不能只部署 `dist/`。运行时还需要保留 `public/`、
`node_modules/` 和 `package.json`。

使用 Git 部署时可按下面的方式升级：

```bash
git pull --ff-only
npm ci
npm run build
npm prune --omit=dev
```

完成后重启进程。若使用 ZIP 包部署，则用新版本源码替换原目录，重新执行安装和
构建命令，然后重启进程。

### Docker 部署

推荐使用 Docker Engine 24 或更高版本。在项目根目录构建并运行镜像：

```bash
docker build -t teamspeak-web:latest .
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 3000:3000 \
  teamspeak-web:latest
```

然后打开 <http://localhost:3000>。可通过以下命令查看状态和日志：

```bash
docker ps --filter name=teamspeak-web
docker logs -f teamspeak-web
```

镜像使用 Node.js 22 Debian 运行环境，以无特权的 `node` 用户运行，并内置 HTTP
健康检查。多阶段构建不会把 TypeScript 等开发依赖带入最终镜像。

如需修改宿主机网页端口，同时保持容器端口不变：

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 8080:3000 \
  teamspeak-web:latest
```

随后打开 `http://localhost:8080`。

#### Docker Compose

项目中的 `compose.yaml` 会构建镜像，并默认映射到宿主机 `3000` 端口：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

如需使用其他宿主机端口或绑定地址，复制环境变量示例文件，修改 `TSWEB_PORT`
和 `TSWEB_BIND`，然后重新创建服务。如果 HTTPS 反向代理运行在同一台主机上，
应使用 `TSWEB_BIND=127.0.0.1`：

```bash
cp .env.example .env
# 编辑 .env，例如设置：TSWEB_BIND=127.0.0.1 和 TSWEB_PORT=8080
docker compose up -d --build
```

Compose 会读取 `.env` 进行变量替换；应用程序本身仍然只读取运行时环境变量。

如果 TeamSpeak 直接运行在同一台 Docker 宿主机上，推荐在 `.env` 中启用服务器
锁定模式：

```dotenv
TSWEB_LOCK_SERVER=true
TSWEB_TEAMSPEAK_ADDRESS=host.docker.internal:9987
```

`compose.yaml` 会在 Linux 和 Docker Desktop 中把 `host.docker.internal` 映射到
Docker 宿主机网关。如果 TeamSpeak 运行在同一个 Docker 网络中的另一个容器内，
则应改用该容器的服务名，例如 `teamspeak:9987`。

停止并移除容器，但保留源码和镜像：

```bash
docker compose down
```

使用 Git 部署时，可按以下方式升级 Docker 版本：

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
docker image prune -f
```

最后一条命令是可选的，用于删除不再使用的镜像层。不要为 TeamSpeak 添加 UDP
端口映射：浏览器通过 TCP 连接容器，而网关主动向用户选择的 TeamSpeak 服务器
发起 UDP 连接。只需确保 Docker 宿主机防火墙允许这些出站 UDP 流量。

在公网或局域网中使用时，应在容器发布端口前配置 HTTPS 反向代理。后文的 Nginx
示例同时支持网页和 WebSocket。如果希望使用程序内置 HTTPS，可以只读挂载证书
并设置 `SSL_CERT` 和 `SSL_KEY`，例如：

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  -p 3443:3000 \
  -v /absolute/path/to/certificates:/certs:ro \
  -e SSL_CERT=/certs/fullchain.pem \
  -e SSL_KEY=/certs/privkey.pem \
  teamspeak-web:latest
```

### Android APP 打包

仓库已经包含可独立运行的 Capacitor 8 Android 工程。APK 会内置界面、Opus
WebAssembly 资源、Node.js Mobile 运行时和 TeamSpeak 会话实现。手机会通过 UDP
直接连接 TeamSpeak 服务器，**不需要**另外部署 TeamSpeak Web 网关。

Android 打包环境要求：

- Node.js 22 或更高版本。
- Android Studio 及其自带的 JDK。
- Android SDK Platform 36 和 SDK 工具。生成的 APP 支持 Android 7（API 24）及
  更高版本。
- 首次执行 Gradle 构建时需要能够访问互联网，Android 插件会按需下载 Node.js
  Mobile 运行时二进制文件。
- 手机能够通过网络访问目标 TeamSpeak 服务器的 UDP 端口，默认端口为 `9987`。

在 Linux/macOS 中生成可直接安装的调试 APK：

```bash
npm run android:apk
```

Windows PowerShell：

```powershell
npm run android:apk
```

生成结果会复制到：

```text
artifacts/TeamSpeakWeb-debug.apk
```

安装到通过 USB 连接的设备：

```bash
adb install -r artifacts/TeamSpeakWeb-debug.apk
```

在模拟器/设备中运行，或者使用 Android Studio 打开原生工程：

```bash
npm run android:run
npm run android:open
```

修改前端或会话代码后，重新打包前执行 `npm run android:sync`。该命令会将共享的
TeamSpeak 会话代码打包到 `public/nodejs/`，再把界面和内嵌运行项目一起复制到原生
Android 工程中。

如需生成签名正式版本，先同步 APP，然后打开 Android Studio，选择
**Build → Generate Signed App Bundle or APK**。发布到 Google Play 应选择 Android
App Bundle（`.aab`），直接分发则可选择签名 APK。每次发布前请修改
`android/app/build.gradle` 中的 `versionCode` 和 `versionName`，并将签名密钥库
保存在仓库之外。

原生清单已经声明网络、音频设置和麦克风权限。初始化语音时，Android 会请求
麦克风授权。APP 身份、连接记录和偏好设置会保留在应用的私有 WebView 存储中。
Android 备份已关闭，以降低已保存 TeamSpeak 身份和密码被复制的风险。

仅供网页版使用的 `TSWEB_LOCK_SERVER` 和 `TSWEB_TEAMSPEAK_ADDRESS` 不会影响
独立 APK。Android 登录表单中填写的 TeamSpeak 地址由手机直接连接。因此在 APK
中，`127.0.0.1` 表示 Android 设备自身，而不是部署网页网关的机器。

### GitHub 自动发布

推送符合语义化版本格式的 `v*` Tag 后，`.github/workflows/release.yml` 会自动运行。
工作流会把 `linux/amd64` 镜像推送到
`ghcr.io/<仓库所有者>/<仓库名称>:<Tag>`，并同时更新 `latest`；镜像构建成功后，
还会构建包含 `armeabi-v7a`、`arm64-v8a` 和 `x86_64` 的 Android 通用 debug APK，
创建 GitHub Release，并上传 APK 及其 SHA-256 校验文件。

Tag 必须是字母 `v` 加上 `package.json` 中的版本号。当前版本可执行：

```bash
git tag v0.0.1
git push origin v0.0.1
```

该流程不需要额外配置 GitHub Secret。Android 产物使用 debug 签名；如果要发布到
应用商店，或者需要后续版本直接覆盖安装，应先配置固定的 release 签名密钥。

### 配置项

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/HTTPS 与 WebSocket 监听端口 |
| `HOST` | `0.0.0.0` | 网关监听地址 |
| `SSL_CERT` | 未设置 | TLS 证书路径；与 `SSL_KEY` 同时设置时启用内置 HTTPS |
| `SSL_KEY` | 未设置 | TLS 私钥路径；与 `SSL_CERT` 同时设置时启用内置 HTTPS |
| `TSWEB_LOCK_SERVER` | `false` | 将所有浏览器会话锁定到指定 TeamSpeak 服务器；接受 `true`、`1`、`yes` 或 `on` |
| `TSWEB_TEAMSPEAK_ADDRESS` | `127.0.0.1:9987` | 锁定服务器后由网关实际连接的 TeamSpeak 地址 |

Linux/macOS 示例：

```bash
HOST=127.0.0.1 PORT=3000 node dist/src/index.js
```

Windows PowerShell 示例：

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
node dist/src/index.js
```

程序直接读取系统环境变量，不会自动加载 `.env` 文件。

#### 将部署锁定到一台 TeamSpeak 服务器

网页网关和 TeamSpeak 服务都直接运行在同一台机器上时：

```bash
TSWEB_LOCK_SERVER=true \
TSWEB_TEAMSPEAK_ADDRESS=127.0.0.1:9987 \
npm start
```

启用后，登录表单的服务器地址会显示当前网页主机名，并设置为只读。这个显示值
仅用于帮助用户识别服务器；网关始终连接 `TSWEB_TEAMSPEAK_ADDRESS`，并忽略
浏览器请求中携带的任何服务器地址。公开的运行时配置响应不会返回私有后端地址。

如果使用单独的 Docker 容器连接 Docker 宿主机上的 TeamSpeak，需要显式添加
宿主机网关映射：

```bash
docker run -d \
  --name teamspeak-web \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p 3000:3000 \
  -e TSWEB_LOCK_SERVER=true \
  -e TSWEB_TEAMSPEAK_ADDRESS=host.docker.internal:9987 \
  teamspeak-web:latest
```

### HTTPS 与反向代理

浏览器只允许安全上下文获取麦克风。`localhost` 可以使用普通 HTTP，但局域网 IP
或公网域名必须使用 HTTPS。公网部署建议让程序监听 `127.0.0.1`，再通过反向
代理终止 TLS。下面是 Nginx 配置示例：

```nginx
server {
    listen 443 ssl http2;
    server_name voice.example.com;

    ssl_certificate     /etc/letsencrypt/live/voice.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

主机防火墙需要放行 TCP `443` 或你选择的网页端口。网关还需要允许向 TeamSpeak
服务器发出 UDP 流量；通常不需要在网关上入站开放 TeamSpeak 的 UDP 端口。

同时设置证书和私钥路径也可以直接启用程序内置的 HTTPS：

```bash
SSL_CERT=/path/to/fullchain.pem SSL_KEY=/path/to/privkey.pem npm start
```

### 作为 Linux 服务运行

完成生产构建后，新建 `/etc/systemd/system/teamspeak-web.service`，并按实际环境
修改用户和路径：

```ini
[Unit]
Description=TeamSpeak Web gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=teamspeak-web
WorkingDirectory=/opt/TeamSpeakWeb
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/TeamSpeakWeb/dist/src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用并启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teamspeak-web
sudo systemctl status teamspeak-web
```

### 分离部署前端和网关

`public/` 可以单独作为静态文件托管。访问前端时添加
`?bridge=wss://gateway.example.com/ws`，或在加载 `public/js/main.js` 前定义
`window.TSWEB_BRIDGE_URL`，即可指定独立网关。此时需要根据实际部署设置网关的
反向代理和跨站访问策略。配置更简单的前后端同源部署仍是推荐方案。

### 使用方式与本地数据

填写 TeamSpeak 服务器地址、昵称和可选密码后连接，并允许浏览器使用麦克风。
麦克风按钮会在开启、按键说话和静音三种状态间循环；按键说话状态下可长按控件，
桌面端也可以按住空格键。

连接信息（包括服务器和频道密码）以及生成的 TeamSpeak 私有身份会以未加密形式
保存在当前浏览器配置文件的 `localStorage` 中。不要在共享或不受信任的浏览器
配置文件中使用敏感密码。清除站点数据会删除已保存身份，下次连接时会生成新的
TeamSpeak 身份。

### 常见问题

#### 页面可以打开，但无法使用麦克风

除 `localhost` 外请使用 `https://` 访问，同时检查浏览器站点权限，确认麦克风
没有被浏览器或系统策略禁用。

#### `send ENETUNREACH`

检查网关主机到 TeamSpeak 服务器的 UDP 路由和防火墙。网关会优先将域名连接
解析为 IPv4，以避免双栈主机选择不可达的 IPv6 路由；显式 IPv4、方括号形式的
IPv6 以及自定义端口仍然受支持。

#### `insufficient client permissions (id=2568)`

网关通常会从标准欢迎数据中建立频道、客户端和服务器状态。如果服务器经过深度
定制并且也隐藏了这些数据，请为访客组或连接所用权限组授予
`b_virtualserver_channel_list`、`b_virtualserver_client_list` 和
`b_virtualserver_info_view`。

#### 使用 Nginx 后 WebSocket 连接失败

确认反向代理转发了 `Upgrade` 和 `Connection` 请求头，上游使用 HTTP/1.1，并
设置了足够长的读取超时。HTTPS 页面必须连接 `wss://` 网关，不能连接 `ws://`。

### 项目结构

```text
android/        Capacitor Android Studio 工程和原生清单
mobile/         Android 事件传输层和内嵌 Node.js 入口
public/         浏览器界面、音频管线和安装时生成的 Opus WASM 文件
scripts/        依赖准备和 Android 打包脚本
server/src/     HTTP/WebSocket 网关与 TeamSpeak 会话实现
capacitor.config.ts  Android 应用标识和网页资源目录配置
tsconfig.mobile.json 内嵌运行模块和原生传输层的类型检查配置
dist/           编译后的服务端文件（自动生成且不提交到 Git）
参考仓库/        本地参考源码（不提交到 Git）
```

### 开发命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动网关并在源码变化后自动重启 |
| `npm start` | 直接运行一次 TypeScript 源码 |
| `npm run typecheck` | 检查 TypeScript 类型但不生成文件 |
| `npm run build` | 将网关编译到 `dist/` |
| `npm run prepare:android` | 打包内嵌 TeamSpeak 运行模块和 Android 传输层 |
| `npm run android:sync` | 构建移动端资源并同步到 Android 工程 |
| `npm run android:run` | 同步后在选定的设备或模拟器中运行 |
| `npm run android:apk` | 在 `artifacts/` 中生成调试 APK |
| `npm run android:open` | 使用 Android Studio 打开原生工程 |

### 当前限制

- 仅解码 TeamSpeak Opus 语音编码（编码 ID 4 和 5），忽略旧版 Speex/CELT 音频。
- 语音功能依赖浏览器对 WebAssembly 和 Web Audio 的支持。
- 网页版仍然需要 Node.js UDP 网关；只有 Android APK 内嵌 TeamSpeak 传输模块，
  不需要该网关即可独立运行。

### 许可证

[MIT](LICENSE)。项目使用的 TeamSpeak 协议库是洁净室实现。
