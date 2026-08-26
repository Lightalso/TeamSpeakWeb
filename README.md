# TeamSpeak Web

A browser-based TeamSpeak client. Join a TeamSpeak 3 / 5 / 6 server, browse
channels, see who is online, text-chat, and voice-chat — all from a web page.

## How it works

Browsers cannot open a raw TeamSpeak UDP socket, so the project uses a thin UDP
gateway. Opus encoding, decoding, buffering and mixing run in the browser:

```
┌──────────────────────────┐   WebSocket (control + Opus)   ┌──────────────────┐
│ Browser                  │ ──────────────────────────────▶│ Thin Node gateway│
│ • WebAssembly Opus       │ ◀──────────────────────────────│ • TS protocol    │
│ • AudioWorklet capture   │                                │ • UDP transport  │
│ • jitter buffer + mixer  │                                └────────┬─────────┘
└──────────────────────────┘                                         │ UDP
                                                                     ▼
                                                        TeamSpeak server (v3/5/6)
```

- **`@honeybbq/teamspeak-client`** (the `teamspeak-js` reference repo) implements
  the TeamSpeak client protocol (handshake, crypto, commands, voice packets).
- The browser uses precompiled **libopus WebAssembly** for Opus and uses
  **AudioWorklet** when available for low-jitter capture/playback. The gateway
  forwards compressed packets without decoding.
- The frontend's look and status layout are inspired by the **ts-website**
  reference repo.

## Requirements

- **Node.js 20.19+** (tested on 22.x)
- A current browser with WebAssembly and Web Audio support
- A TeamSpeak server (3.x, 5.x, or 6.x) reachable over UDP port 9987

## Install

```bash
npm install
```

## Run

```bash
npm start          # or: npm run dev (auto-reload)
```

Open <http://localhost:3000>. Change the port with `PORT=8080 npm start`.

The frontend may also be hosted as static files. Point it at a separate gateway
with `?bridge=wss://gateway.example.com/ws`, or set `window.TSWEB_BRIDGE_URL`
before `main.js` loads.

## Usage

1. Enter the server address (e.g. `ts.example.com:9987`), a nickname, and any
   server / channel passwords.
2. Click **Connect**. Allow microphone access when prompted.
3. Browse channels on the left, click one to see its clients, then **Join**.
4. Voice controls at the bottom:
   - **Mic** — toggle your microphone.
   - **PTT** — push-to-talk mode; hold **Space** or the **Push to talk** button.
   - Without PTT, voice activity detection gates your mic automatically.
5. Chat appears in the right panel; type in the box to message your channel.

Your identity is generated automatically and persisted in `localStorage` so you
keep the same UID between sessions.

## Configuration

| Env var    | Default   | Description                                            |
| ---------- | --------- | ------------------------------------------------------ |
| `PORT`     | `3000`    | HTTP/WebSocket listen port                             |
| `HOST`     | `0.0.0.0` | Bind address                                           |
| `SSL_CERT` | —         | Path to a TLS certificate (enables HTTPS when set)     |
| `SSL_KEY`  | —         | Path to the TLS private key (enables HTTPS when set)   |

### Microphone on your LAN

Browsers only allow microphone access from a **secure context** — `https://`
or `localhost`. If you access the bridge from another device via a plain
`http://192.168.x.x:3000` URL, you will still hear others but the mic stays
unavailable. Serve over HTTPS instead:

```bash
# generate a self-signed certificate (answer the prompts)
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout key.pem -out cert.pem

SSL_CERT=cert.pem SSL_KEY=key.pem npm start
```

Then open `https://<your-host>:3000` and accept the self-signed warning. (Use
`mkcert` for a locally-trusted certificate instead of a raw self-signed one.)

## Troubleshooting

### `send ENETUNREACH`

The bridge resolves hostname connections to an IPv4 address before creating the
TeamSpeak UDP client. This avoids Node selecting an unreachable IPv6 route on
dual-stack DNS names. Explicit IPv4, bracketed IPv6, and custom ports are
preserved.

### `insufficient client permissions (id=2568)`

Some servers reject the optional `channellist`, `clientlist`, and `serverinfo`
commands for guests. The bridge primarily builds its UI from the standard data
the server pushes during the client welcome sequence, just like a desktop
client, so these extra permissions are not normally required. A rejected query
is remembered and is not repeated for every client event.

If a heavily customized server also suppresses the corresponding welcome data,
grant the connecting group `b_virtualserver_channel_list`,
`b_virtualserver_client_list`, and `b_virtualserver_info_view` as a fallback.

## Project layout

```
server/src/
  index.ts      HTTP server + WebSocket wiring + static file serving
  session.ts    one TeamSpeak client instance per browser session
  protocol.ts   WebSocket message contracts
  welcome.ts    standard welcome-sequence channel/server data capture
public/         browser UI, WebAssembly Opus and AudioWorklet audio pipeline
参考仓库/        reference source material (gitignored)
```

## Limitations

- Only **Opus** voice codecs (TS codec 4/5) are decoded; legacy Speex/CELT is ignored.
- Voice requires browser WebAssembly and Web Audio support.
- Voice requires microphone access from a secure context (`https` or
  `localhost`).

## License

MIT — see `LICENSE`. The bundled protocol library is a clean-room implementation
and is not affiliated with TeamSpeak Systems GmbH.
