import type { Client, ChannelInfo } from "@honeybbq/teamspeak-client";
import { parseCommand } from "@honeybbq/teamspeak-client/command";
import type { Packet } from "@honeybbq/teamspeak-client/transport";
import type { ServerInfo } from "./protocol.js";

export interface CapturedClient {
  id: number;
  nickname: string;
  uid: string;
  cid: string;
  type: number;
  serverGroups: string[];
}

interface WelcomeCaptureHandlers {
  onChannels(channels: ChannelInfo[]): void;
  onServerInfo(info: ServerInfo): void;
  onClientEnter(client: CapturedClient): void;
  onClientMoved(id: number, cid: string): void;
}

/**
 * Observe the normal client welcome sequence before the SDK discards its data
 * rows. This is the same data a desktop TeamSpeak client uses to build its UI,
 * and unlike explicit list queries it does not require ServerQuery permissions.
 */
export function attachWelcomeCapture(client: Client, handlers: WelcomeCaptureHandlers): void {
  const original = client.handler.onPacket;
  const channels = new Map<bigint, ChannelInfo>();

  client.handler.onPacket = (packet) => {
    try {
      capturePacket(packet, channels, handlers);
    } catch (err) {
      console.warn("[ts] welcome capture failed:", err);
    } finally {
      original?.(packet);
    }
  };
}

function capturePacket(
  packet: Packet,
  channels: Map<bigint, ChannelInfo>,
  handlers: WelcomeCaptureHandlers,
): void {
  const packetType = packet.typeFlagged & 0x0f;
  if ((packetType !== 2 && packetType !== 3) || packet.data.length === 0) return;

  const payload = Buffer.from(packet.data).toString("utf8");
  for (const line of payload.split("\0").join("\n").split("\n")) {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) continue;

    let inheritedChannelID: string | undefined;
    for (const row of splitRows(trimmed)) {
      const parsed = parseDataRow(row);
      if (!parsed) continue;

      const rowChannelID = parsed.params["ctid"] ?? parsed.params["cid"];
      if (rowChannelID !== undefined) inheritedChannelID = rowChannelID;

      if (parsed.name === "notifycliententerview") {
        const id = parseNumber(parsed.params["clid"]);
        if (id > 0) {
          const groups = parsed.params["client_servergroups"] ?? "";
          handlers.onClientEnter({
            id,
            nickname: parsed.params["client_nickname"] ?? "",
            uid: parsed.params["client_unique_identifier"] ?? "",
            cid: rowChannelID ?? inheritedChannelID ?? "0",
            type: parseNumber(parsed.params["client_type"]),
            serverGroups: groups ? groups.split(",") : [],
          });
        }
      } else if (parsed.name === "notifyclientmoved") {
        const id = parseNumber(parsed.params["clid"]);
        const cid = rowChannelID ?? inheritedChannelID;
        if (id > 0 && cid !== undefined) handlers.onClientMoved(id, cid);
      }

      if (parsed.name === "initserver") {
        if (
          parsed.params["virtualserver_name"] !== undefined ||
          parsed.params["virtualserver_unique_identifier"] !== undefined ||
          parsed.params["virtualserver_maxclients"] !== undefined
        ) {
          handlers.onServerInfo(toServerInfo(parsed.params));
        }
      }

      const cid = parsed.params["cid"];
      const channelName = parsed.params["channel_name"];
      if (cid === undefined || channelName === undefined) continue;

      try {
        const id = BigInt(cid);
        channels.set(id, {
          id,
          parentID: BigInt(parsed.params["pid"] ?? "0"),
          name: channelName,
          description: parsed.params["channel_description"] ?? "",
        });
      } catch {
        continue;
      }
    }
  }

  if (channels.size > 0) handlers.onChannels([...channels.values()]);
}

function splitRows(line: string): string[] {
  if (!line.includes("|")) return [line];

  const firstSpace = line.indexOf(" ");
  if (firstSpace < 0) return line.split("|").filter(Boolean);

  const name = line.slice(0, firstSpace);
  const rest = line.slice(firstSpace + 1);
  if (name.includes("=")) return line.split("|").filter(Boolean);
  return rest.split("|").filter(Boolean).map((part) => `${name} ${part}`);
}

function parseDataRow(row: string): { name: string; params: Record<string, string> } | null {
  const command = parseCommand(row);
  if (!command) return null;

  if (!command.name.includes("=")) return command;
  const equals = command.name.indexOf("=");
  return {
    name: "",
    params: {
      [command.name.slice(0, equals)]: command.name.slice(equals + 1),
      ...command.params,
    },
  };
}

function toServerInfo(params: Record<string, string>): ServerInfo {
  return {
    name: params["virtualserver_name"] ?? params["virtualserver_name_phonetic"] ?? "",
    uid: params["virtualserver_unique_identifier"] ?? "",
    version: params["virtualserver_version"] ?? "",
    platform: params["virtualserver_platform"] ?? "",
    clientsOnline: parseNumber(params["virtualserver_clientsonline"]),
    maxClients: parseNumber(params["virtualserver_maxclients"]),
    channelsOnline: parseNumber(params["virtualserver_channelsonline"]),
    uptime: params["virtualserver_uptime"] ?? "0",
  };
}

function parseNumber(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
