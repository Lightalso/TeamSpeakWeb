const SAMPLE_RATE = 48000;
const FRAME_SAMPLES = 960;
const VAD_THRESHOLD = 0.018;
const VAD_HANGOVER_MS = 500;
const BASE_PREBUFFER_MS = 60;
const MAX_BUFFER_MS = 300;

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function clamp(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

class StreamBuffer {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.streams = new Map();
    this.baseTarget = Math.round(sampleRate * BASE_PREBUFFER_MS / 1000);
    this.maxBuffered = Math.round(sampleRate * MAX_BUFFER_MS / 1000);
  }

  push(streamId, samples) {
    let stream = this.streams.get(streamId);
    if (!stream) {
      stream = { chunks: [], offset: 0, buffered: 0, started: false, target: this.baseTarget };
      this.streams.set(streamId, stream);
    }
    stream.chunks.push(samples);
    stream.buffered += samples.length;
    if (stream.buffered > this.maxBuffered) this.#trim(stream, stream.buffered - stream.target);
  }

  mix(output) {
    output.fill(0);
    let active = 0;
    for (const [id, stream] of this.streams) {
      if (!stream.started) {
        if (stream.buffered < stream.target) continue;
        stream.started = true;
      }

      let written = 0;
      while (written < output.length && stream.chunks.length) {
        const chunk = stream.chunks[0];
        const take = Math.min(output.length - written, chunk.length - stream.offset);
        for (let i = 0; i < take; i++) output[written + i] += chunk[stream.offset + i];
        written += take;
        stream.offset += take;
        stream.buffered -= take;
        if (stream.offset >= chunk.length) {
          stream.chunks.shift();
          stream.offset = 0;
        }
      }

      if (written > 0) active++;
      if (written < output.length) {
        stream.started = false;
        stream.target = Math.min(Math.round(this.sampleRate * 0.14), stream.target + Math.round(this.sampleRate * 0.02));
      } else if (stream.target > this.baseTarget && stream.buffered > stream.target * 2) {
        stream.target = Math.max(this.baseTarget, stream.target - Math.round(this.sampleRate * 0.01));
      }
      if (!stream.started && stream.buffered === 0) this.streams.delete(id);
    }

    let peak = 0;
    for (let i = 0; i < output.length; i++) {
      if (active > 1) output[i] /= Math.sqrt(active);
      output[i] = clamp(output[i]);
      peak = Math.max(peak, Math.abs(output[i]));
    }
    return peak;
  }

  remove(streamId) {
    this.streams.delete(streamId);
  }

  clear() {
    this.streams.clear();
  }

  #trim(stream, samplesToDrop) {
    let remaining = samplesToDrop;
    while (remaining > 0 && stream.chunks.length) {
      const available = stream.chunks[0].length - stream.offset;
      const take = Math.min(available, remaining);
      stream.offset += take;
      stream.buffered -= take;
      remaining -= take;
      if (stream.offset >= stream.chunks[0].length) {
        stream.chunks.shift();
        stream.offset = 0;
      }
    }
  }
}

