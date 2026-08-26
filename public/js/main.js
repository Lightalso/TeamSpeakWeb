import { AudioEngine } from "./audio.js";
import { BrowserOpusCodec } from "./opus.js";

const THEME_STORAGE_KEY = "tsweb_theme";
const THEME_MODES = ["auto", "light", "dark"];
const AUDIO_STORAGE_KEY = "tsweb_audio_preferences";
const IDENTITY_STORAGE_KEY = "tsweb_identity";
const LAST_CONNECTION_STORAGE_KEY = "tsweb_last_connection";
const MIC_MODES = ["open", "ptt", "muted"];
const LANGUAGE_STORAGE_KEY = "tsweb_language";
const LANGUAGES = ["en", "zh"];
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

const TRANSLATIONS = {
  en: {
    "brand.caption": "Browser voice client",
    "common.optional": "(optional)",
    "connect.title": "Connect to server",
    "connect.description": "Enter the server details to start a voice session.",
    "connect.address": "Server address",
    "connect.address_placeholder": "ts.example.com:9987",
    "connect.nickname": "Nickname",
    "connect.nickname_placeholder": "Guest",
    "connect.server_password": "Server password",
    "connect.default_channel": "Default channel",
    "connect.channel_placeholder": "Lobby",
    "connect.channel_password": "Channel password",
    "connect.advanced": "Advanced options",
    "connect.button": "Connect",
    "connect.connecting_button": "Connecting…",
    "connect.storage_note": "Connection details, including passwords, are stored in this browser.",
    "identity.saved": "Saved TeamSpeak identity ready; it will be reused.",
    "identity.new": "A private TeamSpeak identity will be created after connecting.",
    "status.not_connected": "Not connected",
    "nav.channels": "Channels",
    "nav.clients": "Clients",
    "nav.chat": "Chat",
    "action.join": "Join",
    "action.disconnect": "Disconnect",
    "chat.placeholder": "Message channel…",
    "chat.send": "Send",
    "audio.mic_short": "Mic",
    "audio.out_short": "Out",
    "audio.mic_volume": "Microphone volume",
    "audio.output_volume": "Master output volume",
    "audio.mic_on": "Mic on",
    "audio.mic_on_title": "Microphone on · Click for push-to-talk",
    "audio.hold": "Hold to talk",
    "audio.talking": "Talking",
    "audio.ptt_title": "Push-to-talk · Hold this button to talk; click for mute",
    "audio.muted": "Muted",
    "audio.muted_title": "Microphone muted · Click to turn it on",
    "audio.unavailable": "Mic unavailable",
    "audio.unavailable_title": "Microphone is unavailable in this browser",
    "theme.auto": "Auto",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "theme.currently": "currently {theme}",
    "theme.title": "Theme: {theme}{detail}",
    "theme.switch": "Click to switch",
    "language.switch": "切换到中文",
    "message.bridge_closed": "Connection closed before TeamSpeak login completed.",
    "message.bridge_failed": "Cannot connect to the local WebSocket bridge.",
    "message.connected": "Connected to server as {nickname}",
    "message.disconnected": "Disconnected{reason}",
    "message.error": "Error: {message}",
    "message.poked": "Poked by {name}: {message}",
    "message.joined": "Joined channel",
    "message.codec_error": "Voice codec error: {message}",
    "message.voice_unavailable": "Voice is unavailable: this browser needs WebAssembly support.",
    "message.mic_unavailable": "Microphone unavailable (you can still hear others): {message}",
    "message.permission_denied": "permission denied",
    "message.connecting": "Connecting to the TeamSpeak server…",
    "message.timeout": "TeamSpeak connection timed out after 35 seconds.",
    "server.fallback": "TeamSpeak Server",
    "client.you": "you",
    "client.mute": "Mute {nickname}",
    "client.unmute": "Unmute {nickname}",
    "client.volume": "Volume for {nickname}",
    "client.volume_settings": "Volume",
    "text.pm": "PM",
    "text.server": "Server",
    "text.channel": "channel",
  },
  zh: {
    "brand.caption": "浏览器语音客户端",
    "common.optional": "（可选）",
    "connect.title": "连接服务器",
    "connect.description": "填写服务器信息以开始语音会话。",
    "connect.address": "服务器地址",
    "connect.address_placeholder": "ts.example.com:9987",
    "connect.nickname": "昵称",
    "connect.nickname_placeholder": "访客",
    "connect.server_password": "服务器密码",
    "connect.default_channel": "默认频道",
    "connect.channel_placeholder": "大厅",
    "connect.channel_password": "频道密码",
    "connect.advanced": "高级选项",
    "connect.button": "连接",
    "connect.connecting_button": "正在连接…",
    "connect.storage_note": "连接信息（包括密码）保存在当前浏览器中。",
    "identity.saved": "已保存 TeamSpeak 身份，连接时将继续复用。",
    "identity.new": "连接后将创建并保存一个专用 TeamSpeak 身份。",
    "status.not_connected": "未连接",
    "nav.channels": "频道",
    "nav.clients": "客户端",
    "nav.chat": "聊天",
    "action.join": "加入",
    "action.disconnect": "断开连接",
    "chat.placeholder": "发送频道消息…",
    "chat.send": "发送",
    "audio.mic_short": "麦克风",
    "audio.out_short": "输出",
    "audio.mic_volume": "麦克风音量",
    "audio.output_volume": "总输出音量",
    "audio.mic_on": "麦克风开启",
    "audio.mic_on_title": "麦克风已开启 · 点击切换为按键说话",
    "audio.hold": "按住说话",
    "audio.talking": "正在说话",
    "audio.ptt_title": "按键说话 · 长按此按钮说话，点击切换为静音",
    "audio.muted": "已静音",
    "audio.muted_title": "麦克风已静音 · 点击开启",
    "audio.unavailable": "麦克风不可用",
    "audio.unavailable_title": "此浏览器无法使用麦克风",
    "theme.auto": "自动",
    "theme.light": "日间",
    "theme.dark": "夜间",
    "theme.currently": "当前为{theme}",
    "theme.title": "主题：{theme}{detail}",
    "theme.switch": "点击切换",
    "language.switch": "Switch to English",
    "message.bridge_closed": "TeamSpeak 登录完成前连接已关闭。",
    "message.bridge_failed": "无法连接本地 WebSocket 网桥。",
    "message.connected": "已以 {nickname} 身份连接服务器",
    "message.disconnected": "已断开连接{reason}",
    "message.error": "错误：{message}",
    "message.poked": "{name} 戳了你：{message}",
    "message.joined": "已加入频道",
    "message.codec_error": "语音编解码器错误：{message}",
    "message.voice_unavailable": "语音不可用：此浏览器需要支持 WebAssembly。",
    "message.mic_unavailable": "麦克风不可用（仍可听到其他人）：{message}",
    "message.permission_denied": "权限被拒绝",
    "message.connecting": "正在连接 TeamSpeak 服务器…",
    "message.timeout": "TeamSpeak 连接在 35 秒后超时。",
    "server.fallback": "TeamSpeak 服务器",
    "client.you": "你",
    "client.mute": "静音 {nickname}",
    "client.unmute": "取消静音 {nickname}",
    "client.volume": "{nickname} 的音量",
    "client.volume_settings": "音量",
    "text.pm": "私聊",
    "text.server": "服务器",
    "text.channel": "频道",
  },
};

