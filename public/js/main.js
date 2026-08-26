import { AudioEngine } from "./audio.js";
import { BrowserOpusCodec } from "./opus.js";

const THEME_STORAGE_KEY = "tsweb_theme";
const THEME_MODES = ["auto", "light", "dark"];
const AUDIO_STORAGE_KEY = "tsweb_audio_preferences";
const IDENTITY_STORAGE_KEY = "tsweb_identity";
const LAST_CONNECTION_STORAGE_KEY = "tsweb_last_connection";
const MIC_MODES = ["open", "ptt", "muted"];
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

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
  return { volume: normalizeVolume(saved.volume), muted: Boolean(saved.muted) };
}

function persistClientAudioPreferences(client, settings) {
  audioPreferences.clients[clientPreferenceKey(client)] = {
    volume: normalizeVolume(settings.volume),
    muted: Boolean(settings.muted),
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
  const definition = { auto: ["◐", "Auto"], light: ["☀", "Light"], dark: ["☾", "Dark"] }[themeMode];

  document.documentElement.dataset.themeMode = themeMode;
  document.documentElement.dataset.theme = effective;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", effective === "dark" ? "#131722" : "#f2f4fa");
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.querySelector("[data-theme-icon]").textContent = definition[0];
    button.querySelector("[data-theme-label]").textContent = definition[1];
    const detail = themeMode === "auto" ? `, currently ${effective}` : "";
    button.title = `Theme: ${definition[1]}${detail}`;
    button.setAttribute("aria-label", `${button.title}. Click to switch.`);
  });
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, themeMode); } catch (_) {}
  }
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
      addChatLine({ system: `Voice codec error: ${error.message}` });
    }
  },
});
const voiceCodecReady = voiceCodec.init().catch((error) => {
  console.error("Unable to initialize browser Opus:", error);
  return false;
});
const CONNECT_TIMEOUT_MS = 35_000;
let connectTimer = null;

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
  serverCounts: $("#server-counts"),
  selfInfo: $("#self-info"),
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

