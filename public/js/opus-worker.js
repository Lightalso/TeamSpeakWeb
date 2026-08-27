import {
  Application,
  Signal,
  createDecoder,
  createEncoder,
} from "../vendor/libopus-wasm/index.js";

const SAMPLE_RATE = 48_000;
const FRAME_SAMPLES = 960;
let encoder = null;
const decoders = new Map();

function report(error) {
  self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

async function decoderFor(streamId) {
  let decoder = decoders.get(streamId);
  if (!decoder) {
    decoder = createDecoder({ sampleRate: SAMPLE_RATE, channels: 1, maxFrameSize: 5760 });
    decoders.set(streamId, decoder);
  }
  return decoder;
}

async function removeDecoder(streamId) {
  const decoder = decoders.get(streamId);
  if (!decoder) return;
  decoders.delete(streamId);
  try { (await decoder).free(); } catch {}
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    switch (message?.type) {
      case "init":
        if (!encoder) {
          encoder = await createEncoder({
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
        }
        self.postMessage({ type: "ready" });
        break;
      case "encode": {
        if (!encoder || !message.samples?.length) break;
        const packet = encoder.encodeFloat(message.samples);
        self.postMessage({ type: "encoded", packet }, [packet.buffer]);
        break;
      }
      case "decode-batch": {
        const decodedItems = [];
        for (const item of message.items ?? []) {
          if (!item.packet?.length) continue;
          try {
            const decoder = await decoderFor(item.streamId);
            const samples = decoder.decodeFloat(item.packet);
            decodedItems.push({ streamId: item.streamId, token: item.token, samples });
          } catch (error) {
            await removeDecoder(item.streamId);
            report(error);
          }
        }
        if (decodedItems.length) {
          self.postMessage(
            { type: "decoded-batch", items: decodedItems },
            decodedItems.map((item) => item.samples.buffer),
          );
        }
        break;
      }
      case "remove":
        await removeDecoder(message.streamId);
        break;
      case "reset":
        await Promise.all([...decoders.keys()].map(removeDecoder));
        break;
      case "close":
        await Promise.all([...decoders.keys()].map(removeDecoder));
        try { encoder?.free(); } catch {}
        encoder = null;
        break;
      default:
        break;
    }
  } catch (error) {
    report(error);
  }
};
