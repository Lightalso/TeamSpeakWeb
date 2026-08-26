import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.resolve("libopus-wasm"));
const dist = dirname(entry);
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "public", "vendor", "libopus-wasm");

mkdirSync(join(target, "generated"), { recursive: true });
copyFileSync(entry, join(target, "index.js"));
copyFileSync(join(dist, "generated", "libopus.generated.mjs"), join(target, "generated", "libopus.generated.mjs"));
copyFileSync(join(dist, "..", "LICENSE"), join(target, "LICENSE"));
copyFileSync(join(dist, "..", "THIRD_PARTY_NOTICES.md"), join(target, "THIRD_PARTY_NOTICES.md"));

console.log("Prepared browser Opus WASM files.");