/** Microphone capture, per-speaker buffering, mixing and device playback. */
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
  }

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx;
    try { ctx = new Ctx({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" }); }
    catch { ctx = new Ctx({ latencyHint: "interactive" }); }
    this.ctx = ctx;
    this._sourceRate = ctx.sampleRate;
    this._fallbackMixer = new StreamBuffer(ctx.sampleRate);

    let workletsReady = false;
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        await ctx.audioWorklet.addModule("/js/audio-worklet.js");
        this._playNode = new AudioWorkletNode(ctx, "ts-playback", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this._playNode.port.onmessage = (event) => {
          if (event.data?.type === "level") this.outLevel = event.data.value;
        };
        this._playNode.connect(ctx.destination);
        workletsReady = true;
      } catch (err) {
        console.warn("AudioWorklet unavailable, using compatibility audio path:", err);
      }
    }

    if (!workletsReady) {
      this._playProc = ctx.createScriptProcessor(1024, 1, 1);
      this._playProc.onaudioprocess = (event) => {
        const output = event.outputBuffer.getChannelData(0);
        this.outLevel = Math.min(1, this._fallbackMixer.mix(output) * 4);
      };
      this._playProc.connect(ctx.destination);
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
        throw new Error(secure ? "this browser does not support microphone access" : "microphone access requires https:// or localhost");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      this._stream = stream;
      this._micSource = ctx.createMediaStreamSource(stream);

      if (workletsReady) {
        this._captureNode = new AudioWorkletNode(ctx, "ts-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this._captureNode.port.onmessage = (event) => {
          if (event.data?.type === "mic") this._processMic(event.data.samples);
        };
        this._micSource.connect(this._captureNode);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        this._captureNode.connect(mute).connect(ctx.destination);
        this._micMute = mute;
      } else {
        this._micProc = ctx.createScriptProcessor(1024, 1, 1);
        this._micProc.onaudioprocess = (event) => this._processMic(event.inputBuffer.getChannelData(0));
        this._micSource.connect(this._micProc);
        const mute = ctx.createGain();
        mute.gain.value = 0;
        this._micProc.connect(mute).connect(ctx.destination);
        this._micMute = mute;
      }
      this.micAvailable = true;
    } catch (err) {
      this.micError = err;
    }

    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
      if (ctx.state === "suspended") {
        const resume = () => {
          void ctx.resume();
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

  setOnMicFrame(callback) {
    this._onMicFrame = callback;
  }

  _processMic(input) {
    const samples = this._sourceRate === SAMPLE_RATE ? input : this._resample(input, this._sourceRate, SAMPLE_RATE);
    const level = rms(samples);
    this.micLevel = Math.min(1, level * 8);
    if (level > VAD_THRESHOLD) this._voiceActiveUntil = performance.now() + VAD_HANGOVER_MS;
    const gated = this.micEnabled && (this.ptt ? this.pttHeld : performance.now() < this._voiceActiveUntil);

    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(FRAME_SAMPLES - this._micFill, samples.length - offset);
      this._micAcc.set(samples.subarray(offset, offset + take), this._micFill);
      this._micFill += take;
      offset += take;
      if (this._micFill === FRAME_SAMPLES) {
        if (gated && this._onMicFrame) this._onMicFrame(this._micAcc.slice());
        this._micFill = 0;
      }
    }
  }

  _resample(input, inRate, outRate) {
    const ratio = outRate / inRate;
    const output = new Float32Array(Math.round(input.length * ratio));
    for (let i = 0; i < output.length; i++) {
      const position = i / ratio;
      const a = Math.floor(position);
      const b = Math.min(a + 1, input.length - 1);
      const fraction = position - a;
      output[i] = input[a] * (1 - fraction) + input[b] * fraction;
    }
    return output;
  }

  play(streamId, pcm) {
    if (!this.ctx) return;
    const samples = this.ctx.sampleRate === SAMPLE_RATE ? pcm : this._resample(pcm, SAMPLE_RATE, this.ctx.sampleRate);
    if (this._playNode) this._playNode.port.postMessage({ type: "push", streamId, samples }, [samples.buffer]);
    else this._fallbackMixer.push(streamId, samples);
  }

  removeStream(streamId) {
    if (this._playNode) this._playNode.port.postMessage({ type: "remove", streamId });
    this._fallbackMixer?.remove(streamId);
  }

  resetPlayback() {
    if (this._playNode) this._playNode.port.postMessage({ type: "clear" });
    this._fallbackMixer?.clear();
    this.outLevel = 0;
  }

  dispose() {
    try {
      this._micSource?.disconnect();
      this._captureNode?.disconnect();
      this._micProc?.disconnect();
      this._micMute?.disconnect();
      this._playNode?.disconnect();
      this._playProc?.disconnect();
      this._stream?.getTracks().forEach((track) => track.stop());
      void this.ctx?.close();
    } catch {}
    this.ctx = null;
  }
}

export { SAMPLE_RATE, FRAME_SAMPLES, StreamBuffer };
