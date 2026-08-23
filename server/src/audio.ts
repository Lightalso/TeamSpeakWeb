import type { OpusEncoder as OpusEncoderType } from "@discordjs/opus";

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 1;
export const FRAME_SAMPLES = 960; // 20ms @ 48kHz

/** TeamSpeak voice codecs (see transport/packet.ts in teamspeak-js). */
export const CODEC_OPUS_VOICE = 4;
export const CODEC_OPUS_MUSIC = 5;

type OpusEncoderCtor = new (rate: number, channels: number) => OpusEncoderType;

/**
 * A lazily-loaded Opus encode/decode context for one session. The native
 * @discordjs/opus module is loaded on demand so the server still boots (with
 * voice disabled) if the binary is unavailable.
 */
export class OpusCodec {
  #encoder: OpusEncoderType | null = null;
  #loading: Promise<void> | null = null;

  /** Load the native module. Resolves false if Opus is unavailable. */
  async ensureLoaded(): Promise<boolean> {
    if (this.#encoder) return true;
    if (!this.#loading) {
      this.#loading = (async () => {
        const mod = (await import("@discordjs/opus")) as { OpusEncoder: OpusEncoderCtor };
        this.#encoder = new mod.OpusEncoder(SAMPLE_RATE, CHANNELS);
      })();
    }
    try {
      await this.#loading;
      return true;
    } catch {
      return false;
    }
  }

  get loaded(): boolean {
    return this.#encoder !== null;
  }

  /** Encode a 20ms (960-sample) mono Int16 PCM buffer to an Opus packet. */
  encode(pcm: Buffer): Buffer {
    if (!this.#encoder) throw new Error("opus codec not loaded");
    return this.#encoder.encode(pcm);
  }

  /** Decode an Opus packet back to Int16 LE PCM. */
  decode(opus: Buffer): Buffer {
    if (!this.#encoder) throw new Error("opus codec not loaded");
    return this.#encoder.decode(opus);
  }
}
