import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Session } from "./session.js";
import { MIC_OPUS_FRAME } from "./protocol.js";

const PORT = Number(process.env["PORT"] ?? 3000);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const SSL_CERT = process.env["SSL_CERT"];
const SSL_KEY = process.env["SSL_KEY"];

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = normalize(join(__dirname, "..", "..", "public"));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function serveStatic(url: string): Promise<{ status: number; body: Buffer; type: string } | null> {
  const pathname = url.split("?")[0]!;
  if (pathname.includes("..")) return null;

  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";

  const filePath = normalize(join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return null;

  try {
    const body = await readFile(filePath);
    return { status: 200, body, type: MIME[extname(filePath)] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const served = await serveStatic(req.url ?? "/");
  if (served) {
    res.writeHead(served.status, { "Content-Type": served.type });
    res.end(served.body);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

const server =
  SSL_CERT && SSL_KEY
    ? createHttpsServer({ cert: readFileSync(SSL_CERT), key: readFileSync(SSL_KEY) }, handler)
    : createHttpServer(handler);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws: WebSocket) => {
  const session = new Session(ws);

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (buf[0] === MIC_OPUS_FRAME) {
        session.handleMicOpus(buf.subarray(1));
      }
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    void session.handleMessage(msg as Parameters<Session["handleMessage"]>[0]);
  });

  ws.on("close", () => session.close());
  ws.on("error", () => session.close());
});

server.listen(PORT, HOST, () => {
  const scheme = SSL_CERT && SSL_KEY ? "https" : "http";
  console.log(`TeamSpeak Web bridge listening on ${scheme}://${HOST}:${PORT}`);
});
