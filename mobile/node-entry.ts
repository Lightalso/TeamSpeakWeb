import { Buffer } from "node:buffer";
import { Session } from "../server/src/session.js";
import type { ClientMessage } from "../server/src/protocol.js";

// `bridge` is supplied by the embedded Node.js runtime and deliberately kept
// external by the mobile bundle build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, channel } = require("bridge") as {
  app: {
    on(event: "pause", listener: (lock: { release(): void }) => void): void;
    on(event: "resume", listener: () => void): void;
  };
  channel: {
    on(event: string, listener: (...args: unknown[]) => void): void;
    post(event: string, ...args: unknown[]): void;
  };
};

const VOICE_BATCH_DELAY_MS = 8;
const VOICE_BATCH_MAX_BYTES = 48 * 1024;
let voiceFrames: Buffer[] = [];
let voiceBytes = 0;
let voiceTimer: ReturnType<typeof setTimeout> | null = null;

function flushVoiceFrames(): void {
  if (voiceTimer) clearTimeout(voiceTimer);
  voiceTimer = null;
  if (voiceFrames.length === 0) return;

  const batch = Buffer.allocUnsafe(2 + voiceFrames.length * 2 + voiceBytes);
  batch.writeUInt16BE(voiceFrames.length, 0);
  let offset = 2;
  for (const frame of voiceFrames) {
    batch.writeUInt16BE(frame.length, offset);
    offset += 2;
    frame.copy(batch, offset);
    offset += frame.length;
  }
  voiceFrames = [];
  voiceBytes = 0;
  channel.post("speaker-opus-batch", batch.toString("base64"));
}

function queueVoiceFrame(data: Uint8Array): void {
  const frame = Buffer.from(data);
  if (voiceFrames.length >= 0xffff || voiceBytes + frame.length > VOICE_BATCH_MAX_BYTES) {
    flushVoiceFrames();
  }
  voiceFrames.push(frame);
  voiceBytes += frame.length;
  if (!voiceTimer) voiceTimer = setTimeout(flushVoiceFrames, VOICE_BATCH_DELAY_MS);
}

const session = new Session({
  sendJson: (message) => channel.post("server-message", message),
  sendBinary: queueVoiceFrame,
  close: () => {
    flushVoiceFrames();
    channel.post("transport-closed");
  },
});

channel.on("client-message", (message) => {
  void session.handleMessage(message as ClientMessage);
});

channel.on("mic-opus", (encoded) => {
  if (typeof encoded !== "string") return;
  session.handleMicOpus(Buffer.from(encoded, "base64"));
});

app.on("pause", (lock) => lock.release());
app.on("resume", () => {});

process.on("uncaughtException", (error) => {
  channel.post("runtime-error", error instanceof Error ? error.message : String(error));
});

process.on("unhandledRejection", (error) => {
  channel.post("runtime-error", error instanceof Error ? error.message : String(error));
});