let language = LANGUAGES.includes(document.documentElement.dataset.language)
  ? document.documentElement.dataset.language
  : "en";

function t(key, variables = {}) {
  let value = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) {
    value = value.replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

function readStoredIdentity() {
  try {
    const identity = localStorage.getItem(IDENTITY_STORAGE_KEY);
    return identity?.trim() ? identity : undefined;
  } catch (_) {
    return undefined;
  }
}

function storeIdentity(identity) {
  if (typeof identity !== "string" || !identity.trim()) return;
  try { localStorage.setItem(IDENTITY_STORAGE_KEY, identity); } catch (_) {}
}

function cleanStoredString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function readLastConnection() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_CONNECTION_STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return null;
    const profile = {
      address: cleanStoredString(saved.address, 512).trim(),
      nickname: cleanStoredString(saved.nickname, 30).trim(),
      serverPassword: cleanStoredString(saved.serverPassword, 512),
      defaultChannel: cleanStoredString(saved.defaultChannel, 256).trim(),
      channelPassword: cleanStoredString(saved.channelPassword, 512),
      serverName: cleanStoredString(saved.serverName, 256).trim(),
      lastConnectedAt: cleanStoredString(saved.lastConnectedAt, 40),
    };
    return profile.address ? profile : null;
  } catch (_) {
    return null;
  }
}

let lastConnection = readLastConnection();

function saveLastConnection(changes) {
  const next = {
    address: cleanStoredString(changes.address ?? lastConnection?.address, 512).trim(),
    nickname: cleanStoredString(changes.nickname ?? lastConnection?.nickname, 30).trim(),
    serverPassword: cleanStoredString(changes.serverPassword ?? lastConnection?.serverPassword, 512),
    defaultChannel: cleanStoredString(changes.defaultChannel ?? lastConnection?.defaultChannel, 256).trim(),
    channelPassword: cleanStoredString(changes.channelPassword ?? lastConnection?.channelPassword, 512),
    serverName: cleanStoredString(changes.serverName ?? lastConnection?.serverName, 256).trim(),
    lastConnectedAt: cleanStoredString(changes.lastConnectedAt ?? lastConnection?.lastConnectedAt, 40),
  };
  if (!next.address) return;
  lastConnection = next;
  try { localStorage.setItem(LAST_CONNECTION_STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
}

function normalizeVolume(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(2, number)) : fallback;
}

function normalizeMicMode(value) {
  return MIC_MODES.includes(value) ? value : "open";
}

function readAudioPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY) || "null");
    return {
      micVolume: normalizeVolume(saved?.micVolume),
      outputVolume: normalizeVolume(saved?.outputVolume),
      micMode: normalizeMicMode(saved?.micMode),
      clients: saved?.clients && typeof saved.clients === "object" ? saved.clients : {},
    };
  } catch (_) {
    return { micVolume: 1, outputVolume: 1, micMode: "open", clients: {} };
  }
}

