const FRAME_MS = 20;
const BASE_PREBUFFER_MS = 60;
const MAX_PREBUFFER_MS = 140;
const MAX_BUFFER_MS = 300;

class TeamSpeakCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSamples = Math.round(sampleRate * FRAME_MS / 1000);
    this.accumulator = new Float32Array(this.frameSamples);
    this.fill = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!input) return true;

    let offset = 0;
    while (offset < input.length) {
      const take = Math.min(this.frameSamples - this.fill, input.length - offset);
      this.accumulator.set(input.subarray(offset, offset + take), this.fill);
      this.fill += take;
      offset += take;
      if (this.fill === this.frameSamples) {
        const frame = this.accumulator;
        this.port.postMessage({ type: "mic", samples: frame }, [frame.buffer]);
        this.accumulator = new Float32Array(this.frameSamples);
        this.fill = 0;
      }
    }
    return true;
  }
}

class TeamSpeakPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.baseTarget = Math.round(sampleRate * BASE_PREBUFFER_MS / 1000);
    this.maxTarget = Math.round(sampleRate * MAX_PREBUFFER_MS / 1000);
    this.maxBuffered = Math.round(sampleRate * MAX_BUFFER_MS / 1000);
    this.meterCounter = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  handleMessage(message) {
    if (message.type === "clear") {
      this.streams.clear();
      return;
    }
    if (message.type === "remove") {
      this.streams.delete(message.streamId);
      return;
    }
    if (message.type === "settings") {
      const stream = this.streams.get(message.streamId);
      if (stream) {
        stream.volume = message.volume;
        stream.muted = message.muted;
      }
      return;
    }
    if (message.type !== "push" || !message.samples?.length) return;

    let stream = this.streams.get(message.streamId);
    if (!stream) {
      stream = {
        chunks: [],
        offset: 0,
        buffered: 0,
        started: false,
        target: this.baseTarget,
        volume: message.volume ?? 1,
        muted: message.muted ?? false,
      };
      this.streams.set(message.streamId, stream);
    } else {
      stream.volume = message.volume ?? stream.volume;
      stream.muted = message.muted ?? stream.muted;
    }
    stream.chunks.push(message.samples);
    stream.buffered += message.samples.length;
    if (stream.buffered > this.maxBuffered) this.trim(stream, stream.buffered - stream.target);
  }

  trim(stream, amount) {
    let remaining = amount;
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

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    let active = 0;

    for (const [id, stream] of this.streams) {
      if (!stream.started) {
        if (stream.buffered < stream.target) continue;
        stream.started = true;
      }

      let written = 0;
      const gain = stream.muted ? 0 : stream.volume;
      while (written < output.length && stream.chunks.length) {
        const chunk = stream.chunks[0];
        const take = Math.min(output.length - written, chunk.length - stream.offset);
        if (gain > 0) {
          for (let i = 0; i < take; i++) output[written + i] += chunk[stream.offset + i] * gain;
        }
        written += take;
        stream.offset += take;
        stream.buffered -= take;
        if (stream.offset >= chunk.length) {
          stream.chunks.shift();
          stream.offset = 0;
        }
      }

      if (written > 0 && gain > 0) active++;
      if (written < output.length) {
        stream.started = false;
        stream.target = Math.min(this.maxTarget, stream.target + Math.round(sampleRate * 0.02));
      } else if (stream.target > this.baseTarget && stream.buffered > stream.target * 2) {
        stream.target = Math.max(this.baseTarget, stream.target - Math.round(sampleRate * 0.01));
      }
      if (!stream.started && stream.buffered === 0) this.streams.delete(id);
    }

    let peak = 0;
    for (let i = 0; i < output.length; i++) {
      if (active > 1) output[i] /= Math.sqrt(active);
      output[i] = Math.max(-1, Math.min(1, output[i]));
      peak = Math.max(peak, Math.abs(output[i]));
    }
    if (++this.meterCounter >= 8) {
      this.port.postMessage({ type: "level", value: Math.min(1, peak * 4) });
      this.meterCounter = 0;
    }
    return true;
  }
}

registerProcessor("ts-capture", TeamSpeakCaptureProcessor);
registerProcessor("ts-playback", TeamSpeakPlaybackProcessor);
