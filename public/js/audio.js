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
 * Handles both microphone capture and speaker playback.
 *
 * Playback is always set up (hearing must work even when microphone access is
 * denied), while capture is best-effort and reported via `micAvailable`.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.micAvailable = false;
    this.micError = null;
    this.micEnabled = false;
    this.ptt = false;
    this.pttHeld = false;
    this.micLevel = 0;
    this.outLevel = 0;

    this._onMicFrame = null;
    this._micAcc = new Float32Array(FRAME_SAMPLES);
    this._micFill = 0;
    this._voiceActiveUntil = 0;
    this._playQueue = [];
    this._playOffset = 0;
  }

  async init() {
    if (this.ctx) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try {
      ctx = new Ctx({ sampleRate: SAMPLE_RATE });
    } catch {
      ctx = new Ctx();
    }
    this.ctx = ctx;
    this._sourceRate = ctx.sampleRate;

    // Playback sink (always created so incoming voice can be heard).
    this._playProc = ctx.createScriptProcessor(1024, 1, 1);
    this._playProc.onaudioprocess = (e) => this._processPlay(e.outputBuffer.getChannelData(0));
    this._playProc.connect(ctx.destination);

    // Microphone capture (best-effort).
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
        throw new Error(
          secure
            ? "this browser does not support microphone access"
            : "microphone access requires a secure context (use https:// or localhost)",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this._stream = stream;
      const source = ctx.createMediaStreamSource(stream);

      this._micProc = ctx.createScriptProcessor(1024, 1, 1);
      this._micProc.onaudioprocess = (e) => this._processMic(e.inputBuffer.getChannelData(0));
      source.connect(this._micProc);
      // Route to a muted gain so onaudioprocess reliably fires (an unconnected
      // ScriptProcessor may be pruned by the browser).
      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      this._micProc.connect(muteGain);
      muteGain.connect(ctx.destination);
      this.micAvailable = true;
    } catch (err) {
      this.micError = err;
    }

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* resumed on next user gesture below */
      }
      if (ctx.state === "suspended") {
        const resume = () => {
          ctx.resume();
          window.removeEventListener("pointerdown", resume);
          window.removeEventListener("keydown", resume);
          window.removeEventListener("touchstart", resume);
        };
        window.addEventListener("pointerdown", resume);
        window.addEventListener("keydown", resume);
        window.addEventListener("touchstart", resume);
      }
    }
  }

  setOnMicFrame(cb) {
    this._onMicFrame = cb;
  }

  _processMic(input) {
    const samples =
      this._sourceRate === SAMPLE_RATE ? input : this._resample(input, this._sourceRate, SAMPLE_RATE);
    const level = rms(samples);
    this.micLevel = Math.min(1, level * 8);
    const active = level > VAD_THRESHOLD;
    if (active) this._voiceActiveUntil = performance.now() + VAD_HANGOVER_MS;
    const voiceActive = performance.now() < this._voiceActiveUntil;

    const gated = this.micEnabled && (this.ptt ? this.pttHeld : voiceActive);

    let off = 0;
    while (off < samples.length) {
      const need = FRAME_SAMPLES - this._micFill;
      const take = Math.min(need, samples.length - off);
      this._micAcc.set(samples.subarray(off, off + take), this._micFill);
      this._micFill += take;
      off += take;
      if (this._micFill === FRAME_SAMPLES) {
        if (gated && this._onMicFrame) this._onMicFrame(this._micAcc);
        this._micFill = 0;
      }
    }
  }

  _resample(input, inRate, outRate) {
    const ratio = outRate / inRate;
    const outLen = Math.round(input.length * ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i / ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(i0 + 1, input.length - 1);
      const frac = src - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
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