const audioPreferences = readAudioPreferences();

function saveAudioPreferences() {
  try { localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(audioPreferences)); } catch (_) {}
}

function clientPreferenceKey(client) {
  return client.uid || `nickname:${client.nickname}`;
}

function clientAudioPreferences(client) {
  const saved = audioPreferences.clients[clientPreferenceKey(client)] ?? {};
  return { volume: normalizeVolume(saved.volume) };
}

function persistClientAudioPreferences(client, settings) {
  audioPreferences.clients[clientPreferenceKey(client)] = {
    volume: normalizeVolume(settings.volume),
  };
  saveAudioPreferences();
}

function readThemeMode() {
  const bootMode = document.documentElement.dataset.themeMode;
  if (THEME_MODES.includes(bootMode)) return bootMode;
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(saved) ? saved : "auto";
  } catch (_) {
    return "auto";
  }
}

let themeMode = readThemeMode();

function applyTheme(mode, persist = true) {
  themeMode = THEME_MODES.includes(mode) ? mode : "auto";
  const effective = themeMode === "auto" ? (systemTheme.matches ? "dark" : "light") : themeMode;
  const definition = {
    auto: ["◐", t("theme.auto")],
    light: ["☀", t("theme.light")],
    dark: ["☾", t("theme.dark")],
  }[themeMode];

  document.documentElement.dataset.themeMode = themeMode;
  document.documentElement.dataset.theme = effective;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", effective === "dark" ? "#131722" : "#f2f4fa");
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.querySelector("[data-theme-icon]").textContent = definition[0];
    button.querySelector("[data-theme-label]").textContent = definition[1];
    const effectiveLabel = t(`theme.${effective}`);
    const detail = themeMode === "auto" ? ` · ${t("theme.currently", { theme: effectiveLabel })}` : "";
    button.title = t("theme.title", { theme: definition[1], detail });
    button.setAttribute("aria-label", `${button.title}. ${t("theme.switch")}.`);
  });
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, themeMode); } catch (_) {}
  }
}

function applyLanguage(nextLanguage, persist = true) {
  language = LANGUAGES.includes(nextLanguage) ? nextLanguage : "en";
  document.documentElement.dataset.language = language;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAria));
  });
  document.querySelectorAll("[data-language-toggle]").forEach((button) => {
    button.querySelector("[data-language-label]").textContent = language === "en" ? "EN" : "中文";
    button.title = t("language.switch");
    button.setAttribute("aria-label", button.title);
  });
  if (persist) {
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch (_) {}
  }
  applyTheme(themeMode, false);
  updateIdentityStatus();
  renderMicMode();
  if (connectTimer) el.connectBtn.textContent = t("connect.connecting_button");
  if (state.selectedCid) {
    const selected = state.channels.find((channel) => channel.id === state.selectedCid);
    el.selectedChannelTitle.textContent = selected?.name || t("nav.clients");
  }
  if (state.clients.length) renderClients();
}

const state = {
  ws: null,
  connected: false,
  clid: 0,
  cid: "",
  nickname: "",
  uid: "",
  identity: readStoredIdentity(),
  channels: [],
  clients: [],
  serverInfo: null,
  selectedCid: null,
  talking: new Set(),
};

const audio = new AudioEngine();
audio.setMicVolume(audioPreferences.micVolume);
audio.setOutputVolume(audioPreferences.outputVolume);
let voiceCodecErrorShown = false;
const voiceCodec = new BrowserOpusCodec({
  onEncoded: (packet) => sendOpusFrame(packet),
  onDecoded: (streamId, pcm) => audio.play(streamId, pcm),
  onError: (error) => {
    console.error("Browser Opus error:", error);
    if (!voiceCodecErrorShown) {
      voiceCodecErrorShown = true;
      addChatLine({ system: t("message.codec_error", { message: error.message }) });
    }
  },
});
const voiceCodecReady = voiceCodec.init().catch((error) => {
  console.error("Unable to initialize browser Opus:", error);
  return false;
});
const CONNECT_TIMEOUT_MS = 35_000;
let connectTimer = null;
let pendingJoinCid = null;

