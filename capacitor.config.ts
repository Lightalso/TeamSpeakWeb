import type { CapacitorConfig } from "@capacitor/cli";

/// <reference types="@capawesome/capacitor-nodejs" />

const config: CapacitorConfig = {
  appId: "com.lightalso.teamspeakweb",
  appName: "TeamSpeak Web",
  webDir: "public",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Nodejs: {
      nodeDir: "nodejs",
      startMode: "auto",
    },
  },
};

export default config;
