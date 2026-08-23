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
import {
  OpusCodec,
  FRAME_SAMPLES,
} from "./audio.js";
import {
  type ClientMessage,
  type ServerMessage,
  type ClientEntry,
  MIC_FRAME,
  SPEAKER_FRAME,
} from "./protocol.js";

const CODEC = 5; // Opus Music (OPUS_APPLICATION_AUDIO matches @discordjs/opus)
const IDENTITY_LEVEL = 8;
const FRAME_BYTES = FRAME_SAMPLES * 2;
const TALKING_TIMEOUT_MS = 500;

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
  #codec: OpusCodec | null = null;
  #identityStr: string | undefined;
  #micBuf = Buffer.alloc(0);
  #talking = new Map<number, NodeJS.Timeout>();
  #closed = false;

  constructor(ws: WebSocket) {
    this.#ws = ws;
  }

  send(msg: ServerMessage): void {
    if (this.#closed || this.#ws.readyState !== this.#ws.OPEN) return;
    this.#ws.send(JSON.stringify(msg));
  }

  sendSpeakerPcm(clid: number, pcm: Buffer): void {
    if (this.#closed || this.#ws.readyState !== this.#ws.OPEN) return;
    const frame = Buffer.allocUnsafe(3 + pcm.length);
    frame[0] = SPEAKER_FRAME;
    frame.writeUInt16BE(clid & 0xffff, 1);
    pcm.copy(frame, 3);
    this.#ws.send(frame, { binary: true });
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {        case "connect":
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

  handleMicPcm(pcm: Buffer): void {
    if (!this.#client) return;
    this.#micBuf = Buffer.concat([this.#micBuf, pcm]);
    while (this.#micBuf.length >= FRAME_BYTES) {
      const frame = this.#micBuf.subarray(0, FRAME_BYTES);
      this.#micBuf = this.#micBuf.subarray(FRAME_BYTES);
      this.#sendVoiceFrame(frame);
    }
  }

  #sendVoiceFrame(pcm: Buffer): void {
    if (!this.#client || !this.#codec?.loaded) return;
    try {
      const opus = this.#codec.encode(pcm);
      this.#client.sendVoice(opus, CODEC);
    } catch {
      // Ignore encode errors on closed sockets.
    }
  }

  async #connect(msg: Extract<ClientMessage, { type: "connect" }>): Promise<void> {
    if (this.#client) await this.disconnect();

    let identity;
    if (msg.identity) {
      identity = identityFromString(msg.identity);
    } else {
      identity = generateIdentity(IDENTITY_LEVEL);
    }
    this.#identityStr = identity.toString();

    const client = new Client(identity, msg.addr, msg.nickname, {
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
      this.send({ type: "clientEnter", client: this.#toClientEntry(info, client.clientID(), true) });
      if (info.id === client.clientID()) void this.#refresh();
    });

    client.on("clientLeave", (evt) => {
      this.send({ type: "clientLeave", id: evt.id, reasonID: evt.reasonID, reasonMsg: tsUnescape(evt.reasonMsg) });
    });

    client.on("clientMoved", (evt) => {
      this.send({ type: "clientMoved", id: evt.id, cid: evt.targetChannelID.toString() });
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
    try {
      await client.waitConnected(AbortSignal.timeout(30_000));
    } catch (err) {
      await this.disconnect();
      throw new Error(`connection failed: ${(err as Error).message}`);
    }

    // Load the Opus codec now so voice is ready as soon as the user speaks.
    if (!this.#codec) {
      const codec = new OpusCodec();
      const ok = await codec.ensureLoaded();
      this.#codec = ok ? codec : null;
    }
  }

  #handleVoiceData(clientId: number, codec: number, data: Uint8Array): void {
    // Only Opus voice (4) and Opus music (5) are supported.
    if (codec !== 4 && codec !== 5) return;
    if (!this.#codec?.loaded) return;
    try {
      const pcm = this.#codec.decode(Buffer.from(data));
      this.sendSpeakerPcm(clientId, pcm);
    } catch {
      // Drop malformed frames.
    }
    this.#markTalking(clientId);
  }

  #markTalking(clientId: number): void {
    const existing = this.#talking.get(clientId);
    if (existing) {
      existing.refresh();
      return;
    }
    this.send({ type: "clientTalking", clid: clientId, talking: true });
    const t = setTimeout(() => {
      this.#talking.delete(clientId);
      this.send({ type: "clientTalking", clid: clientId, talking: false });
    }, TALKING_TIMEOUT_MS);
    this.#talking.set(clientId, t);
  }

  async #refresh(): Promise<void> {
    if (!this.#client) return;
    const [channels, clients] = await Promise.all([
      listChannels(this.#client),
      listClients(this.#client),
    ]);
    this.send({
      type: "channels",
      channels: channels.map((c) => ({ id: c.id.toString(), parentID: c.parentID.toString(), name: c.name })),
    });
    this.send({
      type: "clients",
      clients: clients.map((c) => this.#toClientEntry(c, this.#client!.clientID(), false)),
    });
  }

  async #serverInfo(): Promise<void> {
    if (!this.#client) return;
    const rows = await this.#client.execCommandWithResponse("serverinfo", 5_000);
    const r = rows[0] ?? {};
    this.send({
      type: "serverInfo",
      info: {
        name: tsUnescape(r["virtualserver_name"] ?? ""),
        uid: r["virtualserver_unique_identifier"] ?? "",
        version: r["virtualserver_version"] ?? "",
        platform: r["virtualserver_platform"] ?? "",
        clientsOnline: parseInt(r["virtualserver_clientsonline"] ?? "0", 10),
        maxClients: parseInt(r["virtualserver_maxclients"] ?? "0", 10),
        channelsOnline: parseInt(r["virtualserver_channelsonline"] ?? "0", 10),
        uptime: r["virtualserver_uptime"] ?? "0",
      },
    });
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
      talking: this.#talking.has(info.id),
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
    for (const t of this.#talking.values()) clearTimeout(t);
    this.#talking.clear();
    this.#micBuf = Buffer.alloc(0);
  }

  close(): void {
    this.#closed = true;
    void this.disconnect();
  }
}