const $ = (sel) => document.querySelector(sel);
const el = {
  connectScreen: $("#connect-screen"),
  mainScreen: $("#main-screen"),
  form: $("#connect-form"),
  addr: $("#f-addr"),
  nickname: $("#f-nickname"),
  password: $("#f-password"),
  channel: $("#f-channel"),
  channelpw: $("#f-channelpw"),
  connectBtn: $("#connect-btn"),
  connectError: $("#connect-error"),
  serverName: $("#server-name"),
  disconnectBtn: $("#disconnect-btn"),
  channelTree: $("#channel-tree"),
  selectedChannelTitle: $("#selected-channel-title"),
  joinBtn: $("#join-btn"),
  clientList: $("#client-list"),
  chatLog: $("#chat-log"),
  chatForm: $("#chat-form"),
  chatInput: $("#chat-input"),
  micBtn: $("#mic-btn"),
  micMeter: $("#mic-meter"),
  outMeter: $("#out-meter"),
  micVolume: $("#mic-volume"),
  micVolumeValue: $("#mic-volume-value"),
  outputVolume: $("#output-volume"),
  outputVolumeValue: $("#output-volume-value"),
  identityStatus: $("#identity-status"),
};

function updateIdentityStatus() {
  el.identityStatus.textContent = t(state.identity ? "identity.saved" : "identity.new");
}

function restoreLastConnection() {
  if (lastConnection) {
    el.addr.value = lastConnection.address;
    el.nickname.value = lastConnection.nickname;
    el.password.value = lastConnection.serverPassword;
    el.channel.value = lastConnection.defaultChannel;
    el.channelpw.value = lastConnection.channelPassword;
  }
  updateIdentityStatus();
}

restoreLastConnection();

function persistConnectionForm() {
  const address = el.addr.value.trim();
  saveLastConnection({
    address,
    nickname: el.nickname.value.trim(),
    serverPassword: el.password.value,
    defaultChannel: el.channel.value.trim(),
    channelPassword: el.channelpw.value,
    serverName: lastConnection?.address === address ? lastConnection.serverName : "",
  });
}

let connectionFormSaveTimer = null;
el.form.addEventListener("input", () => {
  clearTimeout(connectionFormSaveTimer);
  connectionFormSaveTimer = setTimeout(persistConnectionForm, 150);
});
el.form.addEventListener("change", persistConnectionForm);
window.addEventListener("beforeunload", persistConnectionForm);

function renderMasterVolumeControls() {
  el.micVolume.value = String(Math.round(audioPreferences.micVolume * 100));
  el.micVolumeValue.value = `${el.micVolume.value}%`;
  el.outputVolume.value = String(Math.round(audioPreferences.outputVolume * 100));
  el.outputVolumeValue.value = `${el.outputVolume.value}%`;
}

el.micVolume.addEventListener("input", () => {
  audioPreferences.micVolume = normalizeVolume(Number(el.micVolume.value) / 100);
  audio.setMicVolume(audioPreferences.micVolume);
  el.micVolumeValue.value = `${el.micVolume.value}%`;
});
el.micVolume.addEventListener("change", saveAudioPreferences);
el.outputVolume.addEventListener("input", () => {
  audioPreferences.outputVolume = normalizeVolume(Number(el.outputVolume.value) / 100);
  audio.setOutputVolume(audioPreferences.outputVolume);
  el.outputVolumeValue.value = `${el.outputVolume.value}%`;
});
el.outputVolume.addEventListener("change", saveAudioPreferences);
renderMasterVolumeControls();

document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const currentIndex = THEME_MODES.indexOf(themeMode);
    applyTheme(THEME_MODES[(currentIndex + 1) % THEME_MODES.length]);
  });
});

document.querySelectorAll("[data-language-toggle]").forEach((button) => {
  button.addEventListener("click", () => applyLanguage(language === "en" ? "zh" : "en"));
});

const handleSystemThemeChange = () => {
  if (themeMode === "auto") applyTheme("auto", false);
};
if (typeof systemTheme.addEventListener === "function") systemTheme.addEventListener("change", handleSystemThemeChange);
else systemTheme.addListener(handleSystemThemeChange);
applyTheme(themeMode, false);

// ---- WebSocket ---------------------------------------------------------------

