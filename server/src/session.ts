import {
  Client,
  generateIdentity,
  identityFromString,
  getUidFromPublicKey,
  listChannels,
  listClients,
  sendTextMessage,
  clientMove,
  poke,
} from "@honeybbq/teamspeak-client";
import type { WebSocket } from "ws";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  type ClientMessage,
  type ServerMessage,
  type ClientEntry,
  type ChannelEntry,
  type ServerInfo,
  SPEAKER_OPUS_FRAME,
} from "./protocol.js";
import { attachWelcomeCapture } from "./welcome.js";

const CODEC = 5; // Opus Music, matching the browser WebCodecs encoder.
const IDENTITY_LEVEL = 8;

/**
 * Resolve a `host[:port]` address to an explicit IPv4 literal, preserving the
 * port. Already-numeric addresses (IPv4/IPv6) are returned unchanged, and a
 * failed lookup falls back to the original hostname.
 */
export async function resolveIpv4(addr: string): Promise<string> {
  const input = addr.trim();
  let host = input;
  let port = "9987";

  const bracketedIpv6 = /^\[([^\]]+)](?::(\d+))?$/.exec(input);
  if (bracketedIpv6) {
    host = bracketedIpv6[1]!;
    port = bracketedIpv6[2] ?? port;
  } else if (isIP(input) !== 6) {
    const hostAndPort = /^(.*):(\d+)$/.exec(input);
    if (hostAndPort) {
      host = hostAndPort[1]!;
      port = hostAndPort[2]!;
    }
  }

  const ipFamily = isIP(host);
  if (ipFamily) {
    return ipFamily === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  }
  try {
    const { address } = await lookup(host, { family: 4 });
    return `${address}:${port}`;
  } catch {
    return `${host}:${port}`;
  }
}

/** Unescape a TeamSpeak-protocol-escaped string. */
export function tsUnescape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== "\\" || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const next = s[i + 1]!;
    switch (next) {
      case "\\": out += "\\"; break;
      case "/": out += "/"; break;
      case "s": out += " "; break;
      case "p": out += "|"; break;
      case "a": out += "\x07"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "v": out += "\v"; break;
      default: out += next;
    }
    i++;
  }
  return out;
}

/**
 * A single browser connection bridged to one TeamSpeak client instance.
 * Handles control messages and relays voice in both directions.
 */
export class Session {
  #ws: WebSocket;
  #client: Client | null = null;
  #identityStr: string | undefined;
  #closed = false;
  #permissionWarned = false;
  #channelQueryDenied = false;
  #clientQueryDenied = false;
  #serverInfoQueryDenied = false;
  #fallbackQueriesAt = 0;
  #channels = new Map<string, ChannelEntry>();
  #clients = new Map<number, ClientEntry>();
  #serverInfoCache: ServerInfo | null = null;
  #subscribedAll = false;

  constructor(ws: WebSocket) {
    this.#ws = ws;
  }

  send(msg: ServerMessage): void {
    if (this.#closed || this.#ws.readyState !== this.#ws.OPEN) return;
    this.#ws.send(JSON.stringify(msg));
  }

  sendSpeakerOpus(clid: number, codec: number, opus: Uint8Array): void {
    if (this.#closed || this.#ws.readyState !== this.#ws.OPEN) return;
    const frame = Buffer.allocUnsafe(4 + opus.length);
    frame[0] = SPEAKER_OPUS_FRAME;
    frame.writeUInt16BE(clid & 0xffff, 1);
    frame[3] = codec & 0xff;
    Buffer.from(opus).copy(frame, 4);
    this.#ws.send(frame, { binary: true });
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "connect":
          await this.#connect(msg);
          break;
        case "disconnect":
          await this.disconnect();
          this.#ws.close();
          break;
        case "refresh":
          await this.#refresh();
          break;
        case "serverInfo":
          await this.#serverInfo();
          break;
        case "join":
          await this.#join(msg.cid, msg.password);
          break;
        case "chat":
          await this.#chat(msg.targetMode, msg.target, msg.message);
          break;
        case "poke":
          await this.#poke(msg.clid, msg.message);
          break;
        default:
          break;
      }
    } catch (err) {
      this.send({ type: "error", message: (err as Error).message });
    }
  }

