import { Capacitor } from "@capacitor/core";
import { Nodejs } from "@capawesome/capacitor-nodejs";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

class EmbeddedNodeSocket {
  binaryType = "arraybuffer";
  readyState = CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Error) => void) | null = null;
  #messageListener: { remove(): Promise<void> } | null = null;

  constructor() {
    void this.#initialize();
  }

  async #initialize(): Promise<void> {
    try {
      this.#messageListener = await Nodejs.addListener("message", (event) => {
        const value = event.args[0];
        if (event.eventName === "server-message") {
          this.onmessage?.({ data: JSON.stringify(value) });
        } else if (event.eventName === "speaker-opus" && typeof value === "string") {
          this.onmessage?.({ data: decodeBase64(value) });
        } else if (event.eventName === "transport-closed") {
          this.#finishClose();
        } else if (event.eventName === "runtime-error") {
          this.onerror?.(new Error(typeof value === "string" ? value : "Embedded Node.js runtime failed"));
        }
      });

      let resolveReady: (() => void) | null = null;
      const readyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const readyListener = await Nodejs.addListener("ready", () => resolveReady?.());
      const { ready } = await Nodejs.isReady();
      if (!ready) {
        let timer = 0;
        await Promise.race([
          readyPromise,
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Embedded TeamSpeak runtime startup timed out")),
              20_000,
            );
          }),
        ]);
        clearTimeout(timer);
      }
      await readyListener.remove();
      this.readyState = OPEN;
      this.onopen?.();
    } catch (error) {
      this.readyState = CLOSED;
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      this.onclose?.();
    }
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== OPEN) return;
    if (typeof data === "string") {
      let message: unknown;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      void Nodejs.send({ eventName: "client-message", args: [message as never] });
      return;
    }

    const bytes = data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (bytes[0] !== 0x03 || bytes.length <= 1) return;
    void Nodejs.send({ eventName: "mic-opus", args: [encodeBase64(bytes.subarray(1))] });
  }

  close(): void {
    if (this.readyState >= CLOSING) return;
    this.readyState = CLOSING;
    void Nodejs.send({ eventName: "client-message", args: [{ type: "disconnect" }] })
      .catch(() => {})
      .finally(() => this.#finishClose());
  }

  #finishClose(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    void this.#messageListener?.remove();
    this.#messageListener = null;
    this.onclose?.();
  }
}

declare global {
  interface Window {
    TSWEB_CREATE_TRANSPORT?: () => EmbeddedNodeSocket;
    TSWEB_EMBEDDED_NODE?: boolean;
  }
}

if (Capacitor.isNativePlatform()) {
  window.TSWEB_EMBEDDED_NODE = true;
  window.TSWEB_CREATE_TRANSPORT = () => new EmbeddedNodeSocket();
}