function bridgeWebSocketUrl() {
  const configured = new URLSearchParams(location.search).get("bridge") || window.TSWEB_BRIDGE_URL;
  if (configured) {
    const url = new URL(configured, location.href);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    return url.toString();
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function connect(addr, nickname, password, channel, channelpw) {
  const ws = new WebSocket(bridgeWebSocketUrl());
  ws.binaryType = "arraybuffer";
  state.ws = ws;

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "connect",
        addr,
        nickname,
        serverPassword: password,
        defaultChannel: channel,
        defaultChannelPassword: channelpw,
        identity: state.identity,
      }),
    );
  };

  ws.onmessage = (e) => {
    if (typeof e.data === "string") handleJson(JSON.parse(e.data));
    else handleBinary(e.data);
  };

  ws.onclose = () => {
    if (!state.connected && el.connectError.classList.contains("connecting")) {
      showConnectError(t("message.bridge_closed"));
    }
    onDisconnected();
  };
  ws.onerror = () => {
    if (!state.connected) showConnectError(t("message.bridge_failed"));
  };
}

function handleJson(msg) {
  switch (msg.type) {
    case "connected":
      finishConnecting();
      el.connectError.classList.add("hidden");
      el.connectError.classList.remove("connecting");
      state.connected = true;
      state.clid = msg.clid;
      state.cid = msg.cid;
      state.nickname = msg.nickname;
      state.uid = msg.uid;
      pendingJoinCid = null;
      if (msg.identity) {
        state.identity = msg.identity;
        storeIdentity(msg.identity);
        updateIdentityStatus();
      }
      saveLastConnection({
        address: el.addr.value,
        nickname: msg.nickname,
        serverPassword: el.password.value,
        defaultChannel: el.channel.value,
        channelPassword: el.channelpw.value,
        serverName: lastConnection?.address === el.addr.value.trim() ? lastConnection.serverName : "",
        lastConnectedAt: new Date().toISOString(),
      });
      state.selectedCid = msg.cid;
      showMain();
      addChatLine({ system: t("message.connected", { nickname: msg.nickname }) });
      initAudio();
      break;
    case "disconnected":
      addChatLine({ system: t("message.disconnected", { reason: msg.reason ? `: ${msg.reason}` : "" }) });
      onDisconnected();
      break;
    case "error":
      pendingJoinCid = null;
      updateJoinButton();
      addChatLine({ system: t("message.error", { message: msg.message }) });
      showConnectError(msg.message);
      break;
    case "channels":
      state.channels = msg.channels;
      renderChannels();
      break;
    case "clients":
      state.clients = msg.clients;
      renderClients();
      renderChannels();
      break;
    case "serverInfo":
      state.serverInfo = msg.info;
      if (state.connected && msg.info?.name) saveLastConnection({ serverName: msg.info.name });
      renderServerInfo();
      break;
    case "clientEnter": {
      const index = state.clients.findIndex((client) => client.id === msg.client.id);
      if (index >= 0) state.clients[index] = msg.client;
      else state.clients.push(msg.client);
      if (msg.client.isSelf) {
        state.cid = msg.client.cid;
        if (pendingJoinCid === state.cid) pendingJoinCid = null;
        if (!state.selectedCid || state.selectedCid === "0") state.selectedCid = msg.client.cid;
        updateJoinButton();
      }
      renderClients();
      renderChannels();
      break;
    }
    case "clientLeave":
      state.clients = state.clients.filter((client) => client.id !== msg.id);
      state.talking.delete(msg.id);
      clearTimeout(talkingTimeouts.get(msg.id));
      talkingTimeouts.delete(msg.id);
      voiceCodec.removeDecoder(msg.id);
      audio.removeStream(msg.id);
      renderClients();
      renderChannels();
      break;
    case "clientMoved": {
      const client = state.clients.find((entry) => entry.id === msg.id);
      if (client) client.cid = msg.cid;
      if (client?.isSelf || msg.id === state.clid) {
        state.cid = msg.cid;
        pendingJoinCid = null;
        updateJoinButton();
      }
      renderClients();
      renderChannels();
      break;
    }
    case "clientTalking":
      setTalking(msg.clid, msg.talking);
      break;
    case "textMessage":
      addChatLine(fromTextMessage(msg.msg));
      break;
    case "poked":
      addChatLine({ system: t("message.poked", { name: msg.invokerName, message: msg.message }) });
      break;
    case "joined":
      state.cid = msg.cid;
      state.selectedCid = msg.cid;
      pendingJoinCid = null;
      updateJoinButton();
      addChatLine({ system: t("message.joined") });
      renderClients();
      renderChannels();
      break;
    default:
      break;
  }
}

function handleBinary(data) {
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0x04 && bytes.length > 4) {
    const clid = (bytes[1] << 8) | bytes[2];
    const packet = bytes.slice(4);
    void voiceCodecReady.then((ready) => {
      if (ready) voiceCodec.decode(clid, packet);
    });
    setTalking(clid, true, true);
  }
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function sendOpusFrame(packet) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const out = new Uint8Array(1 + packet.length);
  out[0] = 0x03;
  out.set(packet, 1);
  state.ws.send(out);
}

// ---- Audio -------------------------------------------------------------------

