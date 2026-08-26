import {
  Application,
  Signal,
  createDecoder,
  createEncoder,
} from "../vendor/libopus-wasm/index.js";
import { SAMPLE_RATE, FRAME_SAMPLES } from "./audio.js";

/** Raw Opus encoding/decoding backed by a precompiled browser WASM module. */
export class BrowserOpusCodec {
  constructor({ onEncoded, onDecoded, onError }) {
    this.onEncoded = onEncoded;
    this.onDecoded = onDecoded;
    this.onError = onError;
    this.encoder = null;
    this.decoders = new Map();
    this.ready = false;
  }

  async init() {
    if (this.ready) return true;
    if (typeof WebAssembly === "undefined") {
      throw new Error("This browser does not support WebAssembly.");
    }
    this.encoder = await createEncoder({
      sampleRate: SAMPLE_RATE,
      channels: 1,
      frameSize: FRAME_SAMPLES,
      application: Application.Audio,
      signal: Signal.Voice,
      bitrate: 48_000,
      complexity: 8,
      vbr: true,
      fec: true,
      packetLossPercent: 10,
      dtx: false,
    });
    this.ready = true;
    return true;
  }

  encode(samples) {
    if (!this.ready || !this.encoder) return;
    try {
      this.onEncoded(this.encoder.encodeFloat(samples));
    } catch (error) {
      this.#report(error);
    }
  }

  decode(streamId, packet) {
    if (!this.ready || packet.length <= 1) return;
    let decoderPromise = this.decoders.get(streamId);
    if (!decoderPromise) {
      decoderPromise = createDecoder({ sampleRate: SAMPLE_RATE, channels: 1, maxFrameSize: 5760 });
      this.decoders.set(streamId, decoderPromise);
    }
    void decoderPromise
      .then((decoder) => this.onDecoded(streamId, decoder.decodeFloat(packet)))
      .catch((error) => {
        this.removeDecoder(streamId);
        this.#report(error);
      });
  }

  removeDecoder(streamId) {
    const decoderPromise = this.decoders.get(streamId);
    if (!decoderPromise) return;
    this.decoders.delete(streamId);
    void decoderPromise.then((decoder) => decoder.free()).catch(() => {});
  }

  resetDecoders() {
    for (const id of [...this.decoders.keys()]) this.removeDecoder(id);
  }

  close() {
    this.resetDecoders();
    try { this.encoder?.free(); } catch {}
    this.encoder = null;
    this.ready = false;
  }

  #report(error) {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}