  handleMicOpus(opus: Buffer): void {
    if (!this.#client || opus.length <= 1 || opus.length > 4_000) return;
    try {
      this.#client.sendVoice(opus, CODEC);
    } catch {
      // Ignore packets racing with a closed TeamSpeak socket.
    }
  }

  async #connect(msg: Extract<ClientMessage, { type: "connect" }>): Promise<void> {
    if (this.#client) await this.disconnect();
    this.#permissionWarned = false;
    this.#channelQueryDenied = false;
    this.#clientQueryDenied = false;
    this.#serverInfoQueryDenied = false;
    this.#fallbackQueriesAt = 0;
    this.#channels.clear();
    this.#clients.clear();
    this.#serverInfoCache = null;
    this.#subscribedAll = false;

    let identity;
    if (msg.identity) {
      identity = identityFromString(msg.identity);
    } else {
      identity = generateIdentity(IDENTITY_LEVEL);
    }
    this.#identityStr = identity.toString();

    // Resolve hostnames to an IPv4 address up-front. A hostname with both A
    // and AAAA records can make the library's `udp4` socket re-resolve to IPv6
    // during sends, which fails with ENETUNREACH on hosts without IPv6 routing.
    const addr = await resolveIpv4(msg.addr);

    const client = new Client(identity, addr, msg.nickname, {
      serverPassword: msg.serverPassword ?? "",
      defaultChannel: msg.defaultChannel ?? "",
      defaultChannelPassword: msg.defaultChannelPassword ?? "",
      logger: {
        debug() {},
        info() {},
        warn: (m, ...a) => console.warn("[ts]", m, ...a),
        error: (m, ...a) => console.error("[ts]", m, ...a),
      },
    });

    client.on("connected", () => {
      this.#fallbackQueriesAt = Date.now() + 2_000;
      this.send({
        type: "connected",
        clid: client.clientID(),
        cid: client.channelID().toString(),
        nickname: msg.nickname,
        uid: getUidFromPublicKey(identity.publicKeyBase64()),
        identity: this.#identityStr ?? identity.toString(),
      });
      // The welcome sequence may still be streaming; refresh shortly after.
      setTimeout(() => void this.#refresh(), 400);
      setTimeout(() => void this.#refresh(), 1500);
      setTimeout(() => {
        void (async () => {
          await this.#refresh();
          await this.#serverInfo();
        })();
      }, 2500);
    });

    client.on("disconnected", (err) => {
      this.send({ type: "disconnected", reason: err?.message });
      this.#ws.close();
    });

    client.on("kicked", (reason) => {
      this.send({ type: "disconnected", reason: `kicked: ${reason}` });
      this.#ws.close();
    });

    client.on("clientEnter", (info) => {
      let entry = this.#toClientEntry(info, client.clientID(), true);
      const captured = this.#clients.get(entry.id);
      if (entry.cid === "0" && captured && captured.cid !== "0") entry = { ...entry, cid: captured.cid };
      this.#clients.set(entry.id, entry);
      this.send({ type: "clientEnter", client: entry });
      this.#sendClientSnapshot();
      if (entry.isSelf) void this.#subscribeAllChannels(client);
    });

    client.on("clientLeave", (evt) => {
      // Reasons 0-2 mean view/subscription changes rather than a definitive
      // disconnect. Keeping the entry prevents clients in other channels from
      // disappearing while channelsubscribeall is being established.
      if (evt.reasonID <= 2) return;
      this.#clients.delete(evt.id);
      this.send({ type: "clientLeave", id: evt.id, reasonID: evt.reasonID, reasonMsg: tsUnescape(evt.reasonMsg) });
      this.#sendClientSnapshot();
    });

    client.on("clientMoved", (evt) => {
      const existing = this.#clients.get(evt.id);
      if (existing) this.#clients.set(evt.id, { ...existing, cid: evt.targetChannelID.toString() });
      this.send({ type: "clientMoved", id: evt.id, cid: evt.targetChannelID.toString() });
      this.#sendClientSnapshot();
    });

    client.on("textMessage", (m) => {
      this.send({
        type: "textMessage",
        msg: {
          invokerID: m.invokerID,
          invokerName: tsUnescape(m.invokerName),
          invokerUID: m.invokerUID,
          targetMode: m.targetMode,
          targetID: m.targetID.toString(),
          message: m.message,
        },
      });
    });

    client.on("poked", (p) => {
      this.send({ type: "poked", invokerName: tsUnescape(p.invokerName), message: p.message });
    });

    client.on("voiceData", (data) => {
      this.#handleVoiceData(data.clientId, data.codec, data.data);
    });

    this.#client = client;
    await client.connect();
    attachWelcomeCapture(client, {
      onChannels: (channels) => {
        for (const channel of channels) {
          const entry = {
            id: channel.id.toString(),
            parentID: channel.parentID.toString(),
            name: channel.name,
          };
          if (entry.id !== "0" && entry.name) this.#channels.set(entry.id, entry);
        }
        this.#sendChannelSnapshot();
      },
      onServerInfo: (info) => {
        this.#serverInfoCache = info;
        this.send({ type: "serverInfo", info });
      },
      onClientEnter: (captured) => {
        const entry: ClientEntry = {
          ...captured,
          isSelf: captured.id === client.clientID(),
          talking: false,
        };
        this.#clients.set(entry.id, entry);
        this.send({ type: "clientEnter", client: entry });
        this.#sendClientSnapshot();
      },
      onClientMoved: (id, cid) => {
        const existing = this.#clients.get(id);
        if (!existing) return;
        this.#clients.set(id, { ...existing, cid });
        this.send({ type: "clientMoved", id, cid });
        this.#sendClientSnapshot();
      },
    });
    try {
      await client.waitConnected(AbortSignal.timeout(30_000));
    } catch (err) {
      await this.disconnect();
      throw new Error(`connection failed: ${(err as Error).message}`);
    }

  }

  #handleVoiceData(clientId: number, codec: number, data: Uint8Array): void {
    // Only Opus voice (4) and Opus music (5) are supported.
    if (codec !== 4 && codec !== 5) return;
    // One-byte packets are TS voice-stream terminators/DTX markers, not Opus.
    if (data.length <= 1) return;
    this.sendSpeakerOpus(clientId, codec, data);
  }

  async #subscribeAllChannels(client: Client): Promise<void> {
    if (this.#subscribedAll || this.#client !== client) return;
    this.#subscribedAll = true;
    try {
      await client.execCommand("channelsubscribeall", 5_000);
    } catch (err) {
      this.#subscribedAll = false;
      console.warn("[ts] unable to subscribe to all channels:", (err as Error).message);
    }
  }

  async #refresh(): Promise<void> {
    if (!this.#client) return;

    if (this.#channels.size > 0) {
      this.#sendChannelSnapshot();
    } else if (!this.#channelQueryDenied && Date.now() >= this.#fallbackQueriesAt) {
      try {
        const channels = await listChannels(this.#client);
        for (const channel of channels) {
          const entry = {
            id: channel.id.toString(),
            parentID: channel.parentID.toString(),
            name: channel.name,
          };
          if (entry.id !== "0" && entry.name) this.#channels.set(entry.id, entry);
        }
        this.#sendChannelSnapshot();
      } catch (err) {
        this.#channelQueryDenied = this.#isPermissionError(err);
        this.#handleQueryError("channel list", err);
      }
    }

    if (!this.#client) return;
    if (this.#clients.size > 0 || this.#clientQueryDenied) {
      this.#sendClientSnapshot();
    } else if (Date.now() >= this.#fallbackQueriesAt) {
      try {
        const clients = await listClients(this.#client);
        for (const client of clients) {
          const entry = this.#toClientEntry(client, this.#client.clientID(), false);
          this.#clients.set(entry.id, entry);
        }
        this.#sendClientSnapshot();
      } catch (err) {
        this.#clientQueryDenied = this.#isPermissionError(err);
        this.#handleQueryError("client list", err);
      }
    }
  }

  async #serverInfo(): Promise<void> {
    if (!this.#client) return;
    if (this.#serverInfoCache) {
      this.send({ type: "serverInfo", info: this.#serverInfoCache });
      return;
    }
    if (this.#serverInfoQueryDenied) return;
    if (Date.now() < this.#fallbackQueriesAt) return;

    try {
      const rows = await this.#client.execCommandWithResponse("serverinfo", 5_000);
      const r = rows[0] ?? {};
      const info = {
        name: tsUnescape(r["virtualserver_name"] ?? ""),
        uid: r["virtualserver_unique_identifier"] ?? "",
        version: r["virtualserver_version"] ?? "",
        platform: r["virtualserver_platform"] ?? "",
        clientsOnline: parseInt(r["virtualserver_clientsonline"] ?? "0", 10),
        maxClients: parseInt(r["virtualserver_maxclients"] ?? "0", 10),
        channelsOnline: parseInt(r["virtualserver_channelsonline"] ?? "0", 10),
        uptime: r["virtualserver_uptime"] ?? "0",
      };
      this.#serverInfoCache = info;
      this.send({ type: "serverInfo", info });
    } catch (err) {
      this.#serverInfoQueryDenied = this.#isPermissionError(err);
      this.#handleQueryError("server info", err);
    }
  }

  #handleQueryError(operation: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[ts] ${operation} query failed:`, message);
    if (this.#permissionWarned || !this.#isPermissionError(err)) return;

    this.#permissionWarned = true;
    console.warn("[ts] using the standard welcome-sequence data instead of privileged list queries");
  }

  #isPermissionError(err: unknown): boolean {
    return (err instanceof Error ? err.message : String(err)).includes("insufficient client permissions");
  }

  #sendChannelSnapshot(): void {
    this.send({ type: "channels", channels: [...this.#channels.values()] });
  }

  #sendClientSnapshot(): void {
    this.send({ type: "clients", clients: [...this.#clients.values()] });
  }

  async #join(cid: string, password?: string): Promise<void> {
    if (!this.#client) return;
    await clientMove(this.#client, this.#client.clientID(), BigInt(cid), password ?? "");
    this.send({ type: "joined", cid });
  }

  async #chat(targetMode: number, target: string, message: string): Promise<void> {
    if (!this.#client) return;
    await sendTextMessage(this.#client, targetMode, BigInt(target), message);
  }

  async #poke(clid: number, message: string): Promise<void> {
    if (!this.#client) return;
    await poke(this.#client, clid, message);
  }

  #toClientEntry(info: { id: number; nickname: string; uid: string; channelID: bigint; type: number; serverGroups: string[] }, selfId: number, unescapeNick: boolean): ClientEntry {
    return {
      id: info.id,
      nickname: unescapeNick ? tsUnescape(info.nickname) : info.nickname,
      cid: info.channelID.toString(),
      uid: info.uid,
      type: info.type,
      serverGroups: info.serverGroups,
      isSelf: info.id === selfId,
      talking: false,
    };
  }

  async disconnect(): Promise<void> {
    if (this.#client) {
      const c = this.#client;
      this.#client = null;
      try {
        await c.disconnect();
      } catch {
        // best-effort
      }
    }
  }

  close(): void {
    this.#closed = true;
    void this.disconnect();
  }
}