let audioInited = false;
let microphoneReady = null;
async function initAudio() {
  if (audioInited) return;
  audioInited = true;
  const [, codecReady] = await Promise.all([audio.init(), voiceCodecReady]);
  if (!codecReady) {
    microphoneReady = false;
    audio.micEnabled = false;
    renderMicMode();
    addChatLine({ system: t("message.voice_unavailable") });
    return;
  }
  audio.setOnMicFrame((frame) => voiceCodec.encode(frame));
  if (audio.micAvailable) {
    microphoneReady = true;
    applyMicMode();
  } else {
    microphoneReady = false;
    addChatLine({
      system: t("message.mic_unavailable", { message: audio.micError?.message ?? t("message.permission_denied") }),
    });
    applyMicMode();
  }
}

// ---- Voice controls ----------------------------------------------------------

let micMode = normalizeMicMode(audioPreferences.micMode);
let pttHeld = false;

function renderMicMode() {
  const unavailable = microphoneReady === false;
  const definitions = {
    open: [t("audio.mic_on"), t("audio.mic_on_title")],
    ptt: [pttHeld ? t("audio.talking") : t("audio.hold"), t("audio.ptt_title")],
    muted: [t("audio.muted"), t("audio.muted_title")],
  };
  const [label, title] = definitions[micMode];
  el.micBtn.textContent = unavailable ? t("audio.unavailable") : label;
  el.micBtn.title = unavailable ? t("audio.unavailable_title") : title;
  el.micBtn.setAttribute("aria-label", el.micBtn.title);
  el.micBtn.dataset.mode = micMode;
  el.micBtn.classList.toggle("active", micMode === "open" || (micMode === "ptt" && pttHeld));
  el.micBtn.classList.toggle("held", micMode === "ptt" && pttHeld);
  el.micBtn.classList.toggle("muted", micMode === "muted");
}

function applyMicMode() {
  audio.ptt = micMode === "ptt";
  audio.pttHeld = micMode === "ptt" && pttHeld;
  audio.micEnabled = audio.micAvailable && micMode !== "muted";
  renderMicMode();
}

function setMicMode(mode, persist = true) {
  micMode = normalizeMicMode(mode);
  pttHeld = false;
  applyMicMode();
  if (persist) {
    audioPreferences.micMode = micMode;
    saveAudioPreferences();
  }
}

let longPressTimer = null;
let longPressActive = false;
let suppressNextMicClick = false;

function endMicPress() {
  clearTimeout(longPressTimer);
  longPressTimer = null;
  if (!longPressActive) return;
  longPressActive = false;
  suppressNextMicClick = true;
  pttHeld = false;
  applyMicMode();
}

el.micBtn.addEventListener("pointerdown", (event) => {
  if (micMode !== "ptt" || (event.button !== undefined && event.button !== 0)) return;
  longPressActive = false;
  el.micBtn.setPointerCapture?.(event.pointerId);
  longPressTimer = setTimeout(() => {
    longPressActive = true;
    pttHeld = true;
    applyMicMode();
  }, 250);
});
el.micBtn.addEventListener("pointerup", endMicPress);
el.micBtn.addEventListener("pointercancel", endMicPress);
el.micBtn.addEventListener("lostpointercapture", endMicPress);
el.micBtn.addEventListener("contextmenu", (event) => {
  if (micMode === "ptt") event.preventDefault();
});
el.micBtn.addEventListener("click", (event) => {
  if (suppressNextMicClick) {
    suppressNextMicClick = false;
    event.preventDefault();
    return;
  }
  const currentIndex = MIC_MODES.indexOf(micMode);
  setMicMode(MIC_MODES[(currentIndex + 1) % MIC_MODES.length]);
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && micMode === "ptt" && !isTyping(e.target)) {
    e.preventDefault();
    if (e.repeat) return;
    pttHeld = true;
    applyMicMode();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" && micMode === "ptt") {
    pttHeld = false;
    applyMicMode();
  }
});

renderMicMode();

function isTyping(target) {
  return target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
}

// ---- UI rendering ------------------------------------------------------------

function showMain() {
  el.connectScreen.classList.add("hidden");
  el.mainScreen.classList.remove("hidden");
  el.serverName.textContent = state.serverInfo?.name || lastConnection?.serverName || el.addr.value.trim() || t("server.fallback");
  requestRefresh();
  send({ type: "serverInfo" });
}

function onDisconnected() {
  const wasConnected = state.connected;
  finishConnecting();
  state.connected = false;
  pendingJoinCid = null;
  state.clients = [];
  state.channels = [];
  state.talking.clear();
  for (const timeout of talkingTimeouts.values()) clearTimeout(timeout);
  talkingTimeouts.clear();
  voiceCodec.resetDecoders();
  audio.resetPlayback();
  el.mainScreen.classList.add("hidden");
  el.connectScreen.classList.remove("hidden");
  el.connectBtn.disabled = false;
  if (wasConnected) {
    el.connectError.classList.add("hidden");
    el.connectError.classList.remove("connecting");
  }
}

