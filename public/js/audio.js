const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 960; // 20ms
const VAD_THRESHOLD = 0.02;
const VAD_HANGOVER_MS = 450;

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function clamp(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Captures the microphone, performs voice-activity detection / PTT gating,
 * frames audio into 20ms chunks, and plays back incoming PCM via a small
 * ring buffer.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.micEnabled = false;
    this.ptt = false;
    this.pttHeld = false;
    this.micLevel = 0;
    this.outLevel = 0;

    this._micAcc = new Float32Array(FRAME_SAMPLES);
    this._micFill = 0;
    this._voiceActiveUntil = 0;
    this._playQueue = [];
    this._playOffset = 0;
    this._onMicFrame = null;
  }

  async init() {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: SAMPLE_RATE });
    this._stream = stream;

    const source = this.ctx.createMediaStreamSource(stream);

    // Mic processing (no output connection -> no echo).
    this._micProc = this.ctx.createScriptProcessor(1024, 1, 1);
    this._micProc.onaudioprocess = (e) => this._processMic(e.inputBuffer.getChannelData(0));
    source.connect(this._micProc);

    // Playback sink.
    this._playProc = this.ctx.createScriptProcessor(1024, 1, 1);
    this._playProc.onaudioprocess = (e) => this._processPlay(e.outputBuffer.getChannelData(0));
    this._playProc.connect(this.ctx.destination);

    await this.ctx.resume();
  }

  setOnMicFrame(cb) {
    this._onMicFrame = cb;
  }

  _processMic(input) {
    this.micLevel = Math.min(1, rms(input) * 8);
    const active = rms(input) > VAD_THRESHOLD;
    if (active) this._voiceActiveUntil = performance.now() + VAD_HANGOVER_MS;
    const voiceActive = performance.now() < this._voiceActiveUntil;

    const gated = this.micEnabled && (this.ptt ? this.pttHeld : voiceActive);

    let off = 0;
    while (off < input.length) {
      const need = FRAME_SAMPLES - this._micFill;
      const take = Math.min(need, input.length - off);
      this._micAcc.set(input.subarray(off, off + take), this._micFill);
      this._micFill += take;
      off += take;
      if (this._micFill === FRAME_SAMPLES) {
        if (gated && this._onMicFrame) this._onMicFrame(this._micAcc);
        this._micFill = 0;
      }
    }
  }

  _processPlay(output) {
    let i = 0;
    while (i < output.length && this._playQueue.length) {
      const chunk = this._playQueue[0];
      const take = Math.min(output.length - i, chunk.length - this._playOffset);
      output.set(chunk.subarray(this._playOffset, this._playOffset + take), i);
      i += take;
      this._playOffset += take;
      if (this._playOffset >= chunk.length) {
        this._playQueue.shift();
        this._playOffset = 0;
      }
    }
    for (; i < output.length; i++) output[i] = 0;

    let peak = 0;
    for (let j = 0; j < output.length; j++) {
      const a = Math.abs(output[j]);
      if (a > peak) peak = a;
    }
    this.outLevel = Math.min(1, peak * 4);
  }

  /** Enqueue decoded PCM (Float32Array) for playback. */
  play(pcmFloat32) {
    if (!this.ctx) return;
    this._playQueue.push(pcmFloat32);
    // Cap the queue to avoid unbounded latency.
    if (this._playQueue.length > 24) this._playQueue.splice(0, this._playQueue.length - 24);
  }

  dispose() {
    try {
      this._micProc?.disconnect();
      this._playProc?.disconnect();
      this._stream?.getTracks().forEach((t) => t.stop());
      this.ctx?.close();
    } catch {
      /* noop */
    }
    this.ctx = null;
  }
}

export { clamp, SAMPLE_RATE, FRAME_SAMPLES };
