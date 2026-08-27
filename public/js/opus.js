/** Opus encoding/decoding hosted in a dedicated worker to keep the UI and
 * AudioWorklet message loop responsive when several clients talk at once. */
export class BrowserOpusCodec {
  constructor({ onEncoded, onDecoded, onError }) {
    this.onEncoded = onEncoded;
    this.onDecoded = onDecoded;
    this.onError = onError;
    this.worker = null;
    this.ready = false;
    this._initPromise = null;
    this._decoderTokens = new Map();
    this._nextDecoderToken = 1;
    this._decodeQueue = [];
    this._decodeFlushScheduled = false;
  }

  async init() {
    if (this.ready) return true;
    if (this._initPromise) return this._initPromise;
    if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") {
      throw new Error("This browser does not support the audio worker required for Opus.");
    }

    this._initPromise = new Promise((resolve, reject) => {
      const worker = new Worker("/js/opus-worker.js", { type: "module", name: "ts-opus" });
      this.worker = worker;
      const fail = (error) => {
        this.worker?.terminate();
        this.worker = null;
        this._initPromise = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      worker.onerror = (event) => {
        const error = new Error(event.message || "Opus worker failed.");
        if (!this.ready) fail(error);
        else {
          this.ready = false;
          this.#report(error);
        }
      };
      worker.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "ready") {
          this.ready = true;
          resolve(true);
        } else if (message?.type === "encoded") {
          this.onEncoded(new Uint8Array(message.packet));
        } else if (message?.type === "decoded-batch") {
          for (const decoded of message.items) {
            if (this._decoderTokens.get(decoded.streamId) !== decoded.token) continue;
            this.onDecoded(decoded.streamId, new Float32Array(decoded.samples));
          }
        } else if (message?.type === "error") {
          this.#report(new Error(message.message || "Opus worker error."));
        }
      };
      worker.postMessage({ type: "init" });
    });
    return this._initPromise;
  }

  encode(samples) {
    if (!this.ready || !this.worker || !samples?.length) return;
    this.worker.postMessage({ type: "encode", samples }, [samples.buffer]);
  }

  decode(streamId, packet) {
    if (!this.ready || !this.worker || packet.length <= 1) return;
    let token = this._decoderTokens.get(streamId);
    if (!token) {
      token = this._nextDecoderToken++;
      this._decoderTokens.set(streamId, token);
    }
    this._decodeQueue.push({ streamId, token, packet });
    if (!this._decodeFlushScheduled) {
      this._decodeFlushScheduled = true;
      queueMicrotask(() => this.#flushDecodeQueue());
    }
  }

  removeDecoder(streamId) {
    this._decoderTokens.delete(streamId);
    this.worker?.postMessage({ type: "remove", streamId });
  }

  resetDecoders() {
    this._decoderTokens.clear();
    this._decodeQueue.length = 0;
    this.worker?.postMessage({ type: "reset" });
  }

  close() {
    this.worker?.postMessage({ type: "close" });
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this._initPromise = null;
    this._decoderTokens.clear();
    this._decodeQueue.length = 0;
  }

  #flushDecodeQueue() {
    this._decodeFlushScheduled = false;
    if (!this.ready || !this.worker || this._decodeQueue.length === 0) return;
    const items = this._decodeQueue;
    this._decodeQueue = [];
    this.worker.postMessage({ type: "decode-batch", items }, items.map((item) => item.packet.buffer));
  }

  #report(error) {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}