function startConnecting() {
  finishConnecting();
  el.connectBtn.disabled = true;
  el.connectBtn.textContent = t("connect.connecting_button");
  el.connectError.textContent = t("message.connecting");
  el.connectError.classList.add("connecting");
  el.connectError.classList.remove("hidden");
  connectTimer = setTimeout(() => {
    showConnectError(t("message.timeout"));
    state.ws?.close();
  }, CONNECT_TIMEOUT_MS);
}

function finishConnecting() {
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = null;
  el.connectBtn.disabled = false;
  el.connectBtn.textContent = t("connect.button");
}

let refreshTimer = null;
function requestRefresh() {
  if (!state.connected) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    send({ type: "refresh" });
  }, 120);
}

function renderServerInfo() {
  if (!state.serverInfo) return;
  el.serverName.textContent = state.serverInfo.name || t("server.fallback");
}

function buildChannelTree() {
  const channels = state.channels.filter((c) => c.id !== "0" && c.name !== "");
  const ids = new Set(channels.map((c) => c.id));
  const byParent = new Map();
  for (const ch of channels) {
    const parent = ch.parentID !== "0" && !ids.has(ch.parentID) ? "0" : ch.parentID;
    const list = byParent.get(parent) || [];
    list.push(ch);
    byParent.set(parent, list);
  }

  const clientCounts = new Map();
  for (const c of state.clients) {
    clientCounts.set(c.cid, (clientCounts.get(c.cid) || 0) + 1);
  }

  const visited = new Set();
  const renderLevel = (parentID) => {
    if (visited.has(parentID)) return null;
    visited.add(parentID);
    const list = byParent.get(parentID) || [];
    list.sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) return null;
    const ul = document.createElement("ul");
    for (const ch of list) {
      if (ch.id === parentID) continue;
      const li = document.createElement("li");
      const item = document.createElement("div");
      item.className = "channel-item";
      if (ch.id === state.selectedCid) item.classList.add("selected");
      item.innerHTML = `<span class="channel-name">${escapeHtml(ch.name)}</span><span class="count">${clientCounts.get(ch.id) || 0}</span>`;
      item.addEventListener("click", () => {
        selectChannel(ch.id);
        if (isMobileLayout()) switchMobileTab("clients-panel");
      });
      item.addEventListener("dblclick", () => {
        if (!isMobileLayout()) joinChannel(ch.id);
      });
      li.appendChild(item);
      const children = renderLevel(ch.id);
      if (children) li.appendChild(children);
      ul.appendChild(li);
    }
    return ul;
  };

  el.channelTree.innerHTML = "";
  const root = renderLevel("0");
  if (root) el.channelTree.appendChild(root);
}

function renderChannels() {
  buildChannelTree();
}

function selectChannel(cid) {
  state.selectedCid = cid;
  const ch = state.channels.find((c) => c.id === cid);
  el.selectedChannelTitle.textContent = ch ? ch.name : t("nav.clients");
  updateJoinButton();
  renderChannels();
  renderClients();
}

function updateJoinButton() {
  el.joinBtn.disabled = !state.connected
    || !state.selectedCid
    || state.selectedCid === state.cid
    || pendingJoinCid !== null;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function joinChannel(cid) {
  if (!state.connected || !cid || cid === state.cid || cid === pendingJoinCid) return;
  state.selectedCid = cid;
  pendingJoinCid = cid;
  updateJoinButton();
  send({ type: "join", cid });
}

function renderClients() {
  for (const client of state.clients) {
    if (client.isSelf || client.type !== 0) continue;
    const settings = clientAudioPreferences(client);
    audio.setStreamVolume(client.id, settings.volume);
    audio.setStreamMuted(client.id, false);
  }

  const inChannel = state.clients.filter((c) => c.cid === state.selectedCid);
  inChannel.sort((a, b) => b.isSelf - a.isSelf || a.nickname.localeCompare(b.nickname));

  el.clientList.innerHTML = "";
  for (const c of inChannel) {
    const item = document.createElement("div");
    item.className = "client-item" + (c.isSelf ? " self" : "");
    item.dataset.clientId = String(c.id);
    if (state.talking.has(c.id)) item.classList.add("talking");
    item.innerHTML =
      `<div class="client-summary">` +
        `<div class="client-name">${escapeHtml(c.nickname)}${c.isSelf ? ` <span class="muted">(${t("client.you")})</span>` : ""}</div>` +
        `<div class="talk-dot" aria-hidden="true"></div>` +
      `</div>`;

    if (!c.isSelf && c.type === 0) {
      const settings = clientAudioPreferences(c);
      const summary = item.querySelector(".client-summary");

      const toggleVolume = () => {
        if (!isMobileLayout()) return;
        const expanded = item.classList.toggle("volume-open");
        summary.setAttribute("aria-expanded", String(expanded));
      };
      if (isMobileLayout()) {
        summary.classList.add("volume-expand-target");
        summary.tabIndex = 0;
        summary.setAttribute("role", "button");
        summary.setAttribute("aria-expanded", "false");
        summary.setAttribute("aria-label", t("client.volume", { nickname: c.nickname }));
        summary.addEventListener("click", toggleVolume);
        summary.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggleVolume();
        });
      }

      const controls = document.createElement("div");
      controls.className = "client-audio-controls";

      const volumeLabel = document.createElement("label");
      volumeLabel.className = "client-volume";
      const volumeInput = document.createElement("input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "200";
      volumeInput.step = "5";
      volumeInput.value = String(Math.round(settings.volume * 100));
      volumeInput.setAttribute("aria-label", t("client.volume", { nickname: c.nickname }));
      const volumeValue = document.createElement("output");
      volumeValue.value = `${volumeInput.value}%`;
      volumeInput.addEventListener("input", () => {
        settings.volume = normalizeVolume(Number(volumeInput.value) / 100);
        volumeValue.value = `${volumeInput.value}%`;
        audio.setStreamVolume(c.id, settings.volume);
      });
      volumeInput.addEventListener("change", () => persistClientAudioPreferences(c, settings));
      volumeLabel.append(volumeInput, volumeValue);
      controls.append(volumeLabel);
      item.appendChild(controls);
    }
    el.clientList.appendChild(item);
  }
}

