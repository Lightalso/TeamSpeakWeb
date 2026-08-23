# TeamSpeak Web

A browser-based TeamSpeak client. Join a TeamSpeak 3 / 5 / 6 server, browse
channels, see who is online, text-chat, and voice-chat — all from a web page.

## How it works

Browsers cannot speak the TeamSpeak UDP protocol or encode Opus natively, so the
project is split into two parts that communicate over a WebSocket:

```
┌─────────────┐   WebSocket (JSON control + PCM voice)   ┌──────────────────────┐
│   Browser   │ ────────────────────────────────────────▶│   Node.js bridge     │
│  (frontend) │ ◀────────────────────────────────────────│  (this server)       │
└─────────────┘                                          │  • teamspeak-client  │
   mic → PCM frames      Opus-decoded → PCM frames       │  • @discordjs/opus   │
   PCM → WebAudio        (played back in browser)        └──────────┬───────────┘
                                                                    │ TS3 UDP protocol
                                                                    ▼
                                                          TeamSpeak server (v3/5/6)
```

- **`@honeybbq/teamspeak-client`** (the `teamspeak-js` reference repo) implements
  the TeamSpeak client protocol (handshake, crypto, commands, voice packets).
- **`@discordjs/opus`** (the `opus` reference repo) encodes/decodes Opus audio on
  the server, so the browser only needs to ship raw 48 kHz PCM.
- The frontend's look and status layout are inspired by the **ts-website**
  reference repo.

## Requirements

- **Node.js 20.19+** (tested on 22.x)
- A TeamSpeak server (3.x, 5.x, or 6.x) reachable over UDP port 9987

## Install

```bash
npm install
```

> **Note on `@discordjs/opus`:** it ships prebuilt binaries keyed by exact libc
> version. On systems with a newer glibc than any published prebuild, the
> `postinstall` script (`scripts/install-opus.cjs`) downloads the closest
> compatible prebuild automatically. If that fails, install build tools
> (`build-essential`, `python3`) and run `npm rebuild @discordjs/opus`.

## Run

```bash
npm start          # or: npm run dev (auto-reload)
```

Open <http://localhost:3000>. Change the port with `PORT=8080 npm start`.

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

| Env var  | Default   | Description                          |
| -------- | --------- | ------------------------------------ |
| `PORT`   | `3000`    | HTTP/WebSocket listen port           |
| `HOST`   | `0.0.0.0` | Bind address                         |

## Project layout

```
server/src/
  index.ts      HTTP server + WebSocket wiring + static file serving
  session.ts    one TeamSpeak client instance per browser session
  audio.ts      Opus encode/decode (lazy-loaded @discordjs/opus)
  protocol.ts   WebSocket message contracts
public/         the browser frontend (vanilla JS, no build step)
scripts/        postinstall helper for the Opus native binary
参考仓库/        reference source material (gitignored)
```

## Limitations

- Only **Opus** voice codecs (TS codec 4/5) are decoded; legacy Speex/CELT is
  ignored.
- Voice requires microphone access from a secure context (`https` or
  `localhost`).
- `@discordjs/opus` is a native module; see the install note above.

## License

MIT — see `LICENSE`. The bundled protocol library is a clean-room implementation
and is not affiliated with TeamSpeak Systems GmbH.
