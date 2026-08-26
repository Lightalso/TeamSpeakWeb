import { AudioEngine, clamp } from "./audio.js";

const THEME_STORAGE_KEY = "tsweb_theme";
const THEME_MODES = ["auto", "light", "dark"];
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

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
  identity: localStorage.getItem("tsweb_identity") || undefined,
  channels: [],
  clients: [],
  serverInfo: null,
  selectedCid: null,
  talking: new Set(),
};

const audio = new AudioEngine();
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
  pttToggle: $("#ptt-toggle"),
  pttBtn: $("#ptt-btn"),
  micMeter: $("#mic-meter"),
  outMeter: $("#out-meter"),
};

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

function connect(addr, nickname, password, channel, channelpw) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
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
        localStorage.setItem("tsweb_identity", msg.identity);
      }
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
  if (bytes[0] === 0x02 && bytes.length > 3) {
    const clid = (bytes[1] << 8) | bytes[2];
    const dv = new DataView(data, 3);
    const n = (bytes.length - 3) / 2;
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) f32[i] = dv.getInt16(i * 2, true) / 0x8000;
    audio.play(f32);
    setTalking(clid, true, true);
  }
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function sendMicFrame(f32) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const out = new Uint8Array(1 + f32.length * 2);
  out[0] = 0x01;
  const dv = new DataView(out.buffer);
  for (let i = 0; i < f32.length; i++) {
    const s = clamp(f32[i]);
    dv.setInt16(1 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  state.ws.send(out);
}

// ---- Audio -------------------------------------------------------------------

let audioInited = false;
async function initAudio() {
  if (audioInited) return;
  audioInited = true;
  await audio.init();
  audio.setOnMicFrame(sendMicFrame);
  if (audio.micAvailable) {
    audio.micEnabled = true;
    el.micBtn.classList.add("active");
  } else {
    addChatLine({
      system: `Microphone unavailable (you can still hear others): ${audio.micError?.message ?? "permission denied"}`,
    });
    el.micBtn.classList.remove("active");
  }
}

// ---- Voice controls ----------------------------------------------------------

let pttHeld = false;
function updatePtt() {
  audio.ptt = el.pttToggle.checked;
  audio.pttHeld = pttHeld;
  el.pttBtn.classList.toggle("active", el.pttToggle.checked);
  el.pttBtn.classList.toggle("held", pttHeld && el.pttToggle.checked);
}
el.micBtn.addEventListener("click", () => {
  audio.micEnabled = !audio.micEnabled;
  el.micBtn.classList.toggle("active", audio.micEnabled);
});
el.pttToggle.addEventListener("change", updatePtt);
el.pttBtn.addEventListener("mousedown", () => { pttHeld = true; updatePtt(); });
el.pttBtn.addEventListener("mouseup", () => { pttHeld = false; updatePtt(); });
el.pttBtn.addEventListener("mouseleave", () => { pttHeld = false; updatePtt(); });
el.pttBtn.addEventListener("touchstart", (e) => { e.preventDefault(); pttHeld = true; updatePtt(); });
el.pttBtn.addEventListener("touchend", () => { pttHeld = false; updatePtt(); });
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && el.pttToggle.checked && !isTyping(e.target)) {
    e.preventDefault();
    pttHeld = true;
    updatePtt();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") { pttHeld = false; updatePtt(); }
});

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
  el.connectBtn.textContent = "Connect";
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
  const inChannel = state.clients.filter((c) => c.cid === state.selectedCid);
  inChannel.sort((a, b) => b.isSelf - a.isSelf || a.nickname.localeCompare(b.nickname));

  el.clientList.innerHTML = "";
  for (const c of inChannel) {
    const item = document.createElement("div");
    item.className = "client-item" + (c.isSelf ? " self" : "");
    if (state.talking.has(c.id)) item.classList.add("talking");
    const initial = (c.nickname[0] || "?").toUpperCase();
    item.innerHTML =
      `<div class="avatar">${escapeHtml(initial)}</div>` +
      `<div>${escapeHtml(c.nickname)}${c.isSelf ? ' <span class="muted">(you)</span>' : ""}</div>` +
      `<div class="talk-dot"></div>`;
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
  if (wasTalking !== state.talking.has(clid)) renderClients();
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