function addChatLine(entry) {
  const line = document.createElement("div");
  if (entry.system) {
    line.className = "chat-line system";
    line.textContent = entry.system;
  } else {
    line.className = "chat-line";
    line.innerHTML =
      `<span class="where">${escapeHtml(entry.where || "")}</span> ` +
      `<span class="who">${escapeHtml(entry.who)}</span>: ` +
      escapeHtml(entry.text);
  }
  el.chatLog.appendChild(line);
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
}

function fromTextMessage(m) {
  if (m.targetMode === 1) {
    return { who: `${m.invokerName} (${t("text.pm")})`, text: m.message };
  }
  if (m.targetMode === 3) {
    return { who: m.invokerName, where: `[${t("text.server")}]`, text: m.message };
  }
  const ch = state.channels.find((c) => c.id === m.targetID);
  return { who: m.invokerName, where: `[${ch ? ch.name : t("text.channel")}]`, text: m.message };
}

const talkingTimeouts = new Map();
function setTalking(clid, talking, fromVoice = false) {
  const wasTalking = state.talking.has(clid);
  if (talking) {
    state.talking.add(clid);
  } else {
    state.talking.delete(clid);
  }
  if (wasTalking !== state.talking.has(clid)) {
    el.clientList.querySelector(`[data-client-id="${clid}"]`)?.classList.toggle("talking", talking);
  }
  if (fromVoice && talking) {
    clearTimeout(talkingTimeouts.get(clid));
    talkingTimeouts.set(clid, setTimeout(() => setTalking(clid, false), 600));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Mobile tab switching ----------------------------------------------------

function switchMobileTab(panelId) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.classList.contains(panelId)));
  document.querySelectorAll(".mobile-tab").forEach((t) => t.classList.toggle("active", t.dataset.panel === panelId));
}

document.querySelectorAll(".mobile-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchMobileTab(tab.dataset.panel));
});

// ---- Events ------------------------------------------------------------------

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(connectionFormSaveTimer);
  persistConnectionForm();
  startConnecting();
  connect(
    el.addr.value.trim(),
    el.nickname.value.trim() || "Guest",
    el.password.value,
    el.channel.value.trim(),
    el.channelpw.value,
  );
});

el.disconnectBtn.addEventListener("click", () => {
  send({ type: "disconnect" });
  onDisconnected();
});

el.joinBtn.addEventListener("click", () => {
  joinChannel(state.selectedCid);
});

el.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = el.chatInput.value.trim();
  if (!text) return;
  send({ type: "chat", targetMode: 2, target: state.cid, message: text });
  el.chatInput.value = "";
});

function showConnectError(msg) {
  finishConnecting();
  el.connectError.textContent = msg;
  el.connectError.classList.remove("connecting");
  el.connectError.classList.remove("hidden");
}

// VU meter polling
setInterval(() => {
  el.micMeter.style.width = `${Math.round(audio.micLevel * 100)}%`;
  el.micMeter.classList.toggle("hot", audio.micLevel > 0.85);
  el.outMeter.style.width = `${Math.round(audio.outLevel * 100)}%`;
  el.outMeter.classList.toggle("hot", audio.outLevel > 0.85);
}, 90);

applyLanguage(language, false);
