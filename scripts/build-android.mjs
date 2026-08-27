import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const androidDir = join(root, "android");
const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const result = spawnSync(wrapper, ["assembleDebug"], {
  cwd: androidDir,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const source = join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
if (!existsSync(source)) {
  console.error(`Android build succeeded but the APK was not found at ${source}`);
  process.exit(1);
}

const artifactsDir = join(root, "artifacts");
const target = join(artifactsDir, "TeamSpeakWeb-debug.apk");
mkdirSync(artifactsDir, { recursive: true });
copyFileSync(source, target);
console.log(`APK ready: ${target}`);