function restoreLastConnection() {
  if (lastConnection) {
    el.addr.value = lastConnection.address;
    el.nickname.value = lastConnection.nickname;
    el.password.value = lastConnection.serverPassword;
    el.channel.value = lastConnection.defaultChannel;
    el.channelpw.value = lastConnection.channelPassword;
  }
  el.identityStatus.textContent = state.identity
    ? "Saved TeamSpeak identity ready; it will be reused."
    : "A private TeamSpeak identity will be created and remembered after connecting.";
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
      showConnectError("Connection closed before TeamSpeak login completed.");
    }
    onDisconnected();
  };
  ws.onerror = () => {
    if (!state.connected) showConnectError("Cannot connect to the local WebSocket bridge.");
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
      if (msg.identity) {
        state.identity = msg.identity;
        storeIdentity(msg.identity);
        el.identityStatus.textContent = "Saved TeamSpeak identity ready; it will be reused.";
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
      addChatLine({ system: `Connected to server as ${msg.nickname}` });
      initAudio();
      break;
    case "disconnected":
      addChatLine({ system: `Disconnected${msg.reason ? ": " + msg.reason : ""}` });
      onDisconnected();
      break;
    case "error":
      addChatLine({ system: `Error: ${msg.message}` });
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
        if (!state.selectedCid || state.selectedCid === "0") state.selectedCid = msg.client.cid;
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
      addChatLine({ system: `Poked by ${msg.invokerName}: ${msg.message}` });
      break;
    case "joined":
      state.cid = msg.cid;
      state.selectedCid = msg.cid;
      addChatLine({ system: "Joined channel" });
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
    addChatLine({ system: "Voice is unavailable: this browser needs WebAssembly support." });
    return;
  }
  audio.setOnMicFrame((frame) => voiceCodec.encode(frame));
  if (audio.micAvailable) {
    microphoneReady = true;
    applyMicMode();
  } else {
    microphoneReady = false;
    addChatLine({
      system: `Microphone unavailable (you can still hear others): ${audio.micError?.message ?? "permission denied"}`,
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
    open: ["🎤 Mic on", "Microphone on · Click for push-to-talk"],
    ptt: [pttHeld ? "🟢 Talking" : "🎙 Hold to talk", "Push-to-talk · Hold this button to talk; click for mute"],
    muted: ["🔇 Muted", "Microphone muted · Click to turn it on"],
  };
  const [label, title] = definitions[micMode];
  el.micBtn.textContent = unavailable ? "🚫 Mic unavailable" : label;
  el.micBtn.title = unavailable ? "Microphone is unavailable in this browser" : title;
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
  el.selfInfo.textContent = state.nickname;
  requestRefresh();
  send({ type: "serverInfo" });
}

function onDisconnected() {
  const wasConnected = state.connected;
  finishConnecting();
  state.connected = false;
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
  el.connectBtn.textContent = "Connecting…";
  el.connectError.textContent = "Connecting to the TeamSpeak server…";
  el.connectError.classList.add("connecting");
  el.connectError.classList.remove("hidden");
  connectTimer = setTimeout(() => {
    showConnectError("TeamSpeak connection timed out after 35 seconds.");
    state.ws?.close();
  }, CONNECT_TIMEOUT_MS);
}

function finishConnecting() {
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = null;
  el.connectBtn.disabled = false;
  el.connectBtn.textContent = "Connect to server";
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
  el.serverName.textContent = state.serverInfo.name || "TeamSpeak Server";
  el.serverCounts.textContent = `${state.serverInfo.clientsOnline} / ${state.serverInfo.maxClients} online`;
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
      item.innerHTML = `<span class="icon">#</span><span>${escapeHtml(ch.name)}</span><span class="count">${clientCounts.get(ch.id) || 0}</span>`;
      item.addEventListener("click", () => selectChannel(ch.id));
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
  el.selectedChannelTitle.textContent = ch ? ch.name : "Clients";
  el.joinBtn.disabled = !state.connected || cid === state.cid;
  renderChannels();
  renderClients();
}

function renderClients() {
  for (const client of state.clients) {
    if (client.isSelf || client.type !== 0) continue;
    const settings = clientAudioPreferences(client);
    audio.setStreamVolume(client.id, settings.volume);
    audio.setStreamMuted(client.id, settings.muted);
  }

  const inChannel = state.clients.filter((c) => c.cid === state.selectedCid);
  inChannel.sort((a, b) => b.isSelf - a.isSelf || a.nickname.localeCompare(b.nickname));

  el.clientList.innerHTML = "";
  for (const c of inChannel) {
    const item = document.createElement("div");
    item.className = "client-item" + (c.isSelf ? " self" : "");
    item.dataset.clientId = String(c.id);
    if (state.talking.has(c.id)) item.classList.add("talking");
    const initial = (c.nickname[0] || "?").toUpperCase();
    item.innerHTML =
      `<div class="client-summary">` +
        `<div class="avatar">${escapeHtml(initial)}</div>` +
        `<div class="client-name">${escapeHtml(c.nickname)}${c.isSelf ? ' <span class="muted">(you)</span>' : ""}</div>` +
        `<div class="talk-dot" aria-hidden="true"></div>` +
      `</div>`;

    if (!c.isSelf && c.type === 0) {
      const settings = clientAudioPreferences(c);
      item.classList.toggle("client-muted", settings.muted);

      const controls = document.createElement("div");
      controls.className = "client-audio-controls";

      const muteButton = document.createElement("button");
      muteButton.type = "button";
      muteButton.className = "client-mute";
      const renderMute = () => {
        muteButton.textContent = settings.muted ? "🔇" : "🔊";
        muteButton.title = `${settings.muted ? "Unmute" : "Mute"} ${c.nickname}`;
        muteButton.setAttribute("aria-label", muteButton.title);
        muteButton.setAttribute("aria-pressed", String(settings.muted));
        item.classList.toggle("client-muted", settings.muted);
      };
      muteButton.addEventListener("click", () => {
        settings.muted = !settings.muted;
        audio.setStreamMuted(c.id, settings.muted);
        persistClientAudioPreferences(c, settings);
        renderMute();
      });
      renderMute();

      const volumeLabel = document.createElement("label");
      volumeLabel.className = "client-volume";
      const volumeInput = document.createElement("input");
      volumeInput.type = "range";
      volumeInput.min = "0";
      volumeInput.max = "200";
      volumeInput.step = "5";
      volumeInput.value = String(Math.round(settings.volume * 100));
      volumeInput.setAttribute("aria-label", `Volume for ${c.nickname}`);
      const volumeValue = document.createElement("output");
      volumeValue.value = `${volumeInput.value}%`;
      volumeInput.addEventListener("input", () => {
        settings.volume = normalizeVolume(Number(volumeInput.value) / 100);
        volumeValue.value = `${volumeInput.value}%`;
        audio.setStreamVolume(c.id, settings.volume);
      });
      volumeInput.addEventListener("change", () => persistClientAudioPreferences(c, settings));
      volumeLabel.append(volumeInput, volumeValue);
      controls.append(muteButton, volumeLabel);
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
    return { who: `${m.invokerName} (PM)`, text: m.message };
  }
  if (m.targetMode === 3) {
    return { who: m.invokerName, where: "[Server]", text: m.message };
  }
  const ch = state.channels.find((c) => c.id === m.targetID);
  return { who: m.invokerName, where: `[${ch ? ch.name : "channel"}]`, text: m.message };
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
  if (state.selectedCid) send({ type: "join", cid: state.selectedCid });
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
