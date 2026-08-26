// WebSocket message contracts shared between the browser client and the
// Node.js bridge. JSON messages are sent as text frames; voice is sent as
// binary frames.

// ---- Client -> Server (JSON) ------------------------------------------------

export type ClientMessage =
  | { type: "connect"; addr: string; nickname: string; identity?: string; serverPassword?: string; defaultChannel?: string; defaultChannelPassword?: string }
  | { type: "disconnect" }
  | { type: "refresh" }
  | { type: "serverInfo" }
  | { type: "join"; cid: string; password?: string }
  | { type: "chat"; targetMode: number; target: string; message: string }
  | { type: "poke"; clid: number; message: string }
  | { type: "startTalking" }
  | { type: "stopTalking" };

// ---- Server -> Client (JSON) ------------------------------------------------

export interface ChannelEntry {
  id: string;
  parentID: string;
  name: string;
}

export interface ClientEntry {
  id: number;
  nickname: string;
  cid: string;
  uid: string;
  type: number;
  serverGroups: string[];
  isSelf: boolean;
  talking: boolean;
}

export interface ServerInfo {
  name: string;
  uid: string;
  version: string;
  platform: string;
  clientsOnline: number;
  maxClients: number;
  channelsOnline: number;
  uptime: string;
}

export interface TextMessageEntry {
  invokerID: number;
  invokerName: string;
  invokerUID: string;
  targetMode: number;
  targetID: string;
  message: string;
}

export type ServerMessage =
  | { type: "connected"; clid: number; cid: string; nickname: string; uid: string; identity: string }
  | { type: "disconnected"; reason?: string }
  | { type: "error"; message: string }
  | { type: "channels"; channels: ChannelEntry[] }
  | { type: "clients"; clients: ClientEntry[] }
  | { type: "serverInfo"; info: ServerInfo }
  | { type: "clientEnter"; client: ClientEntry }
  | { type: "clientLeave"; id: number; reasonID: number; reasonMsg: string }
  | { type: "clientMoved"; id: number; cid: string }
  | { type: "clientTalking"; clid: number; talking: boolean }
  | { type: "textMessage"; msg: TextMessageEntry }
  | { type: "poked"; invokerName: string; message: string }
  | { type: "joined"; cid: string };

// ---- Binary voice frames ----------------------------------------------------
//
// Client -> Server: [0x03][raw Opus packet]
// Server -> Client: [0x04][clid:uint16 BE][codec:uint8][raw Opus packet]

export const MIC_OPUS_FRAME = 0x03;
export const SPEAKER_OPUS_FRAME = 0x04;
