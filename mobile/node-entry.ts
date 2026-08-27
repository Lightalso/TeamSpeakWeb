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

const session = new Session({
  sendJson: (message) => channel.post("server-message", message),
  sendBinary: (data) => channel.post("speaker-opus", Buffer.from(data).toString("base64")),
  close: () => channel.post("transport-closed"),
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
