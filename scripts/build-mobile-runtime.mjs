import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const vendorDir = join(root, "public", "vendor");
const nodeDir = join(root, "public", "nodejs");

mkdirSync(vendorDir, { recursive: true });
mkdirSync(nodeDir, { recursive: true });

await build({
  entryPoints: [join(root, "mobile", "android-transport.ts")],
  outfile: join(vendorDir, "android-runtime.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  minify: true,
});

await build({
  entryPoints: [join(root, "mobile", "node-entry.ts")],
  outfile: join(nodeDir, "index.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: ["node18"],
  external: ["bridge"],
  minify: true,
});

writeFileSync(
  join(nodeDir, "package.json"),
  `${JSON.stringify({ name: "teamspeak-web-mobile-runtime", private: true, main: "index.cjs" }, null, 2)}\n`,
);

console.log("Built standalone Android TeamSpeak runtime.");
