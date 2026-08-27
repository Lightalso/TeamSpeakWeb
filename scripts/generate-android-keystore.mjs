import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const signingDir = join(root, "android", "release-signing");
const keystorePath = join(signingDir, "teamspeakweb-release.jks");
const propertiesPath = join(root, "android", "keystore.properties");
const alias = "teamspeakweb";

if (existsSync(keystorePath) || existsSync(propertiesPath)) {
  console.error("Release signing already exists; refusing to replace the fixed Android identity.");
  process.exit(1);
}

const password = randomBytes(32).toString("base64url");
mkdirSync(signingDir, { recursive: true });

const result = spawnSync(
  "keytool",
  [
    "-genkeypair",
    "-v",
    "-keystore",
    keystorePath,
    "-storetype",
    "JKS",
    "-storepass",
    password,
    "-keypass",
    password,
    "-alias",
    alias,
    "-keyalg",
    "RSA",
    "-keysize",
    "4096",
    "-validity",
    "10000",
    "-dname",
    "CN=TeamSpeak Web, OU=Release, O=Lightalso, L=Unknown, ST=Unknown, C=CN",
  ],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

writeFileSync(
  propertiesPath,
  [
    "storeFile=release-signing/teamspeakweb-release.jks",
    `storePassword=${password}`,
    `keyAlias=${alias}`,
    `keyPassword=${password}`,
    "",
  ].join("\n"),
  { encoding: "utf8", mode: 0o600 },
);

console.log("Stable Android release signing created.");
console.log(`Keystore: ${keystorePath}`);
console.log(`Local configuration: ${propertiesPath}`);
console.log("Back up both ignored files securely; losing them prevents signed upgrades.");
